import express from 'express';
import { config } from './config';
import { createAIProvider } from './ai/aiProvider';
import { waitForAuth } from './ai/authChecker';
import { webhookRouter } from './webhooks/webhookRouter';
import { startPRPoller } from './polling/prPoller';
import { generateJWT } from './auth/githubAuth';

async function checkGitHubAppWebhookSetup(): Promise<void> {
  try {
    const jwt = generateJWT(config.githubAppId, config.githubPrivateKey);
    const response = await fetch('https://api.github.com/app', {
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      console.warn(`[startup] Failed to inspect GitHub App settings: ${response.status} ${text}`);
      return;
    }

    const appInfo = (await response.json()) as { events?: string[]; html_url?: string };
    const events = appInfo.events || [];

    if (!events.includes('pull_request')) {
      console.warn('[startup] GitHub App is NOT subscribed to pull_request events. Webhook-driven reviews will not work until this is fixed in GitHub App settings.');
      if (appInfo.html_url) {
        console.warn(`[startup] GitHub App settings: ${appInfo.html_url}`);
      }
    } else {
      console.log('[startup] GitHub App pull_request subscription is enabled.');
    }
  } catch (err) {
    console.warn('[startup] Failed to inspect GitHub App webhook setup:', err);
  }
}

async function main() {
  const app = express();

  // Health endpoint available immediately (before AI auth)
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  const server = app.listen(config.port, () => {
    console.log(`[server] Listening on port ${config.port}`);
  });

  // Check AI provider auth before accepting webhooks
  const aiProvider = createAIProvider(config);
  console.log(`[startup] AI provider: ${aiProvider.name}`);

  await checkGitHubAppWebhookSetup();
  await waitForAuth(aiProvider);
  console.log(`[startup] Auth confirmed. Mounting webhook handler.`);

  // Mount webhook route only after auth is confirmed
  app.use('/webhook', webhookRouter(config, aiProvider));

  // Fallback polling for environments where GitHub App webhook events are not fully configured yet
  startPRPoller(config, aiProvider);

  process.on('SIGTERM', () => {
    console.log('[server] SIGTERM received, shutting down');
    server.close(() => process.exit(0));
  });
}

main().catch((err) => {
  console.error('[startup] Fatal error:', err.message);
  process.exit(1);
});
