import { AIProvider } from '../ai/aiProvider';
import { generateJWT, getInstallationToken } from '../auth/githubAuth';
import { Config, PREvent } from '../types';
import { handlePullRequest } from '../webhooks/pullRequestHandler';

const GITHUB_API = 'https://api.github.com';
const seenHeadShas = new Map<string, string>();
const SEEN_HEAD_SHAS_MAX = 500;
const pollIntervalMs = 60_000;

async function appRequest(config: Config, path: string): Promise<any> {
  const jwt = generateJWT(config.githubAppId, config.githubPrivateKey);
  const response = await fetch(`${GITHUB_API}${path}`, {
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub App API GET ${path} failed (${response.status}): ${text}`);
  }

  return response.json();
}

function trackHeadSha(prKey: string, sha: string): void {
  seenHeadShas.set(prKey, sha);
  if (seenHeadShas.size > SEEN_HEAD_SHAS_MAX) {
    const firstKey = seenHeadShas.keys().next().value;
    if (firstKey) seenHeadShas.delete(firstKey);
  }
}

async function installationRequest(config: Config, installationId: number, path: string): Promise<any> {
  const token = await getInstallationToken(installationId, config.githubAppId, config.githubPrivateKey);
  const response = await fetch(`${GITHUB_API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub Installation API GET ${path} failed (${response.status}): ${text}`);
  }

  return response.json();
}

async function hasBotReviewForHead(config: Config, installationId: number, owner: string, repo: string, prNumber: number, headSha: string): Promise<boolean> {
  const reviews = await installationRequest(config, installationId, `/repos/${owner}/${repo}/pulls/${prNumber}/reviews`) as any[];
  return reviews.some((review) => {
    const login = review?.user?.login || '';
    const isBot = review?.user?.type === 'Bot' || String(login).includes('[bot]');
    return isBot && review.commit_id === headSha;
  });
}

async function fetchAllOpenPRs(config: Config, installationId: number, owner: string, repo: string): Promise<any[]> {
  const all: any[] = [];
  let page = 1;
  while (true) {
    const batch = await installationRequest(
      config,
      installationId,
      `/repos/${owner}/${repo}/pulls?state=open&per_page=100&page=${page}`
    ) as any[];
    all.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return all;
}

async function pollOnce(config: Config, aiProvider: AIProvider): Promise<void> {
  const installations = await appRequest(config, '/app/installations') as any[];

  for (const installation of installations) {
    const installationId = installation.id as number;
    const reposData = await installationRequest(config, installationId, '/installation/repositories') as { repositories: any[] };

    for (const repository of reposData.repositories) {
      const owner = repository.owner.login as string;
      const repo = repository.name as string;
      const fullName = `${owner}/${repo}`;
      if (config.pollerRepos && !config.pollerRepos.includes(fullName)) continue;
      const prs = await fetchAllOpenPRs(config, installationId, owner, repo);

      for (const pr of prs) {
        if (pr.draft) continue;

        const prKey = `${owner}/${repo}#${pr.number}`;
        if (seenHeadShas.get(prKey) === pr.head.sha) continue;

        if (await hasBotReviewForHead(config, installationId, owner, repo, pr.number, pr.head.sha)) {
          trackHeadSha(prKey, pr.head.sha);
          continue;
        }

        const payload: PREvent = {
          action: 'synchronize',
          installation: { id: installationId },
          repository: { name: repo, owner: { login: owner } },
          pull_request: {
            number: pr.number,
            title: pr.title,
            body: pr.body,
            draft: pr.draft,
            head: { sha: pr.head.sha, ref: pr.head.ref },
            base: { ref: pr.base.ref },
            user: { login: pr.user.login },
          },
        };

        console.log(`[poller] Reviewing ${prKey} at ${pr.head.sha}`);
        await handlePullRequest(payload, config, aiProvider);
        trackHeadSha(prKey, pr.head.sha);
      }
    }
  }
}

export function startPRPoller(config: Config, aiProvider: AIProvider): void {
  const run = async () => {
    try {
      await pollOnce(config, aiProvider);
    } catch (err) {
      console.error('[poller] Error:', err);
    }
  };

  void run();
  setInterval(() => {
    void run();
  }, pollIntervalMs);
}
