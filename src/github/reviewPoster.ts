import { GitHubClient, ReviewResult, PRFile } from '../types';

interface GitHubComment {
  path: string;
  line: number;
  body: string;
}

function parseValidLines(files: PRFile[]): Map<string, Set<number>> {
  const validLines = new Map<string, Set<number>>();

  for (const file of files) {
    if (!file.patch) continue;

    const lines = new Set<number>();
    let currentLine = 0;

    for (const row of file.patch.split('\n')) {
      const hunkMatch = row.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
      if (hunkMatch) {
        currentLine = parseInt(hunkMatch[1], 10) - 1;
        continue;
      }
      if (row.startsWith('-')) continue; // deleted line, no new line number
      currentLine++;
      if (row.startsWith('+') || row.startsWith(' ')) {
        lines.add(currentLine);
      }
    }

    validLines.set(file.filename, lines);
  }

  return validLines;
}

export async function postReview(
  client: GitHubClient,
  owner: string,
  repo: string,
  prNumber: number,
  commitSha: string,
  result: ReviewResult,
  files: PRFile[]
): Promise<void> {
  const validLines = parseValidLines(files);
  const validComments: GitHubComment[] = [];
  const invalidComments: string[] = [];

  for (const comment of result.comments) {
    const linesForFile = validLines.get(comment.path);
    if (linesForFile && linesForFile.has(comment.line)) {
      validComments.push(comment);
    } else {
      invalidComments.push(`${comment.path}:${comment.line} — ${comment.body}`);
      console.warn(
        `[review] Dropping invalid inline comment at ${comment.path}:${comment.line}`
      );
    }
  }

  let body = result.body;
  if (invalidComments.length > 0) {
    body += `\n\n**Additional notes (line references unavailable):**\n${invalidComments.map((c) => `- ${c}`).join('\n')}`;
  }

  await client.post(`/repos/${owner}/${repo}/pulls/${prNumber}/reviews`, {
    commit_id: commitSha,
    body,
    event: result.action,
    comments: validComments,
  });
}
