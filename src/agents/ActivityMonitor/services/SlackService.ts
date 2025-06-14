import type { ActivityEvent, DailyReport } from '../types';

interface SlackMessage {
  type: string;
  subtype?: string;
  user?: string;
  text: string;
  ts: string;
  channel?: string;
  thread_ts?: string;
  reply_count?: number;
  reactions?: Array<{
    name: string;
    count: number;
    users: string[];
  }>;
  files?: Array<{
    name: string;
    mimetype: string;
    url_private: string;
  }>;
}

interface SlackChannel {
  id: string;
  name: string;
  is_private: boolean;
  is_archived: boolean;
  is_member: boolean;
}

interface SlackUser {
  id: string;
  name: string;
  real_name: string;
  profile: {
    display_name: string;
    email: string;
    image_24: string;
    image_48: string;
  };
}

export class SlackService {
  private token: string;
  private baseUrl = 'https://slack.com/api';
  private channels: string[] = [];
  private reportChannel: string;

  constructor(token: string, channels: string[] = [], reportChannel: string = process.env.SLACK_REPORT_CHANNEL || '') {
    this.token = token;
    this.channels = channels;
    this.reportChannel = reportChannel;
  }

  async getActivity(startDate: Date, endDate: Date): Promise<ActivityEvent[]> {
    const events: ActivityEvent[] = [];

    try {
      // Get all channels if none specified
      const channelsToMonitor = this.channels.length > 0 ? this.channels : await this.getPublicChannels();
      
      // Get user list for name resolution
      const users = await this.getUsers();
      const userMap = new Map(users.map(u => [u.id, u]));

      // Collect messages from all channels
      for (const channelId of channelsToMonitor) {
        try {
          const channelMessages = await this.getChannelMessages(channelId, startDate, endDate);
          const channelEvents = this.convertMessagesToEvents(channelMessages, userMap, channelId);
          events.push(...channelEvents);
        } catch (error) {
          console.error(`Error getting messages from channel ${channelId}:`, error);
        }
      }

      return events.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    } catch (error) {
      console.error('Error getting Slack activity:', error);
      return [];
    }
  }

  private async getPublicChannels(): Promise<string[]> {
    try {
      const response = await this.makeRequest('conversations.list', {
        exclude_archived: true,
        types: 'public_channel',
        limit: 100,
      });

      if (response.ok) {
        return response.channels
          .filter((channel: SlackChannel) => channel.is_member)
          .map((channel: SlackChannel) => channel.id);
      }
    } catch (error) {
      console.error('Error getting public channels:', error);
    }
    return [];
  }

  private async getUsers(): Promise<SlackUser[]> {
    try {
      const response = await this.makeRequest('users.list', {});
      
      if (response.ok) {
        return response.members.filter((user: any) => !user.deleted && !user.is_bot);
      }
    } catch (error) {
      console.error('Error getting users:', error);
    }
    return [];
  }

  private async getChannelMessages(channelId: string, startDate: Date, endDate: Date): Promise<SlackMessage[]> {
    const messages: SlackMessage[] = [];
    const oldest = Math.floor(startDate.getTime() / 1000);
    const latest = Math.floor(endDate.getTime() / 1000);

    try {
      let cursor = '';
      let hasMore = true;

      while (hasMore) {
        const params: any = {
          channel: channelId,
          oldest: oldest.toString(),
          latest: latest.toString(),
          limit: 200,
          inclusive: true,
        };

        if (cursor) {
          params.cursor = cursor;
        }

        const response = await this.makeRequest('conversations.history', params);

        if (response.ok) {
          messages.push(...response.messages);
          hasMore = response.has_more;
          cursor = response.response_metadata?.next_cursor || '';
        } else {
          console.error(`Error getting messages for channel ${channelId}:`, response.error);
          break;
        }
      }
    } catch (error) {
      console.error(`Error getting channel messages for ${channelId}:`, error);
    }

    return messages;
  }

  private convertMessagesToEvents(messages: SlackMessage[], userMap: Map<string, SlackUser>, channelId: string): ActivityEvent[] {
    const events: ActivityEvent[] = [];

    for (const message of messages) {
      if (!message.user || message.subtype === 'bot_message') continue;

      const user = userMap.get(message.user);
      if (!user) continue;

      const timestamp = new Date(parseFloat(message.ts) * 1000);
      const isThread = !!message.thread_ts;
      const hasFiles = (message.files?.length || 0) > 0;
      const hasReactions = (message.reactions?.length || 0) > 0;

      // Extract mentions
      const mentions = this.extractMentions(message.text);
      
      // Determine message priority based on content
      const priority = this.determinePriority(message.text, mentions, hasFiles, hasReactions);

      const baseEvent: ActivityEvent = {
        id: `slack_${message.ts}_${channelId}`,
        type: 'slack',
        subtype: 'message_sent',
        timestamp,
        author: {
          id: user.id,
          name: user.profile.display_name || user.real_name || user.name,
          email: user.profile.email,
          avatar: user.profile.image_48,
        },
        title: this.generateMessageTitle(message.text, isThread, hasFiles),
        description: message.text,
        channel: channelId,
        labels: [],
        assignees: [],
        priority,
        metadata: {
          ts: message.ts,
          thread_ts: message.thread_ts,
          reply_count: message.reply_count || 0,
          reactions: message.reactions || [],
          has_files: hasFiles,
          mentions,
          channel_id: channelId,
        },
      };

      // Determine subtype based on message characteristics
      if (isThread) {
        events.push({
          ...baseEvent,
          subtype: 'thread_reply',
        });
      } else if (hasFiles) {
        events.push({
          ...baseEvent,
          subtype: 'file_shared',
        });
      } else if (hasReactions) {
        events.push({
          ...baseEvent,
          subtype: 'message_with_reactions',
        });
      } else {
        events.push({
          ...baseEvent,
          subtype: 'message_sent',
        });
      }

      // Add reaction events
      if (message.reactions) {
        for (const reaction of message.reactions) {
          events.push({
            id: `slack_reaction_${message.ts}_${reaction.name}`,
            type: 'slack',
            subtype: 'reaction_added',
            timestamp,
            author: {
              id: 'system',
              name: 'Slack Reactions',
            },
            title: `${reaction.count} ${reaction.name} reactions`,
            description: `Reaction ${reaction.name} added to message`,
            channel: channelId,
            labels: [],
            assignees: [],
            priority: 'low',
            metadata: {
              original_message_ts: message.ts,
              reaction_name: reaction.name,
              reaction_count: reaction.count,
              reaction_users: reaction.users,
            },
          });
        }
      }
    }

    return events;
  }

