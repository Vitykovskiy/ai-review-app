import { PREvent, Config } from '../types';
import { AIProvider } from '../ai/aiProvider';
import { createGitHubClient } from '../github/githubClient';
import { fetchPRFiles } from '../github/diffFetcher';
import { fetchRepoContextFiles } from '../github/repoFileFetcher';
import { fetchLinkedIssue } from '../github/issueFetcher';
import { postReview } from '../github/reviewPoster';
import { buildPrompt } from '../context/contextBuilder';

// Per-PR lock to prevent concurrent reviews of the same PR
const activeLocks = new Set<string>();

export async function handlePullRequest(
  payload: unknown,
  config: Config,
  aiProvider: AIProvider
): Promise<void> {
  const event = payload as PREvent;
  const { action, pull_request: pr, repository, installation } = event;

  if (!['opened', 'synchronize', 'reopened'].includes(action)) return;

  if (pr.draft) {
    console.log(`[pr] Skipping draft PR #${pr.number}`);
    return;
  }

  const owner = repository.owner.login;
  const repo = repository.name;
  const prKey = `${owner}/${repo}#${pr.number}`;

  if (activeLocks.has(prKey)) {
    console.log(`[pr] Review already in progress for ${prKey}, skipping`);
    return;
  }

  activeLocks.add(prKey);
  console.log(`[pr] Starting review for ${prKey} (${action})`);

  // Safety: release lock after timeout + buffer in case of unexpected hang
  const lockTimeoutMs = config.aiTimeoutMs + 60_000;
  const lockTimer = setTimeout(() => {
    if (activeLocks.has(prKey)) {
      console.warn(`[pr] Lock safety timeout reached for ${prKey}, releasing`);
      activeLocks.delete(prKey);
    }
  }, lockTimeoutMs);

  try {
    const client = await createGitHubClient(
      installation.id,
      config.githubAppId,
      config.githubPrivateKey
    );

    // Fetch all context in parallel
    const [files, ruleFiles, issue] = await Promise.all([
      fetchPRFiles(client, owner, repo, pr.number),
      fetchRepoContextFiles(client, owner, repo, config.maxRulesChars),
      fetchLinkedIssue(client, owner, repo, pr.body),
    ]);

    console.log(
      `[pr] Context: ${files.length} files, ${ruleFiles.length} rule files, issue: ${issue?.number ?? 'none'}`
    );

    const prompt = buildPrompt(
      { title: pr.title, body: pr.body, headRef: pr.head.ref, baseRef: pr.base.ref },
      files,
      ruleFiles,
      issue,
      config.maxPromptChars
    );

    const result = await aiProvider.review(prompt);

    // Refresh token before posting (in case AI took a long time)
    const freshClient = await createGitHubClient(
      installation.id,
      config.githubAppId,
      config.githubPrivateKey
    );

    // Verify PR is still open — it may have been merged while AI was running
    const currentPR = await freshClient.get(`/repos/${owner}/${repo}/pulls/${pr.number}`) as { state: string };
    if (currentPR.state !== 'open') {
      console.log(`[pr] PR ${prKey} is ${currentPR.state}, skipping review post`);
      return;
    }

    await postReview(freshClient, owner, repo, pr.number, pr.head.sha, result, files);
    console.log(`[pr] Review posted for ${prKey}: ${result.action}`);
  } catch (err) {
    console.error(`[pr] Error reviewing ${prKey}:`, err);
  } finally {
    clearTimeout(lockTimer);
    activeLocks.delete(prKey);
  }
}
