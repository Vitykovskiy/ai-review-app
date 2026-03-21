import { PRFile, RepoFile, Issue } from '../types';

interface PRMeta {
  title: string;
  body: string | null;
  headRef: string;
  baseRef: string;
}

const SYSTEM_INSTRUCTIONS = `You are an expert code reviewer. Analyze the pull request and provide a structured review.

Your response MUST be valid JSON matching this schema exactly:
{
  "action": "APPROVE" | "REQUEST_CHANGES" | "COMMENT",
  "body": "Overall review summary (required)",
  "comments": [
    { "path": "relative/file/path.ts", "line": 42, "body": "Comment text" }
  ]
}

Rules:
- Use APPROVE if the code is correct and meets all project standards
- Use REQUEST_CHANGES only for real bugs, broken checks, security issues, or clear rule violations that should block merge
- Use COMMENT for non-blocking suggestions
- Focus on high-signal findings; ignore minor polish and generic scaffold cleanup unless it creates a real risk
- Prefer at most 5 comments and only when they are specific and actionable
- Do not include markdown fences, code blocks, backticks, or multiline snippets inside JSON strings
- Keep comments short, plain, and practical
- "comments" should reference specific lines with actionable feedback
- "body" should summarize the overall review in plain language
- Write the entire review in the same language as the pull request title and description
- Respond with JSON only, no markdown, no extra text`;

export function buildPrompt(
  pr: PRMeta,
  files: PRFile[],
  ruleFiles: RepoFile[],
  issue: Issue | null,
  maxChars: number
): string {
  const sections: string[] = [];

  sections.push(SYSTEM_INSTRUCTIONS);

  if (ruleFiles.length > 0) {
    sections.push('## Project Rules and Documentation');
    for (const f of ruleFiles) {
      sections.push(`### ${f.path}\n${f.content}`);
    }
  }

  if (issue) {
    const labels = issue.labels.map((l) => l.name).join(', ');
    sections.push(
      `## Linked Issue #${issue.number}: ${issue.title}` +
      (labels ? `\nLabels: ${labels}` : '') +
      (issue.body ? `\n\n${issue.body}` : '')
    );
  }

  sections.push(
    `## Pull Request #\nTitle: ${pr.title}\nBranch: ${pr.headRef} → ${pr.baseRef}` +
    (pr.body ? `\n\nDescription:\n${pr.body}` : '')
  );

  const header = sections.join('\n\n');
  const remaining = maxChars - header.length - 100;

  sections.push('## Changed Files\n' + buildDiffSection(files, remaining));

  const prompt = sections.join('\n\n');
  return prompt;
}

function buildDiffSection(files: PRFile[], budgetChars: number): string {
  if (files.length === 0) return '_No changed files._';

  // Sort by patch size descending to truncate largest first
  const withSize = files.map((f) => ({
    file: f,
    size: f.patch?.length ?? 0,
  }));
  withSize.sort((a, b) => b.size - a.size);

  const binaryFiles = files.filter((f) => !f.patch && f.status !== 'removed');
  let result = '';

  if (binaryFiles.length > 0) {
    result += `_Binary files changed (skipped): ${binaryFiles.map((f) => f.filename).join(', ')}_\n\n`;
  }

  let usedChars = result.length;
  const includedDiffs: string[] = [];
  const skippedFiles: string[] = [];

  for (const { file } of withSize) {
    if (!file.patch) continue;

    const block =
      `### ${file.filename} (+${file.additions} -${file.deletions})\n` +
      '```diff\n' + file.patch + '\n```';

    if (usedChars + block.length <= budgetChars) {
      includedDiffs.push(block);
      usedChars += block.length;
    } else {
      skippedFiles.push(file.filename);
    }
  }

  if (skippedFiles.length > 0) {
    result += `_Diffs truncated due to size limit. Skipped: ${skippedFiles.join(', ')}_\n\n`;
  }

  result += includedDiffs.join('\n\n');
  return result;
}
