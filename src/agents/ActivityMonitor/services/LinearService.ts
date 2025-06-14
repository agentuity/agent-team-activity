import { LinearClient } from '@linear/sdk';
import type { ActivityEvent } from '../types';

export class LinearService {
  private client: LinearClient;

  constructor(apiKey: string) {
    this.client = new LinearClient({ apiKey });
  }

  async getActivity(startDate: Date, endDate: Date): Promise<ActivityEvent[]> {
    const events: ActivityEvent[] = [];

    try {
      // Get issues updated within the time range using Linear SDK
      const issues = await this.client.issues({
        filter: {
          updatedAt: { 
            gte: startDate,
            lte: endDate 
          }
        },
        first: 100
      });

      for (const issue of issues.nodes) {
        events.push(...await this.convertIssueToEvents(issue));
      }

      return events.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    } catch (error) {
      console.error('Error getting Linear activity:', error);
      return [];
    }
  }

  private async convertIssueToEvents(issue: any): Promise<ActivityEvent[]> {
    const events: ActivityEvent[] = [];

    try {
      // Get the issue properties
      const state = await issue.state;
      const assignee = await issue.assignee;
      const creator = await issue.creator;
      const team = await issue.team;
      const project = await issue.project;
      const cycle = await issue.cycle;
      const labels = await issue.labels();

      const priority = this.mapLinearPriorityToStandard(issue.priority || 0);
      const isCompleted = state?.type === 'completed' || !!issue.completedAt;
      const isBacklog = state?.type === 'backlog';
      const isActive = state?.type === 'started' || state?.type === 'inProgress';

      // Determine event subtype based on issue state and timing
      let subtype = 'issue_updated';
      const createdRecently = new Date(issue.createdAt).getTime() > (Date.now() - 24 * 60 * 60 * 1000);
      
      if (createdRecently) {
        subtype = 'issue_created';
      } else if (isCompleted && issue.completedAt) {
        subtype = 'issue_completed';
      } else if (assignee) {
        subtype = 'issue_assigned';
      }

      const labelNames = labels?.nodes?.map((l: any) => l.name) || [];

      const baseEvent: ActivityEvent = {
        id: `linear_${issue.id}`,
        type: 'linear',
        subtype,
        timestamp: new Date(issue.updatedAt),
        author: {
          id: assignee?.id || creator?.id || 'unknown',
          name: assignee?.name || creator?.name || 'Unknown',
          email: assignee?.email || creator?.email,
          avatar: assignee?.avatarUrl || creator?.avatarUrl,
        },
        title: `${issue.identifier}: ${issue.title}`,
        description: issue.description || '',
        url: issue.url || '',
        project: project?.name,
        priority,
        status: isCompleted ? 'closed' : 'open',
        labels: labelNames,
        assignees: assignee ? [assignee.name] : [],
        metadata: {
          issue_id: issue.id,
          identifier: issue.identifier,
          team: team?.name,
          team_key: team?.key,
          state: state?.name,
          state_type: state?.type,
          estimate: issue.estimate,
          cycle: cycle?.name,
          created_at: issue.createdAt,
          completed_at: issue.completedAt,
          creator: creator?.name,
        },
      };

      events.push(baseEvent);

      // Add additional events for state changes
      if (isCompleted && issue.completedAt) {
        events.push({
          ...baseEvent,
          id: `linear_completed_${issue.id}`,
          subtype: 'issue_completed',
          timestamp: new Date(issue.completedAt),
          title: `✅ Completed: ${issue.identifier}: ${issue.title}`,
          priority: 'medium',
        });
      }

      // Add high priority event for urgent issues
      if (priority === 'urgent' && !isCompleted) {
        events.push({
          ...baseEvent,
          id: `linear_urgent_${issue.id}`,
          subtype: 'urgent_issue',
          title: `🚨 Urgent: ${issue.identifier}: ${issue.title}`,
          priority: 'urgent',
        });
      }
    } catch (error) {
      console.error('Error converting Linear issue to events:', error);
    }

    return events;
  }

  private mapLinearPriorityToStandard(linearPriority: number): 'low' | 'medium' | 'high' | 'urgent' {
    // Linear priorities: 0 = No priority, 1 = Urgent, 2 = High, 3 = Normal, 4 = Low
    switch (linearPriority) {
      case 1:
        return 'urgent';
      case 2:
        return 'high';
      case 3:
        return 'medium';
      case 4:
        return 'low';
      default:
        return 'medium';
    }
  }

  /**
   * Get team information
   */
  async getTeams(): Promise<Array<{ id: string; name: string; key: string }>> {
    try {
      const teams = await this.client.teams();
      const result = [];
      
      for (const team of teams.nodes) {
        result.push({
          id: team.id,
          name: team.name,
          key: team.key,
        });
      }
      
      return result;
    } catch (error) {
      console.error('Error getting Linear teams:', error);
      return [];
    }
  }

  /**
   * Get projects
   */
  async getProjects(): Promise<Array<{ id: string; name: string; description?: string }>> {
    try {
      const projects = await this.client.projects();
      const result = [];
      
      for (const project of projects.nodes) {
        result.push({
          id: project.id,
          name: project.name,
          description: project.description || undefined,
        });
      }
      
      return result;
    } catch (error) {
      console.error('Error getting Linear projects:', error);
      return [];
    }
  }

  /**
   * Get pending action items from Linear
   */
  async getPendingActionItems(): Promise<Array<{
    type: string;
    title: string;
    url: string;
    assignee?: string;
    priority: string;
  }>> {
    try {
      const issues = await this.client.issues({
        filter: {
          state: { 
            type: { 
              nin: ['completed', 'canceled'] 
            } 
          },
          assignee: { 
            null: false 
          }
        },
        first: 50
      });
      
      const result = [];
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);

      for (const issue of issues.nodes) {
        if (new Date(issue.updatedAt) < weekAgo) {
          const assignee = await issue.assignee;
          result.push({
            type: 'stale_issue',
            title: `${issue.identifier}: ${issue.title}`,
            url: issue.url,
            assignee: assignee?.name,
            priority: this.mapLinearPriorityToStandard(issue.priority || 0),
          });
        }
      }
      
      return result;
    } catch (error) {
      console.error('Error getting pending Linear action items:', error);
      return [];
    }
  }
}
