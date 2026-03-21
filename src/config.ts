import fs from 'fs';
import { Config } from './types';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function loadPrivateKey(): string {
  const keyPath = process.env['GITHUB_PRIVATE_KEY_PATH'];
  if (keyPath) {
    if (!fs.existsSync(keyPath)) {
      throw new Error(`GitHub private key file not found at: ${keyPath}`);
    }
    return fs.readFileSync(keyPath, 'utf-8');
  }

  const inlineKey = process.env['GITHUB_PRIVATE_KEY'];
  if (inlineKey) {
    return inlineKey.replace(/\\n/g, '\n');
  }

  throw new Error(
    'GitHub private key must be provided via GITHUB_PRIVATE_KEY_PATH or GITHUB_PRIVATE_KEY'
  );
}

function loadConfig(): Config {
  const aiProvider = process.env['AI_PROVIDER'] || 'claude';
  if (aiProvider !== 'claude' && aiProvider !== 'codex') {
    throw new Error(`AI_PROVIDER must be "claude" or "codex", got: ${aiProvider}`);
  }

  const pollerRepos = process.env['POLLER_REPOS']
    ? process.env['POLLER_REPOS']!.split(',').map((x) => x.trim()).filter(Boolean)
    : undefined;

  return {
    githubAppId: requireEnv('GITHUB_APP_ID'),
    githubPrivateKey: loadPrivateKey(),
    githubWebhookSecret: requireEnv('GITHUB_WEBHOOK_SECRET'),
    aiProvider,
    aiTimeoutMs: parseInt(process.env['AI_TIMEOUT_MS'] || '300000', 10),
    port: parseInt(process.env['PORT'] || '3000', 10),
    logLevel: process.env['LOG_LEVEL'] || 'info',
    maxPromptChars: parseInt(process.env['MAX_PROMPT_CHARS'] || '200000', 10),
    maxRulesChars: parseInt(process.env['MAX_RULES_CHARS'] || '50000', 10),
    pollerRepos,
  };
}

export const config = loadConfig();
