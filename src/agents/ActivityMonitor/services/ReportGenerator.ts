import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import type { ProcessedData, DailyReport } from '../types';
import { DailyReportSchema } from '../types';
import type { MemoryService } from './MemoryService';

export class ReportGenerator {
	private model = openai('o3');
	private memoryService: MemoryService;
	private lastProcessedData: ProcessedData | null = null;

	constructor(memoryService: MemoryService) {
		this.memoryService = memoryService;
	}

	async generateDailyReport(processedData: ProcessedData, startDate: Date, endDate: Date): Promise<DailyReport> {
		const startTime = Date.now();

		try {
			// Get previous day's report for comparison
			const previousReport = await this.memoryService.getPreviousReport(startDate);

			// Get velocity trends for context
			const velocityTrends = await this.memoryService.getVelocityTrends(7);

			const analysisResult = await generateText({
				model: this.model,
				system: `You are an expert technical project manager creating daily activity reports for busy development teams.

Your goal: Create a comprehensive but digestible report that keeps developers informed about what's happening across their projects, highlighting what needs their attention.

ANALYZE THE DATA AND CREATE A FORMATTED SLACK REPORT with these sections:

**📊 Executive Summary** - 2-3 sentences covering the day's activity and key priorities

**✨ Key Highlights** - 3-5 bullet points of significant events

**🚀 Merged PRs** - For each merged PR, intelligently categorize impact:
- 🔥 Breaking changes (API changes, major refactors)  
- ✨ New features (user-facing improvements)
- 🐛 Bug fixes (critical fixes first)
- 🔧 Routine (dependency updates, minor tweaks)
- 📚 Documentation

For each PR show: Impact emoji, title, author, repo, line changes, and ALWAYS include clickable links using the URL field. Format as: <URL|Click to View PR>

**👀 PRs Needing Review** - Highlight PRs waiting for review with:
- Age (how long it's been waiting)
- Size and complexity indicators
- Requested reviewers
- Priority based on content and context
- ALWAYS include clickable links: <URL|Review PR>

**🎯 New Issues** - Categorize by urgency:
- 🚨 Critical (outages, security, blockers)
- ⚡ High priority (important features, significant bugs)
- 📋 Standard (regular development work)

For each issue include clickable links: <URL|View Issue>

**👥 Team Activity** - Top contributors and collaboration patterns

**🚨 Action Items** - What needs immediate attention, with assignees when possible

Use your intelligence to determine what's truly important vs routine. Consider:
- PR titles, descriptions, and file changes to understand impact
- Issue urgency based on labels and content
- Team collaboration patterns
- What developers actually need to know to stay productive

CRITICAL: Always include clickable links for PRs and Issues using the URL field from the event data. Use Slack link format: <URL|Display Text>

Format for Slack with proper markdown. Be specific and actionable.`,
				prompt: this.buildEnhancedPrompt(processedData, startDate, endDate, previousReport, velocityTrends),
			});

			const report: DailyReport = {
			date: new Date(),
			period: { start: startDate, end: endDate },
			executive_summary: analysisResult.text,
			highlights: ['LLM-generated comprehensive report'],
			sections: {
			  github_activity: {
					summary: 'See full analysis above',
					prs: {
						opened: this.countEventsBySubtype(processedData.events, 'pr_opened'),
						merged: this.countEventsBySubtype(processedData.events, 'pr_merged'),
						reviews_needed: processedData.action_items.filter(item => item.type === 'review_needed').length,
					},
					issues: {
						opened: this.countEventsBySubtype(processedData.events, 'issue_opened'),
						closed: this.countEventsBySubtype(processedData.events, 'issue_closed'),
						in_progress: this.countEventsBySubtype(processedData.events, 'issue_assigned'),
					},
					repositories: this.getTopRepositories(processedData.events),
				},
				team_activity: {
					summary: 'See full analysis above',
					top_contributors: processedData.contributors.slice(0, 5).map(c => ({
						name: c.name,
						activity_count: c.activity_patterns.avg_daily_events,
						platforms: c.activity_patterns.preferred_platforms,
					})),
					collaboration_patterns: ['See full analysis above'],
				},
				action_items: {
					summary: 'See full analysis above',
					items: processedData.action_items.slice(0, 10),
					by_priority: {
						urgent: processedData.action_items.filter(item => item.priority === 'urgent').length,
						high: processedData.action_items.filter(item => item.priority === 'high').length,
						medium: processedData.action_items.filter(item => item.priority === 'medium').length,
						low: processedData.action_items.filter(item => item.priority === 'low').length,
					},
				},
				trends: {
					summary: 'See full analysis above',
					velocity_change: await this.calculateVelocityChange(processedData),
					new_patterns: [],
				},
			},
			metadata: {
				processing_time_ms: Date.now() - startTime,
				data_quality_score: this.calculateDataQualityScore(processedData),
				coverage: {
					github: (processedData.summary_stats.events_by_platform.github ?? 0) > 0,
					slack: (processedData.summary_stats.events_by_platform.slack ?? 0) > 0,
					linear: (processedData.summary_stats.events_by_platform.linear ?? 0) > 0,
				},
			},
		};

			await this.memoryService.storeReport(report);

			return report;
		} catch (error) {
			console.error('Error generating daily report:', error);

			// Fallback: Generate basic report without AI analysis
			return this.generateFallbackReport(processedData, startDate, endDate, startTime);
		}
	}

