import type { ActivityEvent } from '../types';

interface DiscordMessage {
  id: string;
  type: number;
  content: string;
  channel_id: string;
  author: {
    id: string;
    username: string;
    discriminator: string;
    avatar?: string;
  };
  timestamp: string;
  edited_timestamp?: string;
  tts: boolean;
  mention_everyone: boolean;
  mentions: Array<{
    id: string;
    username: string;
  }>;
  attachments: Array<{
    id: string;
    filename: string;
    size: number;
    url: string;
  }>;
  reactions?: Array<{
    emoji: {
      id?: string;
      name: string;
    };
    count: number;
    me: boolean;
  }>;
  thread?: {
    id: string;
    name: string;
    parent_id: string;
  };
}

interface DiscordChannel {
  id: string;
  type: number;
  guild_id?: string;
  name?: string;
  topic?: string;
  parent_id?: string;
}

interface DiscordGuild {
  id: string;
  name: string;
  icon?: string;
}

export class DiscordService {
  private token: string;
  private baseUrl = 'https://discord.com/api/v10';
  private guildId: string;
  private channels: string[] = [];

  constructor(token: string, guildId: string = process.env.DISCORD_GUILD_ID || '', channels: string[] = []) {
    this.token = token;
    this.guildId = guildId;
    this.channels = channels;
  }

  async getActivity(startDate: Date, endDate: Date): Promise<ActivityEvent[]> {
    const events: ActivityEvent[] = [];

    if (!this.guildId) {
      console.warn('No Discord guild ID provided, skipping Discord activity');
      return events;
    }

    try {
      // Get guild info
      const guild = await this.getGuild();
      if (!guild) {
        console.error('Could not retrieve Discord guild information');
        return events;
      }

      // Get channels to monitor
      const channelsToMonitor = this.channels.length > 0 ? this.channels : await this.getGuildChannels();
      
      // Collect messages from all channels
      for (const channelId of channelsToMonitor) {
        try {
          const channelMessages = await this.getChannelMessages(channelId, startDate, endDate);
          const channelEvents = this.convertMessagesToEvents(channelMessages, channelId, guild);
          events.push(...channelEvents);
        } catch (error) {
          console.error(`Error getting Discord messages from channel ${channelId}:`, error);
        }
      }

      return events.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    } catch (error) {
      console.error('Error getting Discord activity:', error);
      return [];
    }
  }

  private async getGuild(): Promise<DiscordGuild | null> {
    try {
      const response = await this.makeRequest(`/guilds/${this.guildId}`);
      return response || null;
    } catch (error) {
      console.error('Error getting Discord guild:', error);
      return null;
    }
  }

  private async getGuildChannels(): Promise<string[]> {
    try {
      const channels: DiscordChannel[] = await this.makeRequest(`/guilds/${this.guildId}/channels`);
      
      // Filter for text channels only (type 0)
      return channels
        .filter(channel => channel.type === 0 && channel.name)
        .map(channel => channel.id);
    } catch (error) {
      console.error('Error getting Discord guild channels:', error);
      return [];
    }
  }

