import { generateText, generateObject } from 'ai';
import { groq } from '@ai-sdk/groq';
import { z } from 'zod';
import type {
	ActivityEvent,
	ProcessedData,
	Correlation,
	ContributorProfile,
	ActionItem
} from '../types';
import { ProcessedDataSchema } from '../types';
import type { MemoryService } from './MemoryService';

export class DataProcessor {
	private model = groq('llama-3.1-8b-instant');
	private memoryService: MemoryService;

	constructor(memoryService: MemoryService) {
		this.memoryService = memoryService;
	}

	async processAndCorrelate(rawData: {
		github: ActivityEvent[];
		slack: ActivityEvent[];
		linear: ActivityEvent[];
		discord: ActivityEvent[];
	}): Promise<ProcessedData> {
		// Combine all events
		const allEvents = [
			...rawData.github,
			...rawData.slack,
			...rawData.linear,
			...rawData.discord,
		];

		console.log(`Processing ${allEvents.length} total events...`);

		// Step 1: Normalize and deduplicate events
		const normalizedEvents = await this.normalizeEvents(allEvents);

		// Step 2: Extract correlations using Groq
		const correlations = await this.findCorrelations(normalizedEvents);

		// Step 3: Build/update contributor profiles
		const contributors = await this.buildContributorProfiles(normalizedEvents);

		// Step 4: Identify action items
		const actionItems = await this.identifyActionItems(normalizedEvents, correlations);

		// Step 5: Generate summary statistics
		const summaryStats = this.generateSummaryStats(normalizedEvents);

		const processedData: ProcessedData = {
			events: normalizedEvents,
			correlations,
			contributors,
			action_items: actionItems,
			summary_stats: summaryStats,
		};

		return ProcessedDataSchema.parse(processedData);
	}

	private async normalizeEvents(events: ActivityEvent[]): Promise<ActivityEvent[]> {
		// Remove duplicates and normalize data
		const uniqueEvents = new Map<string, ActivityEvent>();

		for (const event of events) {
			// Create a more robust unique key
			const key = `${event.type}_${event.subtype}_${event.author.id}_${event.timestamp.getTime()}`;

			if (!uniqueEvents.has(key)) {
				uniqueEvents.set(key, {
					...event,
					// Ensure consistent data structure
					labels: event.labels || [],
					assignees: event.assignees || [],
					metadata: event.metadata || {},
				});
			}
		}

		return Array.from(uniqueEvents.values())
			.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
	}

	private async findCorrelations(events: ActivityEvent[]): Promise<Correlation[]> {
		const correlations: Correlation[] = [];

		try {
			// Group events for correlation analysis
			const eventsByType = {
				github: events.filter(e => e.type === 'github'),
				slack: events.filter(e => e.type === 'slack'),
				linear: events.filter(e => e.type === 'linear'),
				discord: events.filter(e => e.type === 'discord'),
			};

			// Find PR to Linear correlations
			const prLinearCorrelations = await this.findPRLinearCorrelations(
				eventsByType.github,
				eventsByType.linear
			);
			correlations.push(...prLinearCorrelations);

			// Find Slack to GitHub correlations
			const slackGithubCorrelations = await this.findSlackGithubCorrelations(
				eventsByType.slack,
				eventsByType.github
			);
			correlations.push(...slackGithubCorrelations);

			// Find cross-platform discussions
			const crossPlatformCorrelations = await this.findCrossPlatformDiscussions(events);
			correlations.push(...crossPlatformCorrelations);

		} catch (error) {
			console.error('Error finding correlations:', error);
		}

		return correlations;
	}