	private buildEnhancedPrompt(
		data: ProcessedData,
		startDate: Date,
		endDate: Date,
		previousReport: DailyReport | null,
		velocityTrends: Array<{ date: string; metrics: any }>
	): string {
		const dateRange = `${startDate.toDateString()} to ${endDate.toDateString()}`;

		return `
DAILY ACTIVITY DATA FOR ${dateRange}

=== RAW ACTIVITY EVENTS ===
${data.events.slice(0, 50).map(event => `
EVENT: ${event.subtype} in ${event.repository || event.project || 'unknown'}
Title: ${event.title}
Author: ${event.author.name}
Time: ${event.timestamp.toISOString()}
URL: ${event.url || 'N/A'}
Description: ${event.description || 'N/A'}
Labels: ${event.labels?.join(', ') || 'None'}
Assignees: ${event.assignees?.join(', ') || 'None'}
Status: ${event.status || 'N/A'}
Metadata: ${JSON.stringify(event.metadata, null, 2)}
`).join('\n---\n')}

=== SUMMARY STATS ===
Total Events: ${data.summary_stats.total_events}
Contributors: ${data.summary_stats.unique_contributors}
Platform Breakdown: ${JSON.stringify(data.summary_stats.events_by_platform)}
Event Types: ${JSON.stringify(data.summary_stats.events_by_type)}

=== CONTRIBUTORS ===
${data.contributors.slice(0, 10).map(c => `
${c.name} (${c.activity_patterns.avg_daily_events} events)
- Platforms: ${c.activity_patterns.preferred_platforms.join(', ')}
- Focus Areas: ${c.expertise_areas?.join(', ') || 'N/A'}
- Recent Focus: ${c.recent_focus?.join(', ') || 'N/A'}
`).join('\n')}

=== ACTION ITEMS ===
${data.action_items.slice(0, 15).map(item => `
${item.priority.toUpperCase()}: ${item.title}
Type: ${item.type}
Assignee: ${item.assignee || 'Unassigned'}
Description: ${item.description || 'N/A'}
`).join('\n---\n')}

${previousReport ? `
=== YESTERDAY'S COMPARISON ===
Previous PRs opened: ${previousReport.sections.github_activity.prs.opened}
Previous PRs merged: ${previousReport.sections.github_activity.prs.merged}
Previous Issues: ${previousReport.sections.github_activity.issues.opened}
Previous Contributors: ${previousReport.sections.team_activity.top_contributors.length}
` : ''}

Analyze this data and create a well-formatted Slack report that busy developers will actually want to read. Focus on what's actionable and important. Return ONLY the formatted Slack message, no additional commentary.
`;
	}



