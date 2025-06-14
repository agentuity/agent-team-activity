import { z } from 'zod';

// Base activity event schema
export const ActivityEventSchema = z.object({
  id: z.string(),
  type: z.enum(['github', 'slack', 'linear', 'discord']),
  subtype: z.string(), // pr_opened, issue_closed, message_sent, etc.
  timestamp: z.date(),
  author: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string().optional(),
    avatar: z.string().optional(),
  }),
  title: z.string(),
  description: z.string().optional(),
  url: z.string().optional(),
  metadata: z.record(z.any()), // Platform-specific data
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  status: z.enum(['open', 'closed', 'pending', 'merged', 'draft']).optional(),
  labels: z.array(z.string()).default([]),
  assignees: z.array(z.string()).default([]),
  repository: z.string().optional(),
  project: z.string().optional(),
  channel: z.string().optional(),
});

export type ActivityEvent = z.infer<typeof ActivityEventSchema>;

// GitHub specific schemas
export const GitHubPRSchema = z.object({
  type: z.literal('github'),
  subtype: z.enum(['pr_opened', 'pr_closed', 'pr_merged', 'pr_review_requested', 'pr_reviewed', 'pr_draft']),
  pr_number: z.number(),
  repository: z.string(),
  base_branch: z.string(),
  head_branch: z.string(),
  additions: z.number(),
  deletions: z.number(),
  changed_files: z.number(),
  reviewers: z.array(z.string()),
  review_status: z.enum(['pending', 'approved', 'changes_requested', 'commented']).optional(),
});

export const GitHubIssueSchema = z.object({
  type: z.literal('github'),
  subtype: z.enum(['issue_opened', 'issue_closed', 'issue_assigned', 'issue_commented']),
  issue_number: z.number(),
  repository: z.string(),
  milestone: z.string().optional(),
});

// Slack specific schemas
export const SlackMessageSchema = z.object({
  type: z.literal('slack'),
  subtype: z.enum(['message_sent', 'thread_reply', 'file_shared', 'reaction_added']),
  channel: z.string(),
  channel_name: z.string(),
  thread_ts: z.string().optional(),
  reaction_count: z.number().optional(),
  mentions: z.array(z.string()).default([]),
  has_files: z.boolean().default(false),
});

// Linear specific schemas  
export const LinearIssueSchema = z.object({
  type: z.literal('linear'),
  subtype: z.enum(['issue_created', 'issue_updated', 'issue_completed', 'issue_assigned']),
  issue_id: z.string(),
  team: z.string(),
  project: z.string().optional(),
  state: z.string(),
  estimate: z.number().optional(),
  cycle: z.string().optional(),
});

// Discord specific schemas
export const DiscordMessageSchema = z.object({
  type: z.literal('discord'),
  subtype: z.enum(['message_sent', 'thread_created', 'voice_joined', 'reaction_added']),
  channel: z.string(),
  channel_name: z.string(),
  guild: z.string(),
  message_type: z.enum(['default', 'reply', 'thread_starter']).optional(),
  mentions: z.array(z.string()).default([]),
});

// Processed data schemas
export const CorrelationSchema = z.object({
  id: z.string(),
  events: z.array(z.string()), // Event IDs that are correlated
  type: z.enum(['pr_to_linear', 'slack_to_github', 'cross_platform_discussion']),
  confidence: z.number().min(0).max(1),
  description: z.string(),
  keywords: z.array(z.string()).default([]),
});

export type Correlation = z.infer<typeof CorrelationSchema>;

export const ContributorProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  platforms: z.object({
    github: z.string().optional(),
    slack: z.string().optional(),
    linear: z.string().optional(),
    discord: z.string().optional(),
  }),
  activity_patterns: z.object({
    most_active_hours: z.array(z.number()),
    preferred_platforms: z.array(z.string()),
    avg_daily_events: z.number(),
  }),
  expertise_areas: z.array(z.string()).max(5).default([]),
  recent_focus: z.array(z.string()).max(3).default([]),
});

export type ContributorProfile = z.infer<typeof ContributorProfileSchema>;

