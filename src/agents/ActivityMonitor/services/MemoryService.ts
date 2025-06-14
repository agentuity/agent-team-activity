import type { MemoryContext, ProcessedData, DailyReport, ContributorProfile } from '../types';
import { MemoryContextSchema } from '../types';

export class MemoryService {
	private kv: any;

	constructor(kv: any) {
		this.kv = kv;
	}

	/**
	 * Get memory context for a specific date
	 */
	async getContext(date: Date): Promise<MemoryContext | null> {
		const dateKey = this.getDateKey(date);

		try {
			const data = await this.kv.get(`context:${dateKey}`);
			if (!data) return null;

			// Handle case where data might already be parsed or is malformed
			let parsed;
			if (typeof data === 'string') {
				parsed = JSON.parse(data);
			} else if (typeof data === 'object') {
				parsed = data;
			} else {
				console.warn(`Invalid data type for context ${dateKey}:`, typeof data);
				return null;
			}

			return MemoryContextSchema.parse(parsed);
		} catch (error) {
			console.error(`Error getting context for ${dateKey}:`, error);
			// Clear the corrupted data
			try {
				await this.kv.delete(`context:${dateKey}`);
			} catch (deleteError) {
				console.error(`Error deleting corrupted context for ${dateKey}:`, deleteError);
			}
			return null;
		}
	}

	/**
	 * Update daily context with new insights
	 */
	async updateDailyContext(processedData: ProcessedData, report: DailyReport): Promise<void> {
		const dateKey = this.getDateKey(report.date);

		// Get existing context or create new one
		const context = await this.getContext(report.date) || this.createEmptyContext(dateKey);

		// Update contributor profiles
		for (const contributor of processedData.contributors) {
			context.contributor_profiles[contributor.id] = contributor;
		}

		// Update project relationships
		this.updateProjectRelationships(context, processedData);

		// Update trending topics
		context.trending_topics = await this.extractTrendingTopics(processedData);

		// Update velocity metrics
		context.velocity_metrics = {
			daily_pr_count: processedData.summary_stats.events_by_type.pr_opened || 0,
			daily_issue_count: processedData.summary_stats.events_by_type.issue_opened || 0,
			avg_review_time_hours: await this.calculateAvgReviewTime(processedData),
			deployment_frequency: processedData.summary_stats.events_by_type.deployment || 0,
		};

		// Update action items history
		context.action_items_history.push({
			date: dateKey,
			resolved_count: processedData.action_items.filter(item => item.type === 'review_needed').length,
			new_count: processedData.action_items.length,
			overdue_count: processedData.action_items.filter(item => item.type === 'overdue').length,
		});

		// Keep only last 7 days of action items history
		context.action_items_history = context.action_items_history.slice(-7);

		// Save updated context
		await this.kv.set(`context:${dateKey}`, JSON.stringify(context));
	}

	/**
	 * Get contributor profile across multiple days
	 */
	async getContributorProfile(contributorId: string): Promise<ContributorProfile | null> {
		const recentDates = this.getRecentDates(7);

		for (const date of recentDates) {
			const context = await this.getContext(date);
			if (context?.contributor_profiles[contributorId]) {
				return context.contributor_profiles[contributorId];
			}
		}

		return null;
	}

	/**
	 * Get historical velocity metrics for trend analysis
	 */
	async getVelocityTrends(days = 7): Promise<Array<{ date: string; metrics: any }>> {
		const recentDates = this.getRecentDates(days);
		const trends = [];

		for (const date of recentDates) {
			const context = await this.getContext(date);
			if (context?.velocity_metrics) {
				trends.push({
					date: this.getDateKey(date),
					metrics: context.velocity_metrics,
				});
			}
		}

		return trends;
	}

	/**
	 * Get project relationships and cross-references
	 */
	async getProjectRelationships(): Promise<Record<string, string[]>> {
		const context = await this.getContext(new Date());
		return context?.project_relationships || {};
	}

