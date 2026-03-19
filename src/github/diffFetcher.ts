import { GitHubClient, PRFile } from '../types';

const MAX_FILES = 50;

export async function fetchPRFiles(
  client: GitHubClient,
  owner: string,
  repo: string,
  prNumber: number
): Promise<PRFile[]> {
  const files: PRFile[] = [];
  let page = 1;

  while (files.length < MAX_FILES) {
    const batch = (await client.get(
      `/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100&page=${page}`
    )) as PRFile[];

    if (!batch.length) break;

    for (const file of batch) {
      if (files.length >= MAX_FILES) break;
      // Skip binary files (no patch)
      if (file.patch !== undefined || file.status === 'removed') {
        files.push({
          filename: file.filename,
          status: file.status,
          additions: file.additions,
          deletions: file.deletions,
          patch: file.patch,
        });
      }
    }

    if (batch.length < 100) break;
    page++;
  }

  return files;
}
