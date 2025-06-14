import type { ActivityEvent, APIResponse } from '../types';

interface GitHubPR {
  id: number;
  number: number;
  title: string;
  body: string;
  state: string;
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  user: {
    login: string;
    avatar_url: string;
  };
  html_url: string;
  base: {
    ref: string;
    repo: {
      name: string;
      full_name: string;
    };
  };
  head: {
    ref: string;
  };
  additions: number;
  deletions: number;
  changed_files: number;
  requested_reviewers: Array<{ login: string }>;
  assignees: Array<{ login: string }>;
  labels: Array<{ name: string }>;
  draft: boolean;
}

interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body: string;
  state: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  user: {
    login: string;
    avatar_url: string;
  };
  html_url: string;
  assignees: Array<{ login: string }>;
  labels: Array<{ name: string }>;
  milestone: {
    title: string;
  } | null;
  repository: {
    name: string;
    full_name: string;
  };
}

interface GitHubRelease {
  id: number;
  tag_name: string;
  name: string;
  body: string;
  created_at: string;
  published_at: string;
  author: {
    login: string;
    avatar_url: string;
  };
  html_url: string;
}

export class GitHubService {
  private token: string;
  private baseUrl = 'https://api.github.com';
  private org: string;

  constructor(token: string, org: string = process.env.GITHUB_ORG || '') {
    this.token = token;
    this.org = org;
  }

  async getActivity(startDate: Date, endDate: Date): Promise<ActivityEvent[]> {
    const events: ActivityEvent[] = [];

    try {
      // Get organization repositories
      const repos = await this.getOrgRepositories();
      
      
      const repoActivities = await Promise.allSettled(
        repos.map(repo => this.getRepositoryActivity(repo, startDate, endDate))
      );

      // Combine all successful results
      for (const result of repoActivities) {
        if (result.status === 'fulfilled') {
          events.push(...result.value);
        } else {
          console.error('Failed to get repo activity:', result.reason);
        }
      }

      return events.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    } catch (error) {
      console.error('Error getting GitHub activity:', error);
      return [];
    }
  }

  private async getOrgRepositories(): Promise<string[]> {
    try {
      const response = await this.makeRequest(`/orgs/${this.org}/repos?per_page=100&sort=updated`);
      return response.map((repo: any) => repo.full_name);
    } catch (error) {
      console.error('Error getting organization repositories:', error);
      return [];
    }
  }

  private async getRepositoryActivity(repoFullName: string, startDate: Date, endDate: Date): Promise<ActivityEvent[]> {
    const events: ActivityEvent[] = [];
    const since = startDate.toISOString();
    const until = endDate.toISOString();

    try {
      // Get PRs
      const prs = await this.getRepositoryPRs(repoFullName, since);
      events.push(...prs);

      // Get Issues
      const issues = await this.getRepositoryIssues(repoFullName, since);
      events.push(...issues);

      // Get Releases
      const releases = await this.getRepositoryReleases(repoFullName, since);
      events.push(...releases);

      // Get PR Reviews
      const reviews = await this.getRepositoryPRReviews(repoFullName, since);
      events.push(...reviews);

    } catch (error) {
      console.error(`Error getting activity for ${repoFullName}:`, error);
    }

    return events.filter(event => 
      event.timestamp >= startDate && event.timestamp <= endDate
    );
  }