	private generateFallbackReport(
		data: ProcessedData,
		startDate: Date,
		endDate: Date,
		startTime: number
	): DailyReport {
		return {
			date: new Date(),
			period: { start: startDate, end: endDate },
			executive_summary: this.generateFallbackExecutiveSummary(data),
			highlights: this.generateFallbackHighlights(data),
			sections: {
				github_activity: {
					summary: `Processed ${data.summary_stats.events_by_platform.github || 0} GitHub events`,
					prs: {
						opened: this.countEventsBySubtype(data.events, 'pr_opened'),
						merged: this.countEventsBySubtype(data.events, 'pr_merged'),
						reviews_needed: data.action_items.filter(item => item.type === 'review_needed').length,
					},
					issues: {
						opened: this.countEventsBySubtype(data.events, 'issue_opened'),
						closed: this.countEventsBySubtype(data.events, 'issue_closed'),
						in_progress: this.countEventsBySubtype(data.events, 'issue_assigned'),
					},
					repositories: this.getTopRepositories(data.events),
				},
				team_activity: {
					summary: `${data.summary_stats.unique_contributors} contributors active across ${Object.keys(data.summary_stats.events_by_platform).length} platforms`,
					top_contributors: data.contributors.slice(0, 5).map(c => ({
						name: c.name,
						activity_count: c.activity_patterns.avg_daily_events,
						platforms: c.activity_patterns.preferred_platforms,
					})),
					collaboration_patterns: ['Basic activity tracking enabled'],
				},
				action_items: {
					summary: `${data.action_items.length} action items identified`,
					items: data.action_items.slice(0, 10),
					by_priority: {
						urgent: data.action_items.filter(item => item.priority === 'urgent').length,
						high: data.action_items.filter(item => item.priority === 'high').length,
						medium: data.action_items.filter(item => item.priority === 'medium').length,
						low: data.action_items.filter(item => item.priority === 'low').length,
					},
				},
				trends: {
					summary: 'Historical trend analysis not available',
					velocity_change: 'No previous data for comparison',
					new_patterns: [],
				},
			},
			metadata: {
				processing_time_ms: Date.now() - startTime,
				data_quality_score: this.calculateDataQualityScore(data),
				coverage: {
					github: (data.summary_stats.events_by_platform.github ?? 0) > 0,
					slack: (data.summary_stats.events_by_platform.slack ?? 0) > 0,
					linear: (data.summary_stats.events_by_platform.linear ?? 0) > 0,
				},
			},
		};
	}



	async formatForSlack(report: DailyReport): Promise<string> {
		const analysisText = report.executive_summary || 'No analysis available';
		
		const footer = `\n\n---\n📅 Report Period: ${report.period.start.toLocaleDateString()} - ${report.period.end.toLocaleDateString()}\n⚡ Generated in ${report.metadata.processing_time_ms}ms | Quality Score: ${Math.round(report.metadata.data_quality_score * 100)}%\n---`;
		
		return analysisText + footer;
	}

	private countEventsBySubtype(events: any[], subtype: string): number {
		return events.filter(event => event.subtype === subtype).length;
	}

	private getTopRepositories(events: any[]): Array<{ name: string; activity_score: number; top_contributors: string[] }> {
		const repoStats = new Map<string, { events: number; contributors: Set<string> }>();

		for (const event of events) {
			if (event.repository) {
				if (!repoStats.has(event.repository)) {
					repoStats.set(event.repository, { events: 0, contributors: new Set() });
				}
				const stats = repoStats.get(event.repository);
				if (!stats) {
					throw new Error(`Repository ${event.repository} not found in repoStats`);
				}
				stats.events++;
				stats.contributors.add(event.author.name);
			}
		}

		return Array.from(repoStats.entries())
			.map(([name, stats]) => ({
				name,
				activity_score: stats.events,
				top_contributors: Array.from(stats.contributors).slice(0, 3),
			}))
			.sort((a, b) => b.activity_score - a.activity_score)
			.slice(0, 8);
	}

	private generateFallbackExecutiveSummary(data: ProcessedData): string {
		return `Daily activity report processed ${data.summary_stats.total_events} events from ${data.summary_stats.unique_contributors} contributors across ${data.summary_stats.repositories_active} repositories. ${data.action_items.filter(item => ['high', 'urgent'].includes(item.priority)).length} high-priority items require attention.`;
	}

	private generateFallbackHighlights(data: ProcessedData): string[] {
		return [`${data.summary_stats.total_events} events processed`, `${data.summary_stats.unique_contributors} contributors active`];
	}

	private async calculateVelocityChange(data: ProcessedData): Promise<string> {
		return 'No previous data for comparison';
	}

	private calculateDataQualityScore(data: ProcessedData): number {
		let score = 0;
		if ((data.summary_stats.events_by_platform.github ?? 0) > 0) score += 33;
		if ((data.summary_stats.events_by_platform.slack ?? 0) > 0) score += 33;
		if ((data.summary_stats.events_by_platform.linear ?? 0) > 0) score += 34;
		return score / 100;
	}
}
