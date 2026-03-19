import { getInstallationToken } from '../auth/githubAuth';
import { GitHubClient } from '../types';

const GITHUB_API = 'https://api.github.com';

export async function createGitHubClient(
  installationId: number,
  appId: string,
  privateKey: string
): Promise<GitHubClient> {
  const token = await getInstallationToken(installationId, appId, privateKey);

  async function request(method: string, path: string, body?: unknown): Promise<unknown> {
    const url = path.startsWith('http') ? path : `${GITHUB_API}${path}`;
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GitHub API ${method} ${path} failed (${response.status}): ${text}`);
    }

    if (response.status === 204) return null;
    return response.json();
  }

  return {
    get: (path: string) => request('GET', path),
    post: (path: string, body: unknown) => request('POST', path, body),
  };
}