	/**
	 * Clean up old memory data (older than 7 days)
	 */
	async cleanup(): Promise<void> {
		const cutoffDate = new Date();
		cutoffDate.setDate(cutoffDate.getDate() - 7);

		const oldDateKey = this.getDateKey(cutoffDate);

		try {
			// In a real implementation, you'd want to list and delete old keys
			// For now, we just delete the specific old context
			await this.kv.delete(`context:${oldDateKey}`);
		} catch (error) {
			console.error('Error during cleanup:', error);
		}
	}

	/**
	 * Store daily report for future reference
	 */
	async storeReport(report: DailyReport): Promise<void> {
		const dateKey = this.getDateKey(report.date);
		await this.kv.set(`report:${dateKey}`, JSON.stringify(report));
	}

	/**
	 * Get previous day's report for comparison
	 */
	async getPreviousReport(currentDate: Date): Promise<DailyReport | null> {
		const previousDate = new Date(currentDate);
		previousDate.setDate(previousDate.getDate() - 1);
		const dateKey = this.getDateKey(previousDate);

		try {
			const data = await this.kv.get(`report:${dateKey}`);
			if (!data) return null;

			return JSON.parse(data);
		} catch (error) {
			console.error(`Error getting previous report for ${dateKey}:`, error);
			return null;
		}
	}

	// Private helper methods
	private getDateKey(date: Date): string {
		return date.toISOString().split('T')[0] || ''; // YYYY-MM-DD format
	}

	private getRecentDates(days: number): Date[] {
		const dates = [];
		for (let i = 0; i < days; i++) {
			const date = new Date();
			date.setDate(date.getDate() - i);
			dates.push(date);
		}
		return dates;
	}

	private createEmptyContext(dateKey: string): MemoryContext {
		return {
			date: dateKey,
			contributor_profiles: {},
			project_relationships: {},
			trending_topics: [],
			velocity_metrics: {
				daily_pr_count: 0,
				daily_issue_count: 0,
				avg_review_time_hours: 0,
				deployment_frequency: 0,
			},
			action_items_history: [],
		};
	}

	private updateProjectRelationships(context: MemoryContext, data: ProcessedData): void {
		// Build relationships between repositories, Linear projects, and Slack channels
		for (const event of data.events) {
			if (event.repository && event.project) {
				if (!context.project_relationships[event.project]) {
					context.project_relationships[event.project] = [];
				}
				if (!context.project_relationships[event.project]?.includes(event.repository)) {
					context.project_relationships[event.project]?.push(event.repository);
				}
			}

			if (event.repository && event.channel) {
				const key = `repo:${event.repository}`;
				if (!context.project_relationships[key]) {
					context.project_relationships[key] = [];
				}
				if (!context.project_relationships[key].includes(event.channel)) {
					context.project_relationships[key].push(event.channel);
				}
			}
		}
	}

	private async extractTrendingTopics(data: ProcessedData): Promise<Array<{ keyword: string; frequency: number; contexts: string[] }>> {
		// Simple keyword extraction from event titles and descriptions
		const keywords = new Map<string, { frequency: number; contexts: Set<string> }>();

		for (const event of data.events) {
			const text = `${event.title} ${event.description || ''}`.toLowerCase();
			const words = text.match(/\b\w{4,}\b/g) || []; // Words with 4+ characters

			for (const word of words) {
				if (!keywords.has(word)) {
					keywords.set(word, { frequency: 0, contexts: new Set() });
				}
				const entry = keywords.get(word)!;
				entry.frequency++;
				entry.contexts.add(event.type);
			}
		}

		// Convert to array and sort by frequency
		return Array.from(keywords.entries())
			.filter(([_, data]) => data.frequency > 2) // Only keywords mentioned more than twice
			.sort((a, b) => b[1].frequency - a[1].frequency)
			.slice(0, 10) // Top 10 trending topics
			.map(([keyword, data]) => ({
				keyword,
				frequency: data.frequency,
				contexts: Array.from(data.contexts),
			}));
	}

	private async calculateAvgReviewTime(data: ProcessedData): Promise<number> {
		// Simple calculation - in a real implementation, you'd track PR creation to merge time
		const prEvents = data.events.filter(e => e.type === 'github' && e.subtype?.includes('pr'));

		if (prEvents.length === 0) return 0;

		// Placeholder calculation - you'd want to implement proper time tracking
		return 24; // Assume 24 hour average for now
	}
}
