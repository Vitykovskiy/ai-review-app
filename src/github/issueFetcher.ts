import { GitHubClient, Issue } from '../types';

const CLOSES_PATTERN = /(?:closes?|fixes?|resolves?)\s+#(\d+)/gi;

export function extractLinkedIssueNumber(prBody: string | null): number | null {
  if (!prBody) return null;

  const match = CLOSES_PATTERN.exec(prBody);
  CLOSES_PATTERN.lastIndex = 0; // Reset regex state

  if (!match) return null;
  return parseInt(match[1], 10);
}

export async function fetchLinkedIssue(
  client: GitHubClient,
  owner: string,
  repo: string,
  prBody: string | null
): Promise<Issue | null> {
  const issueNumber = extractLinkedIssueNumber(prBody);
  if (!issueNumber) return null;

  try {
    const data = (await client.get(
      `/repos/${owner}/${repo}/issues/${issueNumber}`
    )) as Issue;

    return {
      number: data.number,
      title: data.title,
      body: data.body,
      labels: data.labels,
    };
  } catch (err) {
    console.warn(`[issue] Failed to fetch issue #${issueNumber}:`, err);
    return null;
  }
}