  private async getRepositoryPRs(repoFullName: string, since: string): Promise<ActivityEvent[]> {
    const events: ActivityEvent[] = [];

    try {
      const prs: GitHubPR[] = await this.makeRequest(
        `/repos/${repoFullName}/pulls?state=all&sort=updated&direction=desc&per_page=50&since=${since}`
      );

      for (const pr of prs) {
        const baseEvent = {
          id: `github_pr_${pr.id}`,
          type: 'github' as const,
          timestamp: new Date(pr.updated_at),
          author: {
            id: pr.user.login,
            name: pr.user.login,
            avatar: pr.user.avatar_url,
          },
          title: pr.title,
          description: pr.body,
          url: pr.html_url,
          repository: repoFullName,
          labels: pr.labels?.map(l => l.name) || [],
          assignees: pr.assignees?.map(a => a.login) || [],
          metadata: {
            pr_number: pr.number,
            base_branch: pr.base.ref,
            head_branch: pr.head.ref,
            additions: pr.additions,
            deletions: pr.deletions,
            changed_files: pr.changed_files,
            reviewers: pr.requested_reviewers.map(r => r.login),
            draft: pr.draft,
          },
        };

        // Determine PR state and priority
        if (pr.merged_at) {
          events.push({
            ...baseEvent,
            subtype: 'pr_merged',
            status: 'merged',
            timestamp: new Date(pr.merged_at),
            priority: 'medium',
          });
        } else if (pr.state === 'closed') {
          events.push({
            ...baseEvent,
            subtype: 'pr_closed',
            status: 'closed',
            priority: 'low',
          });
        } else if (pr.draft) {
          events.push({
            ...baseEvent,
            subtype: 'pr_draft',
            status: 'draft',
            priority: 'low',
          });
        } else if (pr.requested_reviewers.length > 0) {
          events.push({
            ...baseEvent,
            subtype: 'pr_review_requested',
            status: 'pending',
            priority: 'high',
          });
        } else {
          events.push({
            ...baseEvent,
            subtype: 'pr_opened',
            status: 'open',
            priority: 'medium',
          });
        }
      }
    } catch (error) {
      console.error(`Error getting PRs for ${repoFullName}:`, error);
    }

    return events;
  }

  private async getRepositoryIssues(repoFullName: string, since: string): Promise<ActivityEvent[]> {
    const events: ActivityEvent[] = [];

    try {
      const issues: GitHubIssue[] = await this.makeRequest(
        `/repos/${repoFullName}/issues?state=all&sort=updated&direction=desc&per_page=50&since=${since}&filter=all`
      );

      // Filter out PRs (GitHub API returns PRs as issues)
      const actualIssues = issues.filter(issue => !issue.html_url.includes('/pull/'));

      for (const issue of actualIssues) {
        const priority = issue.labels.some(l => l.name.toLowerCase().includes('urgent')) ? 'urgent' :
                        issue.labels.some(l => l.name.toLowerCase().includes('high')) ? 'high' :
                        issue.labels.some(l => l.name.toLowerCase().includes('low')) ? 'low' : 'medium';

        events.push({
          id: `github_issue_${issue.id}`,
          type: 'github',
          subtype: issue.state === 'closed' ? 'issue_closed' : 'issue_opened',
          timestamp: new Date(issue.updated_at),
          author: {
            id: issue.user.login,
            name: issue.user.login,
            avatar: issue.user.avatar_url,
          },
          title: issue.title,
          description: issue.body,
          url: issue.html_url,
          repository: repoFullName,
          labels: issue.labels?.map(l => l.name) || [],
          assignees: issue.assignees?.map(a => a.login) || [],
          status: issue.state === 'closed' ? 'closed' : 'open',
          priority,
          metadata: {
            issue_number: issue.number,
            milestone: issue.milestone?.title,
            created_at: issue.created_at,
            closed_at: issue.closed_at,
          },
        });
      }
    } catch (error) {
      console.error(`Error getting issues for ${repoFullName}:`, error);
    }

    return events;
  }

  private async getRepositoryReleases(repoFullName: string, since: string): Promise<ActivityEvent[]> {
    const events: ActivityEvent[] = [];

    try {
      const releases: GitHubRelease[] = await this.makeRequest(
        `/repos/${repoFullName}/releases?per_page=10`
      );

      const sinceDate = new Date(since);
      const recentReleases = releases.filter(r => 
        new Date(r.published_at || r.created_at) >= sinceDate
      );

      for (const release of recentReleases) {
        events.push({
          id: `github_release_${release.id}`,
          type: 'github',
          subtype: 'release_published',
          timestamp: new Date(release.published_at || release.created_at),
          author: {
            id: release.author.login,
            name: release.author.login,
            avatar: release.author.avatar_url,
          },
          title: `Release ${release.name || release.tag_name}`,
          description: release.body,
          url: release.html_url,
          repository: repoFullName,
          labels: [],
          assignees: [],
          priority: 'high',
          metadata: {
            tag_name: release.tag_name,
            prerelease: (release as any).prerelease,
            draft: (release as any).draft,
          },
        });
      }
    } catch (error) {
      console.error(`Error getting releases for ${repoFullName}:`, error);
    }

    return events;
  }