	private async findPRLinearCorrelations(githubEvents: ActivityEvent[], linearEvents: ActivityEvent[]): Promise<Correlation[]> {
		const correlations: Correlation[] = [];

		// Look for Linear issue references in GitHub PRs
		for (const prEvent of githubEvents.filter(e => e.subtype?.includes('pr'))) {
			const prText = `${prEvent.title} ${prEvent.description || ''}`.toLowerCase();

			// Find Linear issue references (e.g., "LIN-123", "linear.app/issue/xyz")
			const linearRefs = prText.match(/\b(lin|linear)[-\s]?(\d+|\w{8})\b/gi) || [];
			const linearUrls = prText.match(/linear\.app\/[^\s]+/gi) || [];

			for (const linearEvent of linearEvents) {
				const linearId = linearEvent.metadata?.identifier || linearEvent.metadata?.issue_id;

				// Check if PR references this Linear issue
				const isReferenced = linearRefs.some(ref =>
					ref.toLowerCase().includes(linearId?.toLowerCase() || '')
				) || linearUrls.some(url =>
					url.includes(linearId || '') || url.includes(linearEvent.id)
				);

				if (isReferenced) {
					correlations.push({
						id: `pr_linear_${prEvent.id}_${linearEvent.id}`,
						events: [prEvent.id, linearEvent.id],
						type: 'pr_to_linear',
						confidence: 0.8,
						description: `PR ${prEvent.metadata?.pr_number} relates to Linear issue ${linearId}`,
						keywords: [...linearRefs, ...linearUrls],
					});
				}
			}
		}

		return correlations;
	}

	private async findSlackGithubCorrelations(slackEvents: ActivityEvent[], githubEvents: ActivityEvent[]): Promise<Correlation[]> {
		const correlations: Correlation[] = [];

		// Use Groq to analyze Slack messages for GitHub references
		const slackTexts = slackEvents
			.slice(0, 50) // Limit to prevent excessive API calls
			.map(e => ({
				id: e.id,
				text: `${e.title} ${e.description || ''}`,
				timestamp: e.timestamp,
			}));

		if (slackTexts.length === 0) return correlations;

		try {
			const result = await generateObject({
				model: this.model,
				system: `You are an expert at finding correlations between Slack discussions and GitHub activity. 
        Analyze Slack messages to find references to GitHub PRs, issues, repositories, or commits.
        Look for patterns like:
        - PR numbers (#123, PR-123, pull request 123)
        - Issue numbers (issue #456, fixes #789)
        - Repository names
        - Commit hashes or references
        - GitHub URLs`,
				prompt: `Analyze these Slack messages and identify GitHub references:
        ${JSON.stringify(slackTexts, null, 2)}`,
				schema: z.object({
					correlations: z.array(z.object({
						slack_event_id: z.string(),
						github_reference: z.string(),
						reference_type: z.enum(['pr', 'issue', 'commit', 'repository']),
						confidence: z.number().min(0).max(1),
						extracted_text: z.string(),
					})),
				}),
			});

			// Match found references with actual GitHub events
			for (const correlation of result.object.correlations) {
				const matchingGithubEvents = githubEvents.filter(githubEvent => {
					const prNumber = githubEvent.metadata?.pr_number;
					const issueNumber = githubEvent.metadata?.issue_number;
					const repo = githubEvent.repository;

					switch (correlation.reference_type) {
						case 'pr':
							return prNumber && correlation.github_reference.includes(prNumber.toString());
						case 'issue':
							return issueNumber && correlation.github_reference.includes(issueNumber.toString());
						case 'repository':
							return repo && correlation.github_reference.toLowerCase().includes(repo.toLowerCase());
						default:
							return false;
					}
				});

				for (const githubEvent of matchingGithubEvents) {
					correlations.push({
						id: `slack_github_${correlation.slack_event_id}_${githubEvent.id}`,
						events: [correlation.slack_event_id, githubEvent.id],
						type: 'slack_to_github',
						confidence: correlation.confidence,
						description: `Slack discussion references ${correlation.reference_type}: ${correlation.github_reference}`,
						keywords: [correlation.extracted_text],
					});
				}
			}
		} catch (error) {
			console.error('Error finding Slack-GitHub correlations:', error);
		}

		return correlations;
	}

