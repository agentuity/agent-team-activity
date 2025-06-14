import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import type { ProcessedData, DailyReport } from '../types';
import { DailyReportSchema } from '../types';
import type { MemoryService } from './MemoryService';

export class ReportGenerator {
	private model = anthropic('claude-3-5-sonnet-20241022');
	private memoryService: MemoryService;

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

			// Generate comprehensive analysis using Claude
			const analysisResult = await generateText({
				model: this.model,
				system: `You are an expert technical project manager and data analyst. 
        Generate a comprehensive daily activity report that provides actionable insights for engineering teams.
        
        Focus on:
        - Executive summary with key highlights
        - GitHub activity analysis (PRs, issues, repository health)
        - Team collaboration patterns
        - Action items requiring attention
        - Velocity and trend analysis
        - Cross-platform correlations and insights
        
        Be concise but thorough. Use data-driven insights and specific numbers.
        Highlight both achievements and areas needing attention.`,
				prompt: this.buildAnalysisPrompt(processedData, startDate, endDate, previousReport, velocityTrends),
			});

			// Parse the analysis and structure it into our report format
			const report = await this.structureReport(
				analysisResult.text,
				processedData,
				startDate,
				endDate,
				startTime
			);

			// Store the report for future reference
			await this.memoryService.storeReport(report);