  private extractMentions(text: string): string[] {
    const mentions = [];
    const userMentions = text.match(/<@U[A-Z0-9]+>/g) || [];
    const channelMentions = text.match(/<#C[A-Z0-9]+\|[^>]+>/g) || [];
    
    mentions.push(...userMentions.map(m => m.replace(/[<@>]/g, '')));
    mentions.push(...channelMentions.map(m => m.split('|')[1]?.replace('>', '') || ''));
    
    return mentions;
  }

  private determinePriority(text: string, mentions: string[], hasFiles: boolean, hasReactions: boolean): 'low' | 'medium' | 'high' | 'urgent' {
    const lowerText = text.toLowerCase();
    
    // High priority indicators
    if (lowerText.includes('urgent') || lowerText.includes('asap') || lowerText.includes('critical')) {
      return 'urgent';
    }
    
    if (mentions.length > 3 || lowerText.includes('everyone') || lowerText.includes('@channel')) {
      return 'high';
    }
    
    if (hasFiles || mentions.length > 0 || lowerText.includes('review') || lowerText.includes('help')) {
      return 'medium';
    }
    
    return 'low';
  }

  private generateMessageTitle(text: string, isThread: boolean, hasFiles: boolean): string {
    const maxLength = 80;
    let title = text.replace(/<[^>]*>/g, '').trim(); // Remove Slack formatting
    
    if (title.length > maxLength) {
      title = title.substring(0, maxLength) + '...';
    }
    
    if (isThread) {
      title = `Thread: ${title}`;
    }
    
    if (hasFiles) {
      title = `📎 ${title}`;
    }
    
    return title || 'Message';
  }

  /**
   * Post the daily report to Slack
   */
  async postReport(report: string): Promise<{ ok: boolean; ts?: string; error?: string }> {
    if (!this.reportChannel) {
      throw new Error('No report channel configured');
    }

    try {
      const response = await this.makeRequest('chat.postMessage', {
        channel: this.reportChannel,
        text: 'Daily Activity Report',
        blocks: this.formatReportBlocks(report),
        unfurl_links: false,
        unfurl_media: false,
      });

      return {
        ok: response.ok,
        ts: response.ts,
        error: response.error,
      };
    } catch (error) {
      console.error('Error posting report to Slack:', error);
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private formatReportBlocks(report: string): any[] {
    // Convert Markdown report to Slack blocks
    const blocks = [];
    const sections = report.split('\n\n');

    for (const section of sections) {
      if (section.startsWith('# ')) {
        // Header
        blocks.push({
          type: 'header',
          text: {
            type: 'plain_text',
            text: section.replace('# ', '').trim(),
          },
        });
      } else if (section.startsWith('## ')) {
        // Subheader
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${section.replace('## ', '').trim()}*`,
          },
        });
      } else if (section.startsWith('- ')) {
        // List items
        const listItems = section.split('\n').filter(line => line.startsWith('- '));
        const listText = listItems.map(item => `• ${item.replace('- ', '')}`).join('\n');
        
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: listText,
          },
        });
      } else if (section.trim()) {
        // Regular text
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: section.trim(),
          },
        });
      }
    }

    // Add divider at the end
    blocks.push({
      type: 'divider',
    });

    return blocks;
  }

  private async makeRequest(method: string, params: any): Promise<any> {
    const url = `${this.baseUrl}/${method}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      throw new Error(`Slack API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get information about a specific channel
   */
  async getChannelInfo(channelId: string): Promise<{ name: string; topic: string } | null> {
    try {
      const response = await this.makeRequest('conversations.info', {
        channel: channelId,
      });

      if (response.ok) {
        return {
          name: response.channel.name,
          topic: response.channel.topic?.value || '',
        };
      }
    } catch (error) {
      console.error(`Error getting channel info for ${channelId}:`, error);
    }
    return null;
  }

  /**
   * Set the channels to monitor
   */
  setChannels(channels: string[]): void {
    this.channels = channels;
  }

  /**
   * Set the report channel
   */
  setReportChannel(channelId: string): void {
    this.reportChannel = channelId;
  }
}
