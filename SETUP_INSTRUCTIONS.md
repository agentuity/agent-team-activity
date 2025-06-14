# Activity Monitor Agent - Setup Instructions

## What's Been Built

I've successfully implemented a comprehensive Activity Monitor Agent with the following architecture:

### 🏗️ **Core Architecture**
- **Multi-Model AI System**: Groq (Llama) for fast data processing + Claude 4 for deep analysis
- **Cross-Platform Integration**: GitHub, Slack, Linear, Discord APIs
- **Intelligent Memory**: Agentuity KV store for persistent context and trend analysis
- **Agentic Workflow**: Iterative loops for correlation discovery and insight generation

### 📁 **File Structure**
```
src/agents/ActivityMonitor/
├── index.ts                    # Main agent entry point
├── types.ts                    # Comprehensive type definitions
└── services/
    ├── MemoryService.ts        # KV store management & context persistence
    ├── GitHubService.ts        # GitHub API integration
    ├── SlackService.ts         # Slack API integration + report posting
    ├── LinearService.ts        # Linear GraphQL integration
    ├── DiscordService.ts       # Discord API integration
    ├── DataProcessor.ts        # Groq-powered data correlation
    └── ReportGenerator.ts      # Claude-powered report generation
```

### 🔥 **Key Features Implemented**

#### **Data Collection & Processing**
- ✅ **GitHub Activity**: PRs, issues, releases, reviews, deployments
- ✅ **Slack Monitoring**: Messages, threads, files, reactions, mentions
- ✅ **Linear Tracking**: Issue lifecycle, assignments, project progress
- ✅ **Discord Integration**: Server activity, voice participation, bot interactions
- ✅ **Smart Correlation**: Cross-platform relationship detection using AI

#### **Intelligence & Analysis**
- ✅ **Contributor Profiling**: Activity patterns, expertise areas, platform preferences
- ✅ **Cross-Platform Correlation**: Link GitHub PRs → Linear issues → Slack discussions
- ✅ **Action Item Detection**: Review-needed PRs, blocked issues, overdue tasks
- ✅ **Trend Analysis**: Velocity changes, bottleneck detection, success patterns
- ✅ **Priority Assessment**: Urgent vs low-priority activity classification

#### **Memory & Context**
- ✅ **7-Day Context Window**: Rolling memory for trend analysis
- ✅ **Contributor Relationships**: Cross-day profile building
- ✅ **Project Mapping**: Repository-to-Linear-to-Slack associations
- ✅ **Velocity Tracking**: Daily PR/issue counts, review times

#### **Reporting & Output**
- ✅ **Slack-Formatted Reports**: Rich markdown with sections and priorities
- ✅ **Executive Summaries**: AI-generated high-level insights
- ✅ **Actionable Insights**: Specific items requiring attention
- ✅ **Performance Metrics**: Processing time, data quality scores

## 🚀 **Setup Instructions**

### 1. Environment Variables
Create a `.env` file with your API credentials:

```bash
# GitHub Integration
GITHUB_TOKEN=ghp_your_github_personal_access_token
GITHUB_ORG=your_github_organization

# Slack Integration  
SLACK_BOT_TOKEN=xoxb-your-slack-bot-token
SLACK_REPORT_CHANNEL=C1234567890  # Channel ID for reports

# Linear Integration
LINEAR_API_KEY=lin_api_your_linear_api_key

# Discord Integration (Optional)
DISCORD_BOT_TOKEN=your_discord_bot_token
DISCORD_GUILD_ID=your_discord_server_id

```

### 2. API Permissions Required

#### **GitHub** (Personal Access Token)
- `repo` - Access to repositories
- `read:org` - Organization member access
- `read:user` - User profile access

#### **Slack** (Bot Token)
- `channels:history` - Read channel messages
- `channels:read` - List channels
- `chat:write` - Post reports
- `users:read` - Get user information

#### **Linear** (API Key)
- Read access to issues, projects, teams
- GraphQL API access

#### **Discord** (Bot Token) 
- `Read Messages` permission
- `View Channels` permission
- Access to target server

### 3. Deployment

#### **Local Development**
```bash
bun run dev
# Agent will be available at http://localhost:3000
```

#### **Production Deployment**
```bash
bun run build
agentuity deploy
```

### 4. Triggering the Agent

#### **External Cron Job** (Recommended)
```bash
# Daily at 9 AM EST
0 9 * * * curl -X POST https://your-agent-url.agentuity.dev \
  -H "Content-Type: application/json" \
  -d '{"trigger": "daily_report"}'
```

#### **Manual Trigger**
```bash
curl -X POST https://your-agent-url.agentuity.dev \
  -H "Content-Type: application/json" \
  -d '{"action": "generate_report"}'
```

## 📊 **What You'll Get**

### **Sample Daily Report Sections**

#### **Executive Summary**
"Daily activity report processed 156 events from 12 contributors across 8 repositories. 3 high-priority items require attention."

#### **GitHub Activity**
- **PRs**: 5 opened, 3 merged, 2 need review
- **Issues**: 4 opened, 6 closed
- **Top Repos**: frontend-app, api-service, mobile-client

#### **Action Items**
- 🔴 **Urgent**: Security PR #234 needs immediate review
- 🟡 **High Priority**: Feature branch blocked on Linear API-123
- 📋 **Review Needed**: Mobile PR #567 awaiting design approval

#### **Team Activity**
- **Top Contributors**: Alice (23 events), Bob (18 events), Carol (15 events)
- **Cross-Platform**: 4 contributors active on multiple platforms
- **Correlations**: 6 GitHub-Linear connections detected

#### **Trends**
- **Velocity**: +2 PRs, +1 issues vs yesterday
- **New Patterns**: Increased Discord activity around deployment

## 🔧 **Customization Options**

### **Adjust Monitoring Scope**
Edit service constructors in `index.ts`:
```typescript
// Monitor specific Slack channels
const slackService = new SlackService(token, ['C1234', 'C5678'], reportChannel);

// Monitor specific GitHub repos
const githubService = new GitHubService(token, 'your-org');
```

### **Modify Report Format**
Edit `ReportGenerator.ts` `formatForSlack()` method to customize:
- Section ordering
- Slack formatting
- Highlight criteria
- Action item categorization

### **Tune AI Analysis**
Edit prompts in `DataProcessor.ts` and `ReportGenerator.ts`:
- Correlation detection sensitivity
- Priority classification rules
- Insight generation focus areas

## 🎯 **Next Steps**

1. **Set up API credentials** in `.env`
2. **Deploy the agent** to Agentuity
3. **Configure external cron** for daily triggers
4. **Monitor first few reports** and tune as needed
5. **Scale to additional platforms** (Jira, Notion, etc.)

## 💡 **Pro Tips**

- **Start Small**: Enable one platform at a time to verify data quality
- **Tune Gradually**: Adjust correlation sensitivity based on false positives
- **Monitor Memory**: KV store automatically cleans up after 7 days
- **Rate Limits**: Built-in exponential backoff for all API calls
- **Error Handling**: Graceful degradation if any platform is unavailable

The agent is designed to be **production-ready** with comprehensive error handling, memory management, and performance optimization! 🚀