  private async getChannelMessages(channelId: string, startDate: Date, endDate: Date): Promise<DiscordMessage[]> {
    const messages: DiscordMessage[] = [];

    try {
      let lastMessageId = '';
      let hasMore = true;
      const limit = 100;

      while (hasMore && messages.length < 500) { // Limit total messages to prevent excessive API calls
        const params = new URLSearchParams({
          limit: limit.toString(),
        });

        if (lastMessageId) {
          params.append('before', lastMessageId);
        }

        const response: DiscordMessage[] = await this.makeRequest(
          `/channels/${channelId}/messages?${params.toString()}`
        );

        if (!response || response.length === 0) {
          hasMore = false;
          break;
        }

        // Filter messages within our time range
        const filteredMessages = response.filter(msg => {
          const msgTime = new Date(msg.timestamp);
          return msgTime >= startDate && msgTime <= endDate;
        });

        messages.push(...filteredMessages);

        // Check if we've gone too far back
        const oldestMessage = response[response.length - 1];
        if (oldestMessage && new Date(oldestMessage.timestamp) < startDate) {
          hasMore = false;
        }

        if (oldestMessage) {
          lastMessageId = oldestMessage.id;
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (error) {
      console.error(`Error getting Discord messages for channel ${channelId}:`, error);
    }

    return messages;
  }

  private convertMessagesToEvents(messages: DiscordMessage[], channelId: string, guild: DiscordGuild): ActivityEvent[] {
    const events: ActivityEvent[] = [];

    for (const message of messages) {
      if (message.author.id === this.getBotId()) continue; // Skip bot messages

      const timestamp = new Date(message.timestamp);
      const hasAttachments = message.attachments.length > 0;
      const hasReactions = (message.reactions?.length || 0) > 0;
      const mentions = message.mentions.map(m => m.username);

      // Determine priority based on message content
      const priority = this.determinePriority(message.content, mentions, hasAttachments, message.mention_everyone);

      const baseEvent: ActivityEvent = {
        id: `discord_${message.id}`,
        type: 'discord',
        subtype: 'message_sent',
        timestamp,
        author: {
          id: message.author.id,
          name: message.author.username,
          avatar: message.author.avatar ? 
            `https://cdn.discordapp.com/avatars/${message.author.id}/${message.author.avatar}.png` : 
            undefined,
        },
        title: this.generateMessageTitle(message.content, hasAttachments, mentions.length > 0),
        description: message.content,
        channel: channelId,
        labels: [],
        assignees: [],
        priority,
        metadata: {
          message_id: message.id,
          guild_id: guild.id,
          guild_name: guild.name,
          channel_id: channelId,
          mentions,
          has_attachments: hasAttachments,
          mention_everyone: message.mention_everyone,
          reactions: message.reactions || [],
          message_type: this.getMessageType(message.type),
        },
      };

      // Determine subtype
      if (message.thread) {
        events.push({
          ...baseEvent,
          subtype: 'thread_message',
          metadata: {
            ...baseEvent.metadata,
            thread_id: message.thread.id,
            thread_name: message.thread.name,
          },
        });
      } else if (hasAttachments) {
        events.push({
          ...baseEvent,
          subtype: 'file_shared',
          metadata: {
            ...baseEvent.metadata,
            attachments: message.attachments.map(a => ({
              filename: a.filename,
              size: a.size,
              url: a.url,
            })),
          },
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
            id: `discord_reaction_${message.id}_${reaction.emoji.name}`,
            type: 'discord',
            subtype: 'reaction_added',
            timestamp,
            author: {
              id: 'system',
              name: 'Discord Reactions',
            },
            title: `${reaction.count} ${reaction.emoji.name} reactions`,
            description: `Reaction ${reaction.emoji.name} added to message`,
            channel: channelId,
            labels: [],
            assignees: [],
            priority: 'low',
            metadata: {
              original_message_id: message.id,
              emoji_name: reaction.emoji.name,
              emoji_id: reaction.emoji.id,
              reaction_count: reaction.count,
            },
          });
        }
      }
    }

    return events;
  }

  private determinePriority(content: string, mentions: string[], hasAttachments: boolean, mentionEveryone: boolean): 'low' | 'medium' | 'high' | 'urgent' {
    const lowerContent = content.toLowerCase();
    
    if (mentionEveryone || lowerContent.includes('urgent') || lowerContent.includes('critical')) {
      return 'urgent';
    }
    
    if (mentions.length > 2 || lowerContent.includes('help') || lowerContent.includes('issue')) {
      return 'high';
    }
    
    if (hasAttachments || mentions.length > 0 || lowerContent.includes('review')) {
      return 'medium';
    }
    
    return 'low';
  }

  private generateMessageTitle(content: string, hasAttachments: boolean, hasMentions: boolean): string {
    const maxLength = 80;
    let title = content.trim();
    
    if (title.length > maxLength) {
      title = title.substring(0, maxLength) + '...';
    }
    
    if (hasAttachments) {
      title = `📎 ${title}`;
    }
    
    if (hasMentions) {
      title = `@️ ${title}`;
    }
    
    return title || 'Discord Message';
  }

  private getMessageType(type: number): string {
    const types: Record<number, string> = {
      0: 'default',
      1: 'recipient_add',
      2: 'recipient_remove',
      3: 'call',
      4: 'channel_name_change',
      5: 'channel_icon_change',
      6: 'channel_pinned_message',
      7: 'guild_member_join',
      8: 'user_premium_guild_subscription',
      9: 'user_premium_guild_subscription_tier_1',
      10: 'user_premium_guild_subscription_tier_2',
      11: 'user_premium_guild_subscription_tier_3',
      12: 'channel_follow_add',
      19: 'reply',
      20: 'chat_input_command',
      21: 'thread_starter_message',
    };
    
    return types[type] || 'unknown';
  }

  private getBotId(): string {
    // Extract bot ID from token (this is a simple approach)
    try {
      const tokenParts = this.token.split('.');
      if (tokenParts.length > 0 && tokenParts[0]) {
        return atob(tokenParts[0]) || '';
      }
    } catch (error) {
      // Fallback - could be configured separately
    }
    return '';
  }

  private async makeRequest(endpoint: string): Promise<any> {
    const url = `${this.baseUrl}${endpoint}`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bot ${this.token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Discord API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get channel information
   */
  async getChannelInfo(channelId: string): Promise<{ name: string; topic: string } | null> {
    try {
      const channel: DiscordChannel = await this.makeRequest(`/channels/${channelId}`);
      return {
        name: channel.name || 'Unknown Channel',
        topic: channel.topic || '',
      };
    } catch (error) {
      console.error(`Error getting Discord channel info for ${channelId}:`, error);
      return null;
    }
  }

  /**
   * Set the channels to monitor
   */
  setChannels(channels: string[]): void {
    this.channels = channels;
  }
}
