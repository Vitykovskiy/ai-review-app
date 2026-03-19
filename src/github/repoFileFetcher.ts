import { GitHubClient, RepoFile } from '../types';

const RULE_PATHS = ['CLAUDE.md', 'AGENT.md', '.github/CONTRIBUTING.md'];
const RULE_DIRS = ['docs', 'rules', '.github'];
const MAX_DIR_FILES = 5;

interface GHContent {
  type: 'file' | 'dir';
  name: string;
  path: string;
  content?: string;
  encoding?: string;
  size?: number;
}

async function fetchFile(
  client: GitHubClient,
  owner: string,
  repo: string,
  path: string
): Promise<RepoFile | null> {
  try {
    const data = (await client.get(
      `/repos/${owner}/${repo}/contents/${path}`
    )) as GHContent;

    if (data.type !== 'file' || !data.content) return null;
    const content = Buffer.from(data.content, 'base64').toString('utf-8');
    return { path, content };
  } catch {
    return null;
  }
}

async function fetchDir(
  client: GitHubClient,
  owner: string,
  repo: string,
  dir: string,
  maxChars: number
): Promise<RepoFile[]> {
  try {
    const entries = (await client.get(
      `/repos/${owner}/${repo}/contents/${dir}`
    )) as GHContent[];

    const mdFiles = entries
      .filter((e) => e.type === 'file' && e.name.endsWith('.md') && (e.size ?? 0) < 50000)
      .slice(0, MAX_DIR_FILES);

    const results: RepoFile[] = [];
    let totalChars = 0;

    for (const entry of mdFiles) {
      if (totalChars >= maxChars) break;
      const file = await fetchFile(client, owner, repo, entry.path);
      if (file) {
        results.push(file);
        totalChars += file.content.length;
      }
    }

    return results;
  } catch {
    return [];
  }
}

export async function fetchRepoContextFiles(
  client: GitHubClient,
  owner: string,
  repo: string,
  maxChars: number
): Promise<RepoFile[]> {
  const files: RepoFile[] = [];
  let totalChars = 0;

  // Fetch known rule files first
  for (const path of RULE_PATHS) {
    if (totalChars >= maxChars) break;
    const file = await fetchFile(client, owner, repo, path);
    if (file) {
      files.push(file);
      totalChars += file.content.length;
    }
  }

  // Fetch rule directories
  for (const dir of RULE_DIRS) {
    if (totalChars >= maxChars) break;
    const dirFiles = await fetchDir(client, owner, repo, dir, maxChars - totalChars);
    for (const f of dirFiles) {
      files.push(f);
      totalChars += f.content.length;
    }
  }

  return files;
}