export const ActionItemSchema = z.object({
  id: z.string(),
  type: z.enum(['review_needed', 'blocked', 'overdue', 'requires_attention']),
  title: z.string(),
  description: z.string().nullable().optional(),
  url: z.string().optional(),
  assignee: z.string().nullable().optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
  created_at: z.date(),
  due_date: z.date().optional(),
  platform: z.enum(['github', 'slack', 'linear', 'discord']),
  repository: z.string().optional(),
  project: z.string().optional(),
});

export type ActionItem = z.infer<typeof ActionItemSchema>;

export const ProcessedDataSchema = z.object({
  events: z.array(ActivityEventSchema),
  correlations: z.array(CorrelationSchema),
  contributors: z.array(ContributorProfileSchema),
  action_items: z.array(ActionItemSchema),
  summary_stats: z.object({
    total_events: z.number(),
    events_by_platform: z.record(z.number()),
    events_by_type: z.record(z.number()),
    unique_contributors: z.number(),
    repositories_active: z.number(),
    projects_active: z.number(),
  }),
});

export type ProcessedData = z.infer<typeof ProcessedDataSchema>;

export const DailyReportSchema = z.object({
  date: z.date(),
  period: z.object({
    start: z.date(),
    end: z.date(),
  }),
  executive_summary: z.string(),
  highlights: z.array(z.string()),
  sections: z.object({
    github_activity: z.object({
      summary: z.string(),
      prs: z.object({
        opened: z.number(),
        merged: z.number(),
        reviews_needed: z.number(),
      }),
      issues: z.object({
        opened: z.number(),
        closed: z.number(),
        in_progress: z.number(),
      }),
      repositories: z.array(z.object({
        name: z.string(),
        activity_score: z.number(),
        top_contributors: z.array(z.string()),
      })),
    }),
    team_activity: z.object({
      summary: z.string(),
      top_contributors: z.array(z.object({
        name: z.string(),
        activity_count: z.number(),
        platforms: z.array(z.string()),
      })),
      collaboration_patterns: z.array(z.string()),
    }),
    action_items: z.object({
      summary: z.string(),
      items: z.array(ActionItemSchema),
      by_priority: z.record(z.number()),
    }),
    trends: z.object({
      summary: z.string(),
      velocity_change: z.string(),
      new_patterns: z.array(z.string()),
    }),
  }),
  metadata: z.object({
    processing_time_ms: z.number(),
    data_quality_score: z.number(),
    coverage: z.object({
      github: z.boolean(),
      slack: z.boolean(),
      linear: z.boolean(),
      discord: z.boolean(),
    }),
  }),
});

export type DailyReport = z.infer<typeof DailyReportSchema>;

// Memory schemas for KV storage
export const MemoryContextSchema = z.object({
  date: z.string(), // ISO date string for key
  contributor_profiles: z.record(ContributorProfileSchema), // keyed by contributor ID
  project_relationships: z.record(z.array(z.string())), // project -> related repos/channels
  trending_topics: z.array(z.object({
    keyword: z.string(),
    frequency: z.number(),
    contexts: z.array(z.string()),
  })),
  velocity_metrics: z.object({
    daily_pr_count: z.number(),
    daily_issue_count: z.number(),
    avg_review_time_hours: z.number(),
    deployment_frequency: z.number(),
  }),
  action_items_history: z.array(z.object({
    date: z.string(),
    resolved_count: z.number(),
    new_count: z.number(),
    overdue_count: z.number(),
  })),
});

export type MemoryContext = z.infer<typeof MemoryContextSchema>;

// API response types
export interface APIResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  rate_limit?: {
    remaining: number;
    reset_at: Date;
  };
}

// Service configuration types
export interface ServiceConfig {
  github: {
    token: string;
    org: string;
    repositories?: string[];
  };
  slack: {
    token: string;
    channels?: string[];
    include_dms: boolean;
  };
  linear: {
    api_key: string;
    teams?: string[];
  };
  discord: {
    token: string;
    guild_id: string;
    channels?: string[];
  };
}
