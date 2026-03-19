import express from 'express';
import { config } from './config';
import { createAIProvider } from './ai/aiProvider';
import { waitForAuth } from './ai/authChecker';
import { webhookRouter } from './webhooks/webhookRouter';

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

  await waitForAuth(aiProvider);
  console.log(`[startup] Auth confirmed. Mounting webhook handler.`);

  // Mount webhook route only after auth is confirmed
  app.use('/webhook', webhookRouter(config, aiProvider));

  process.on('SIGTERM', () => {
    console.log('[server] SIGTERM received, shutting down');
    server.close(() => process.exit(0));
  });
}

main().catch((err) => {
  console.error('[startup] Fatal error:', err.message);
  process.exit(1);
});
