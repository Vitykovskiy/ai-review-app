import { ReviewResult, Config } from '../types';
import { ClaudeProvider } from './claudeProvider';
import { CodexProvider } from './codexProvider';

export interface AIProvider {
  name: string;
  checkAuth(): Promise<boolean>;
  getAuthInstructions(): string;
  review(prompt: string): Promise<ReviewResult>;
}

export function createAIProvider(config: Config): AIProvider {
  switch (config.aiProvider) {
    case 'claude':
      return new ClaudeProvider(config.aiTimeoutMs);
    case 'codex':
      return new CodexProvider(config.aiTimeoutMs);
  }
}