  private async getRepositoryPRReviews(repoFullName: string, since: string): Promise<ActivityEvent[]> {
    const events: ActivityEvent[] = [];

    try {
      // Get recent PRs first
      const prs: GitHubPR[] = await this.makeRequest(
        `/repos/${repoFullName}/pulls?state=all&sort=updated&direction=desc&per_page=20&since=${since}`
      );

      // Get reviews for each PR
      for (const pr of prs) {
        try {
          const reviews = await this.makeRequest(
            `/repos/${repoFullName}/pulls/${pr.number}/reviews`
          );

          const sinceDate = new Date(since);
          const recentReviews = reviews.filter((review: any) => 
            new Date(review.submitted_at) >= sinceDate
          );

          for (const review of recentReviews) {
            const priority = review.state === 'CHANGES_REQUESTED' ? 'high' : 'medium';
            
            events.push({
              id: `github_review_${review.id}`,
              type: 'github',
              subtype: 'pr_reviewed',
              timestamp: new Date(review.submitted_at),
              author: {
                id: review.user.login,
                name: review.user.login,
                avatar: review.user.avatar_url,
              },
              title: `Review on PR #${pr.number}: ${pr.title}`,
              description: review.body,
              url: review.html_url,
              repository: repoFullName,
              labels: [],
              assignees: [],
              priority,
              metadata: {
                pr_number: pr.number,
                review_state: review.state,
                review_id: review.id,
              },
            });
          }
        } catch (reviewError) {
          console.error(`Error getting reviews for PR ${pr.number}:`, reviewError);
        }
      }
    } catch (error) {
      console.error(`Error getting PR reviews for ${repoFullName}:`, error);
    }

    return events;
  }

  private async makeRequest(endpoint: string): Promise<any> {
    const url = `${this.baseUrl}${endpoint}`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `token ${this.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'ActivityMonitor/1.0',
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Check if we have pending action items in GitHub
   */
  async getPendingActionItems(): Promise<Array<{
    type: string;
    title: string;
    url: string;
    repository: string;
    priority: string;
  }>> {
    const actionItems = [];

    try {
      const repos = await this.getOrgRepositories();
      
      for (const repo of repos.slice(0, 10)) { // Limit to prevent rate limiting
        try {
          // Get PRs that need review
          const openPRs: GitHubPR[] = await this.makeRequest(
            `/repos/${repo}/pulls?state=open&per_page=20`
          );

          for (const pr of openPRs) {
            if (pr.requested_reviewers.length > 0 && !pr.draft) {
              actionItems.push({
                type: 'review_needed',
                title: `PR #${pr.number}: ${pr.title}`,
                url: pr.html_url,
                repository: repo,
                priority: 'high',
              });
            }
          }

          // Get issues that are assigned but not updated recently
          const issues: GitHubIssue[] = await this.makeRequest(
            `/repos/${repo}/issues?state=open&per_page=20&sort=updated&direction=asc`
          );

          const weekAgo = new Date();
          weekAgo.setDate(weekAgo.getDate() - 7);

          for (const issue of issues) {
            if (issue.assignees.length > 0 && new Date(issue.updated_at) < weekAgo) {
              actionItems.push({
                type: 'stale_issue',
                title: `Issue #${issue.number}: ${issue.title}`,
                url: issue.html_url,
                repository: repo,
                priority: 'medium',
              });
            }
          }
        } catch (repoError) {
          console.error(`Error getting action items for ${repo}:`, repoError);
        }
      }
    } catch (error) {
      console.error('Error getting pending action items:', error);
    }

    return actionItems;
  }
}
