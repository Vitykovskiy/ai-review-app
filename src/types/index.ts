export interface Config {
  githubAppId: string;
  githubPrivateKey: string;
  githubWebhookSecret: string;
  aiProvider: 'claude' | 'codex';
  aiTimeoutMs: number;
  port: number;
  logLevel: string;
  maxPromptChars: number;
  maxRulesChars: number;
}

export interface PREvent {
  action: 'opened' | 'synchronize' | 'reopened';
  installation: { id: number };
  repository: {
    name: string;
    owner: { login: string };
  };
  pull_request: {
    number: number;
    title: string;
    body: string | null;
    draft: boolean;
    head: { sha: string; ref: string };
    base: { ref: string };
    user: { login: string };
  };
}

export interface PRFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

export interface RepoFile {
  path: string;
  content: string;
}

export interface Issue {
  number: number;
  title: string;
  body: string | null;
  labels: Array<{ name: string }>;
}

export interface ReviewResult {
  action: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
  body: string;
  comments: Array<{ path: string; line: number; body: string }>;
}

export interface GitHubClient {
  get(path: string): Promise<unknown>;
  post(path: string, body: unknown): Promise<unknown>;
}
