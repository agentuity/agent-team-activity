import type { AgentContext, AgentRequest, AgentResponse } from '@agentuity/sdk';

import { GitHubService } from './services/GitHubService';
import { SlackService } from './services/SlackService';
import { LinearService } from './services/LinearService';
import { DataProcessor } from './services/DataProcessor';
import { ReportGenerator } from './services/ReportGenerator';
import { MemoryService } from './services/MemoryService';

export const welcome = () => {
	return {
		welcome:
			"Welcome to the Activity Monitor Agent! I aggregate and analyze daily activity across GitHub, Slack, and Linear to provide intelligent team insights.",
		prompts: [
			{
				data: 'Generate daily activity report',
				contentType: 'text/plain',
			},
			{
				data: 'Show pending action items',
				contentType: 'text/plain',
			},
			{
				data: 'Analyze team velocity trends',
				contentType: 'text/plain',
			},
		],
	};
};

export default async function Agent(
	req: AgentRequest,
	resp: AgentResponse,
	ctx: AgentContext
) {
	try {
		const startTime = Date.now();
		ctx.logger.info('Starting activity monitoring agent...');

		const memoryService = new MemoryService(ctx.kv);
		const githubService = new GitHubService(process.env.GITHUB_TOKEN || '');
		const slackService = new SlackService(process.env.SLACK_BOT_TOKEN || '');
		const linearService = new LinearService(process.env.LINEAR_API_KEY || '');

		const dataProcessor = new DataProcessor(memoryService);
		const reportGenerator = new ReportGenerator(memoryService);

		const now = new Date();
		const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

		ctx.logger.info(`Collecting activity from ${yesterday.toISOString()} to ${now.toISOString()}`);

		const [githubData, slackData, linearData] = await Promise.allSettled([
			githubService.getActivity(yesterday, now),
			slackService.getActivity(yesterday, now),
			linearService.getActivity(yesterday, now),
		]);

		if (githubData.status === 'rejected') ctx.logger.error('GitHub data collection failed:', githubData.reason);
		if (slackData.status === 'rejected') ctx.logger.error('Slack data collection failed:', slackData.reason);
		if (linearData.status === 'rejected') ctx.logger.error('Linear data collection failed:', linearData.reason);

		const rawData = {
			github: githubData.status === 'fulfilled' ? githubData.value : [],
			slack: slackData.status === 'fulfilled' ? slackData.value : [],
			linear: linearData.status === 'fulfilled' ? linearData.value : [],
		};

		ctx.logger.info(`Collected ${rawData.github.length} GitHub events, ${rawData.slack.length} Slack events, ${rawData.linear.length} Linear events`);

		const processedData = await dataProcessor.processAndCorrelate(rawData);
		const report = await reportGenerator.generateDailyReport(processedData, yesterday, now);

		await memoryService.updateDailyContext(processedData, report);
		await memoryService.storeReport(report);

		const slackMessage = await reportGenerator.formatForSlack(report);
		const slackResult = await slackService.postReport(slackMessage);

		const processingTime = Date.now() - startTime;
		ctx.logger.info(`Activity monitoring completed in ${processingTime}ms`);

		return resp.text(`Daily activity report generated and posted to Slack successfully!\n\n**Processing Summary:**\n- GitHub events: ${rawData.github.length}\n- Slack events: ${rawData.slack.length}\n- Linear events: ${rawData.linear.length}\n- Processing time: ${processingTime}ms\n- Slack message ID: ${slackResult.ts}`);

	} catch (error) {
		ctx.logger.error('Error running activity monitor agent:', error);
		const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
		return resp.text(`Error generating activity report: ${errorMessage}`);
	}
}
