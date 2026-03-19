import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';

export function webhookVerify(secret: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const signature = req.headers['x-hub-signature-256'] as string | undefined;

    if (!signature) {
      res.status(401).json({ error: 'Missing X-Hub-Signature-256 header' });
      return;
    }

    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(req.body as Buffer);
    const expected = `sha256=${hmac.digest('hex')}`;

    try {
      const sigBuffer = Buffer.from(signature);
      const expBuffer = Buffer.from(expected);

      if (
        sigBuffer.length !== expBuffer.length ||
        !crypto.timingSafeEqual(sigBuffer, expBuffer)
      ) {
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }
    } catch {
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    next();
  };
}
