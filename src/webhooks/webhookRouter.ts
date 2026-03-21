import express, { Router, Request, Response } from 'express';
import { Config } from '../types';
import { AIProvider } from '../ai/aiProvider';
import { webhookVerify } from '../auth/webhookVerify';
import { handlePullRequest } from './pullRequestHandler';

const processedDeliveries = new Set<string>();

export function webhookRouter(config: Config, aiProvider: AIProvider): Router {
  const router = Router();

  // Preserve raw body for HMAC verification
  router.use(express.raw({ type: 'application/json' }));
  router.use(webhookVerify(config.githubWebhookSecret));

  router.post('/', (req: Request, res: Response): void => {
    const event = req.headers['x-github-event'] as string;
    const deliveryId = req.headers['x-github-delivery'] as string;

    console.log(`[webhook] Incoming event=${event} delivery=${deliveryId}`);

    // Respond immediately — GitHub requires fast response
    res.status(200).send('ok');

    // Deduplicate redeliveries
    if (processedDeliveries.has(deliveryId)) {
      console.log(`[webhook] Skipping duplicate delivery: ${deliveryId}`);
      return;
    }
    processedDeliveries.add(deliveryId);
    // Cleanup old delivery IDs to prevent unbounded growth
    if (processedDeliveries.size > 1000) {
      const first = processedDeliveries.values().next().value;
      if (first) processedDeliveries.delete(first);
    }

    let payload: unknown;
    try {
      payload = JSON.parse((req.body as Buffer).toString('utf-8'));
    } catch (err) {
      console.error('[webhook] Failed to parse payload:', err);
      return;
    }

    if (event === 'pull_request') {
      handlePullRequest(payload, config, aiProvider).catch((err) => {
        console.error('[webhook] Unhandled error in PR handler:', err);
      });
    }
  });

  return router;
}