	private async findCrossPlatformDiscussions(events: ActivityEvent[]): Promise<Correlation[]> {
		const correlations: Correlation[] = [];

		// Group events by potential topics using keywords
		const eventsByKeywords = new Map<string, ActivityEvent[]>();

		for (const event of events) {
			const text = `${event.title} ${event.description || ''}`.toLowerCase();
			const words = text.match(/\b\w{4,}\b/g) || [];

			for (const word of words) {
				if (!eventsByKeywords.has(word)) {
					eventsByKeywords.set(word, []);
				}
				eventsByKeywords.get(word)?.push(event);
			}
		}

		// Find keywords that appear across multiple platforms
		for (const [keyword, relatedEvents] of eventsByKeywords) {
			const platforms = new Set(relatedEvents.map(e => e.type));

			if (platforms.size >= 2 && relatedEvents.length >= 3) {
				// This keyword appears across multiple platforms
				correlations.push({
					id: `cross_platform_${keyword}_${Date.now()}`,
					events: relatedEvents.map(e => e.id),
					type: 'cross_platform_discussion',
					confidence: Math.min(0.9, relatedEvents.length / 10),
					description: `Cross-platform discussion about "${keyword}" spanning ${Array.from(platforms).join(', ')}`,
					keywords: [keyword],
				});
			}
		}

		return correlations.slice(0, 10); // Limit to top 10 cross-platform correlations
	}

	private async buildContributorProfiles(events: ActivityEvent[]): Promise<ContributorProfile[]> {
		const contributorMap = new Map<string, ContributorProfile>();

		// Get existing profiles from memory
		const existingProfiles = new Map<string, ContributorProfile>();
		for (const event of events) {
			const existingProfile = await this.memoryService.getContributorProfile(event.author.id);
			if (existingProfile) {
				existingProfiles.set(event.author.id, existingProfile);
			}
		}

		// Process events to build/update profiles
		for (const event of events) {
			const authorId = event.author.id;

			const profile = contributorMap.get(authorId) || existingProfiles.get(authorId) || {
				id: authorId,
				name: event.author.name,
				platforms: {},
				activity_patterns: {
					most_active_hours: [],
					preferred_platforms: [],
					avg_daily_events: 0,
				},
				expertise_areas: [],
				recent_focus: [],
			};

			// Update platform presence
			profile.platforms[event.type] = event.author.id;

			// Update activity patterns
			const hour = event.timestamp.getHours();
			if (!profile.activity_patterns.most_active_hours.includes(hour)) {
				profile.activity_patterns.most_active_hours.push(hour);
			}

			contributorMap.set(authorId, profile);
		}

		// Analyze activity patterns using Groq
		for (const [authorId, profile] of contributorMap) {
			const authorEvents = events.filter(e => e.author.id === authorId);

			try {
				const analysis = await generateObject({
					model: this.model,
					system: `Analyze a contributor's activity patterns and expertise areas based on their recent activity.
          Identify their preferred platforms, expertise areas, and recent focus areas.
          
          IMPORTANT CONSTRAINTS:
          - expertise_areas: maximum 5 items only
          - recent_focus: maximum 3 items only
          - Choose the most important/relevant items`,
					prompt: `Analyze this contributor's activity:
          Name: ${profile.name}
          Recent events: ${JSON.stringify(authorEvents.slice(0, 20).map(e => ({
						type: e.type,
						subtype: e.subtype,
						title: e.title,
						repository: e.repository,
						project: e.project,
						labels: e.labels,
					})), null, 2)}`,
					schema: z.object({
						preferred_platforms: z.array(z.string()),
						expertise_areas: z.array(z.string()).max(5),
						recent_focus: z.array(z.string()).max(3),
						avg_daily_events: z.number(),
					}),
				});

				profile.activity_patterns.preferred_platforms = analysis.object.preferred_platforms;
				profile.activity_patterns.avg_daily_events = analysis.object.avg_daily_events;
				profile.expertise_areas = analysis.object.expertise_areas;
				profile.recent_focus = analysis.object.recent_focus;

			} catch (error) {
				console.error(`Error analyzing contributor ${authorId}:`, error);
				// Fallback to simple analysis
				const platformCounts = new Map<string, number>();
				for (const event of authorEvents) {
					platformCounts.set(event.type, (platformCounts.get(event.type) || 0) + 1);
				}

				profile.activity_patterns.preferred_platforms = Array.from(platformCounts.entries())
					.sort((a, b) => b[1] - a[1])
					.slice(0, 3)
					.map(([platform]) => platform);

				profile.activity_patterns.avg_daily_events = authorEvents.length;
			}
		}

		return Array.from(contributorMap.values());
	}

