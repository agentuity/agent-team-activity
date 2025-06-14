<div align="center">
    <img src="https://raw.githubusercontent.com/agentuity/cli/refs/heads/main/.github/Agentuity.png" alt="Agentuity" width="100"/> <br/>
    <strong>Build Agents, Not Infrastructure</strong> <br/>
	<br/>
		<a target="_blank" href="https://app.agentuity.com/deploy" alt="Agentuity">
			<img src="https://app.agentuity.com/img/deploy.svg" /> 
		</a>

<br />
</div>

# 📊 Daily Activity Monitor Agent

A sophisticated AI-powered team activity monitoring agent built with **Agentuity** and **OpenAI o-3**, delivering intelligent daily reports that keep development teams informed about GitHub, Slack, and Linear activity with actionable insights and prioritized action items.

## ✨ Key Features

- 🧠 **Intelligent LLM Analysis** - OpenAI o-3 analyzes raw activity data to generate contextual, actionable reports
- 📈 **Multi-Platform Integration** - GitHub PRs/issues, Slack messages, and Linear tickets in unified reports  
- 🎯 **Smart Categorization** - AI categorizes PR impact (breaking/feature/bugfix), issue urgency, and review priorities
- 💼 **Actionable Insights** - Highlights PRs needing review, critical issues, and team collaboration patterns
- ⚡ **Real-Time Processing** - Fast data collection with Groq-powered correlation analysis
- 🔗 **Clickable Links** - Every PR and issue includes direct links for easy navigation
- 📋 **Developer-Focused** - Reports designed for busy developers who need to stay informed quickly
- 🚀 **Agentuity Native** - Built for seamless deployment on Agentuity platform

## 🔄 How It Works

The agent collects activity from GitHub, Slack, and Linear, then uses Groq (Llama 3.1) for fast data correlation and OpenAI o-3 for intelligent analysis. It generates comprehensive Slack reports with categorized PRs, prioritized issues, team activity patterns, and specific action items with clickable links.

## 🚀 Quick Start with Agentuity

### Prerequisites

- **Bun**: 1.2.4+
- **Agentuity CLI**: Install from [agentuity.dev](https://agentuity.dev)

### Authentication

```bash
agentuity login
```

### Development Mode

Set up your environment variables:

```bash
agentuity env set GITHUB_TOKEN your_github_token
agentuity env set GITHUB_ORG your_github_org
agentuity env set SLACK_BOT_TOKEN your_slack_bot_token  
agentuity env set SLACK_REPORT_CHANNEL your_channel_id
agentuity env set LINEAR_API_KEY your_linear_key
```

Start the agent in development mode for real-time testing:

```bash
agentuity dev
```

This launches the Agentuity Console where you can test the agent and see generated reports.

### Production Deployment

Deploy your agent to the Agentuity cloud platform:

```bash
agentuity deploy
```

### Example Usage

The agent automatically generates daily reports when triggered:

```bash
curl -X POST https://your-agent-url \
  -H "Content-Type: application/json" \
  -d '{"message": "Generate daily activity report"}'
```

**Sample Output:**
- 🚀 **Merged PRs** with impact categorization (🔥 breaking, ✨ features, 🐛 fixes)
- 👀 **PRs Needing Review** with age indicators and requested reviewers
- 🎯 **New Issues** categorized by urgency with assignment status
- 👥 **Team Activity** showing top contributors and collaboration patterns
- 🚨 **Action Items** prioritized by urgency with assignees

## 🏗️ Deployment with Agentuity

### Local Development
```bash
# Start development server
agentuity dev

# Test the agent
curl -X POST http://localhost:3500/agent_id \
  -H "Content-Type: application/json" \
  -d '{"message": "Generate daily activity report"}'
```

### Production Deployment
```bash
# Deploy to Agentuity cloud
agentuity deploy

# Set up scheduled reports (create a cron for your agent in app.agentuity.com)
# POST to your agent URL daily at desired time
```


## 🤝 Contributing

This is a production-ready activity monitoring agent built with Agentuity, OpenAI o-3, and Groq. The agent uses intelligent LLM analysis to replace hundreds of lines of deterministic categorization logic.

## 📚 Documentation

- [Agentuity Documentation](https://agentuity.dev/docs)
- [Agentuity TypeScript SDK](https://agentuity.dev/SDKs/javascript)

## 🆘 Support

- [Agentuity Discord Community](https://discord.com/invite/vtn3hgUfuc)

---

<div align="center">
<strong>Built with ❤️ using Agentuity, OpenAI o-3, and Groq for intelligent team insights</strong>
</div>