			return report;
		} catch (error) {
			console.error('Error generating daily report:', error);

			// Fallback: Generate basic report without AI analysis
			return this.generateFallbackReport(processedData, startDate, endDate, startTime);
		}
	}

	private buildAnalysisPrompt(
		data: ProcessedData,
		startDate: Date,
		endDate: Date,
		previousReport: DailyReport | null,
		velocityTrends: Array<{ date: string; metrics: any }>
	): string {
		const dateRange = `${startDate.toDateString()} to ${endDate.toDateString()}`;

		return `
DAILY ACTIVITY ANALYSIS REQUEST
Date Range: ${dateRange}
Total Events: ${data.summary_stats.total_events}

=== PLATFORM ACTIVITY BREAKDOWN ===
${Object.entries(data.summary_stats.events_by_platform)
				.map(([platform, count]) => `${platform.toUpperCase()}: ${count} events`)
				.join('\n')}

=== EVENT TYPE BREAKDOWN ===
${Object.entries(data.summary_stats.events_by_type)
				.map(([type, count]) => `${type}: ${count}`)
				.join('\n')}

=== KEY METRICS ===
- Unique Contributors: ${data.summary_stats.unique_contributors}
- Active Repositories: ${data.summary_stats.repositories_active}
- Active Projects: ${data.summary_stats.projects_active}
- Correlations Found: ${data.correlations.length}
- Action Items: ${data.action_items.length}

=== TOP CONTRIBUTORS ===
${data.contributors
				.sort((a, b) => b.activity_patterns.avg_daily_events - a.activity_patterns.avg_daily_events)
				.slice(0, 5)
				.map(c => `${c.name}: ${c.activity_patterns.avg_daily_events} events (${c.activity_patterns.preferred_platforms.join(', ')})`)
				.join('\n')}

=== HIGH PRIORITY ACTION ITEMS ===
${data.action_items
				.filter(item => ['high', 'urgent'].includes(item.priority))
				.slice(0, 8)
				.map(item => `${item.type.toUpperCase()}: ${item.title} (${item.priority})`)
				.join('\n')}

=== SIGNIFICANT CORRELATIONS ===
${data.correlations
				.filter(c => c.confidence > 0.7)
				.slice(0, 5)
				.map(c => `${c.type}: ${c.description} (confidence: ${c.confidence})`)
				.join('\n')}

=== VELOCITY TRENDS (Past 7 Days) ===
${velocityTrends.map(trend =>
					`${trend.date}: PRs: ${trend.metrics.daily_pr_count}, Issues: ${trend.metrics.daily_issue_count}`
				).join('\n')}

${previousReport ? `
=== COMPARISON TO PREVIOUS DAY ===
Previous PRs: ${previousReport.sections.github_activity.prs.opened}
Previous Issues: ${previousReport.sections.github_activity.issues.opened}
Previous Contributors: ${previousReport.sections.team_activity.top_contributors.length}
` : ''}

Please provide:
1. Executive Summary (2-3 sentences)
2. Key Highlights (3-5 bullet points)
3. GitHub Activity Analysis
4. Team Collaboration Insights
5. Action Items Summary
6. Trend Analysis
7. Recommendations

Format your response in clear sections with specific data points and actionable insights.
`;
	}

	private async structureReport(
		analysis: string,
		data: ProcessedData,
		startDate: Date,
		endDate: Date,
		startTime: number
	): Promise<DailyReport> {
		// Extract key sections from the AI analysis
		const sections = this.parseAnalysisSections(analysis);

		// Build structured report
		const report: DailyReport = {
			date: new Date(),
			period: {
				start: startDate,
				end: endDate,
			},
			executive_summary: sections.executiveSummary || this.generateFallbackExecutiveSummary(data),
			highlights: sections.highlights
				? (typeof sections.highlights === 'string' ? JSON.parse(sections.highlights) : sections.highlights)
				: this.generateFallbackHighlights(data),
			sections: {
				github_activity: {
					summary: sections.githubActivity || 'GitHub activity analysis not available',
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
					summary: sections.teamActivity || 'Team activity analysis not available',
					top_contributors: data.contributors
						.sort((a, b) => b.activity_patterns.avg_daily_events - a.activity_patterns.avg_daily_events)
						.slice(0, 8)
						.map(c => ({
							name: c.name,
							activity_count: c.activity_patterns.avg_daily_events,
							platforms: c.activity_patterns.preferred_platforms,
						})),
					collaboration_patterns: this.extractCollaborationPatterns(data),
				},
				action_items: {
					summary: sections.actionItems || `${data.action_items.length} action items identified`,
					items: data.action_items.slice(0, 15), // Limit to top 15
					by_priority: {
						urgent: data.action_items.filter(item => item.priority === 'urgent').length,
						high: data.action_items.filter(item => item.priority === 'high').length,
						medium: data.action_items.filter(item => item.priority === 'medium').length,
						low: data.action_items.filter(item => item.priority === 'low').length,
					},
				},
				trends: {
					summary: sections.trends || 'Trend analysis not available',
					velocity_change: await this.calculateVelocityChange(data),
					new_patterns: this.identifyNewPatterns(data),
				},
			},
			metadata: {
				processing_time_ms: Date.now() - startTime,
				data_quality_score: this.calculateDataQualityScore(data),
				coverage: {
					github: (data.summary_stats.events_by_platform.github ?? 0) > 0,
					slack: (data.summary_stats.events_by_platform.slack ?? 0) > 0,
					linear: (data.summary_stats.events_by_platform.linear ?? 0) > 0,
					discord: (data.summary_stats.events_by_platform.discord ?? 0) > 0,
				},
			},
		};

		return DailyReportSchema.parse(report);
	}

	private parseAnalysisSections(analysis: string): Record<string, string> {
		const sections: Record<string, string> = {};

		// Simple section extraction - in a real implementation, you'd want more robust parsing
		const lines = analysis.split('\n');
		let currentSection = '';
		let currentContent = '';

		for (const line of lines) {
			const trimmed = line.trim();

			if (trimmed.toLowerCase().includes('executive summary')) {
				if (currentSection && currentContent) {
					sections[currentSection] = currentContent.trim();
				}
				currentSection = 'executiveSummary';
				currentContent = '';
			} else if (trimmed.toLowerCase().includes('highlights')) {
				if (currentSection && currentContent) {
					sections[currentSection] = currentContent.trim();
				}
				currentSection = 'highlights';
				currentContent = '';
			} else if (trimmed.toLowerCase().includes('github')) {
				if (currentSection && currentContent) {
					sections[currentSection] = currentContent.trim();
				}
				currentSection = 'githubActivity';
				currentContent = '';
			} else if (trimmed.toLowerCase().includes('team') || trimmed.toLowerCase().includes('collaboration')) {
				if (currentSection && currentContent) {
					sections[currentSection] = currentContent.trim();
				}
				currentSection = 'teamActivity';
				currentContent = '';
			} else if (trimmed.toLowerCase().includes('action')) {
				if (currentSection && currentContent) {
					sections[currentSection] = currentContent.trim();
				}
				currentSection = 'actionItems';
				currentContent = '';
			} else if (trimmed.toLowerCase().includes('trend')) {
				if (currentSection && currentContent) {
					sections[currentSection] = currentContent.trim();
				}
				currentSection = 'trends';
				currentContent = '';
			} else if (currentSection) {
				currentContent += `${line}\n`;
			}
		}

		// Don't forget the last section
		if (currentSection && currentContent) {
			sections[currentSection] = currentContent.trim();
		}

		// Extract highlights as array
		if (sections.highlights) {
			const highlightLines = sections.highlights
				.split('\n')
				.filter(line => line.trim().startsWith('-') || line.trim().startsWith('•'))
				.map(line => line.replace(/^[-•]\s*/, '').trim())
				.filter(line => line.length > 0);

			if (highlightLines.length > 0) {
				sections.highlights = JSON.stringify(highlightLines);
			}
		}

		return sections;
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
					discord: (data.summary_stats.events_by_platform.discord ?? 0) > 0,
				},
			},
		};
	}

	private generateFallbackExecutiveSummary(data: ProcessedData): string {
		return `Daily activity report processed ${data.summary_stats.total_events} events from ${data.summary_stats.unique_contributors} contributors across ${data.summary_stats.repositories_active} repositories. ${data.action_items.filter(item => ['high', 'urgent'].includes(item.priority)).length} high-priority items require attention.`;
	}

	private generateFallbackHighlights(data: ProcessedData): string[] {
		const highlights = [];

		if ((data.summary_stats.events_by_platform.github ?? 0) > 0) {
			highlights.push(`${data.summary_stats.events_by_platform.github} GitHub events tracked`);
		}

		if (data.action_items.length > 0) {
			highlights.push(`${data.action_items.length} action items identified`);
		}

		if (data.correlations.length > 0) {
			highlights.push(`${data.correlations.length} cross-platform correlations found`);
		}

		highlights.push(`${data.summary_stats.unique_contributors} active contributors`);

		return highlights;
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

	private extractCollaborationPatterns(data: ProcessedData): string[] {
		const patterns = [];

		if (data.correlations.length > 0) {
			patterns.push(`${data.correlations.length} cross-platform collaborations detected`);
		}

		const multiPlatformContributors = data.contributors.filter(c =>
			c.activity_patterns.preferred_platforms.length > 1
		).length;

		if (multiPlatformContributors > 0) {
			patterns.push(`${multiPlatformContributors} contributors active across multiple platforms`);
		}

		return patterns;
	}

	private async calculateVelocityChange(data: ProcessedData): Promise<string> {
		try {
			const trends = await this.memoryService.getVelocityTrends(2);
			if (trends.length >= 2) {
				const current = trends[0];
				const previous = trends[1];

				if (!current || !previous) {
					return 'Incomplete trend data';
				}

				const prChange = current.metrics.daily_pr_count - previous.metrics.daily_pr_count;
				const issueChange = current.metrics.daily_issue_count - previous.metrics.daily_issue_count;

				return `PRs: ${prChange >= 0 ? '+' : ''}${prChange}, Issues: ${issueChange >= 0 ? '+' : ''}${issueChange}`;
			}
		} catch (error) {
			console.error('Error calculating velocity change:', error);
		}

		return 'No previous data for comparison';
	}

	private identifyNewPatterns(data: ProcessedData): string[] {
		const patterns = [];

		// Simple pattern detection
		const urgentItems = data.action_items.filter(item => item.priority === 'urgent').length;
		if (urgentItems > 3) {
			patterns.push(`High number of urgent items (${urgentItems})`);
		}

		const highConfidenceCorrelations = data.correlations.filter(c => c.confidence > 0.8).length;
		if (highConfidenceCorrelations > 2) {
			patterns.push(`Strong cross-platform activity correlation (${highConfidenceCorrelations} correlations)`);
		}

		return patterns;
	}

	private calculateDataQualityScore(data: ProcessedData): number {
		let score = 0;

		// Platform coverage (25 points each)
		if ((data.summary_stats.events_by_platform.github ?? 0) > 0) score += 25;
		if ((data.summary_stats.events_by_platform.slack ?? 0) > 0) score += 25;
		if ((data.summary_stats.events_by_platform.linear ?? 0) > 0) score += 25;
		if ((data.summary_stats.events_by_platform.discord ?? 0) > 0) score += 25;

		return score / 100; // Convert to 0-1 scale
	}

	async formatForSlack(report: DailyReport): Promise<string> {
		const date = report.date.toDateString();

		let slackMessage = `# 📊 Daily Activity Report - ${date}\n\n`;

		// Executive Summary
		slackMessage += `## 🎯 Executive Summary\n${report.executive_summary}\n\n`;

		// Key Highlights
		slackMessage += '## ✨ Key Highlights\n';
		for (const highlight of report.highlights) {
			slackMessage += `• ${highlight}\n`;
		}
		slackMessage += '\n';

		// GitHub Activity
		slackMessage += '## 🐙 GitHub Activity\n';
		slackMessage += `• **PRs:** ${report.sections.github_activity.prs.opened} opened, ${report.sections.github_activity.prs.merged} merged, ${report.sections.github_activity.prs.reviews_needed} need review\n`;
		slackMessage += `• **Issues:** ${report.sections.github_activity.issues.opened} opened, ${report.sections.github_activity.issues.closed} closed\n`;

		if (report.sections.github_activity.repositories.length > 0) {
			slackMessage += `• **Top Repos:** ${report.sections.github_activity.repositories.slice(0, 3).map(r => r.name).join(', ')}\n`;
		}
		slackMessage += '\n';

		// Team Activity
		slackMessage += '## 👥 Team Activity\n';
		slackMessage += `${report.sections.team_activity.summary}\n`;

		if (report.sections.team_activity.top_contributors.length > 0) {
			slackMessage += '**Top Contributors:**\n';
			for (const contributor of report.sections.team_activity.top_contributors.slice(0, 5)) {
				slackMessage += `• ${contributor.name} (${contributor.activity_count} events)\n`;
			}
		}
		slackMessage += '\n';

		// Action Items
		if (report.sections.action_items.items.length > 0) {
			slackMessage += `## 🚨 Action Items (${report.sections.action_items.items.length})\n`;

			const urgentItems = report.sections.action_items.items.filter(item => item.priority === 'urgent');
			const highItems = report.sections.action_items.items.filter(item => item.priority === 'high');

			if (urgentItems.length > 0) {
				slackMessage += `**🔴 Urgent (${urgentItems.length}):**\n`;
				for (const item of urgentItems.slice(0, 3)) {
					slackMessage += `• ${item.title}\n`;
				}
			}

			if (highItems.length > 0) {
				slackMessage += `**🟡 High Priority (${highItems.length}):**\n`;
				for (const item of highItems.slice(0, 3)) {
					slackMessage += `• ${item.title}\n`;
				}
			}
			slackMessage += '\n';
		}

		// Trends
		if (report.sections.trends.velocity_change !== 'No previous data for comparison') {
			slackMessage += '## 📈 Trends\n';
			slackMessage += `• **Velocity Change:** ${report.sections.trends.velocity_change}\n`;

			if (report.sections.trends.new_patterns.length > 0) {
				slackMessage += `• **New Patterns:** ${report.sections.trends.new_patterns.join(', ')}\n`;
			}
			slackMessage += '\n';
		}

		// Footer
		slackMessage += '---';
		slackMessage += `📅 Report Period: ${report.period.start.toLocaleDateString()} - ${report.period.end.toLocaleDateString()}\n`;
		slackMessage += `⚡ Generated in ${report.metadata.processing_time_ms}ms | Quality Score: ${Math.round(report.metadata.data_quality_score * 100)}%`;

		return slackMessage;
	}
}