	private async identifyActionItems(events: ActivityEvent[], correlations: Correlation[]): Promise<ActionItem[]> {
		const actionItems: ActionItem[] = [];

		try {
			// Use Groq to identify action items from events
			const eventSample = events
				.filter(e => ['high', 'urgent'].includes(e.priority))
				.slice(0, 30)
				.map(e => ({
					id: e.id,
					type: e.type,
					subtype: e.subtype,
					title: e.title,
					priority: e.priority,
					status: e.status,
					assignees: e.assignees,
					repository: e.repository,
					project: e.project,
					url: e.url,
					timestamp: e.timestamp,
				}));

			if (eventSample.length === 0) return actionItems;

			const result = await generateObject({
				model: this.model,
				system: `You are an expert at identifying actionable items from development activity.
        Look for:
        - PRs that need review (review_needed)
        - Issues that are blocked or stalled (blocked)
        - Overdue tasks or assignments (overdue)
        - Items requiring immediate attention (requires_attention)
        
        IMPORTANT: 
        - If description is not available, omit the field completely (don't use null)
        - If assignee is not available, omit the field completely (don't use null)`,
				prompt: `Analyze these events and identify action items that need attention:
        ${JSON.stringify(eventSample, null, 2)}`,
				schema: z.object({
					action_items: z.array(z.object({
						event_id: z.string(),
						type: z.enum(['review_needed', 'blocked', 'overdue', 'requires_attention']),
						title: z.string(),
						description: z.string().nullable().optional(),
						priority: z.enum(['low', 'medium', 'high', 'urgent']),
						assignee: z.string().nullable().optional(),
					})),
				}),
			});

			// Convert to ActionItem objects
			for (const item of result.object.action_items) {
				const originalEvent = events.find(e => e.id === item.event_id);
				if (originalEvent) {
					actionItems.push({
						id: `action_${item.event_id}`,
						type: item.type,
						title: item.title,
						description: item.description ?? undefined,
						url: originalEvent.url,
						assignee: item.assignee ?? undefined,
						priority: item.priority,
						created_at: originalEvent.timestamp,
						platform: originalEvent.type,
						repository: originalEvent.repository,
						project: originalEvent.project,
					});
				}
			}
		} catch (error) {
			console.error('Error identifying action items:', error);

			// Fallback: Simple heuristic-based action item detection
			for (const event of events) {
				if (event.subtype === 'pr_review_requested' && event.priority === 'high') {
					actionItems.push({
						id: `action_${event.id}`,
						type: 'review_needed',
						title: `Review needed: ${event.title}`,
						description: `PR requires review from: ${event.assignees.join(', ')}`,
						url: event.url,
						priority: 'high',
						created_at: event.timestamp,
						platform: event.type,
						repository: event.repository,
					});
				}
			}
		}

		return actionItems.slice(0, 20); // Limit to top 20 action items
	}

	private generateSummaryStats(events: ActivityEvent[]) {
		const stats = {
			total_events: events.length,
			events_by_platform: {} as Record<string, number>,
			events_by_type: {} as Record<string, number>,
			unique_contributors: new Set<string>(),
			repositories_active: new Set<string>(),
			projects_active: new Set<string>(),
		};

		for (const event of events) {
			// Count by platform
			stats.events_by_platform[event.type] = (stats.events_by_platform[event.type] || 0) + 1;

			// Count by subtype
			if (event.subtype) {
				stats.events_by_type[event.subtype] = (stats.events_by_type[event.subtype] || 0) + 1;
			}

			// Track unique contributors
			stats.unique_contributors.add(event.author.id);

			// Track active repositories
			if (event.repository) {
				stats.repositories_active.add(event.repository);
			}

			// Track active projects
			if (event.project) {
				stats.projects_active.add(event.project);
			}
		}

		return {
			total_events: stats.total_events,
			events_by_platform: stats.events_by_platform,
			events_by_type: stats.events_by_type,
			unique_contributors: stats.unique_contributors.size,
			repositories_active: stats.repositories_active.size,
			projects_active: stats.projects_active.size,
		};
	}
}
