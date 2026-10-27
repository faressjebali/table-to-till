import { Router } from 'express';
import type { Db } from './db.js';
import { HttpError } from './errors.js';

// Au-delà, la base est considérée injoignable (sans délai, pg attendrait sans fin).
const DB_TIMEOUT_MS = 3000;

// GET /health (docs/api.md § 9) : sans connexion, pour l'hébergeur, la surveillance et l'agent.
export function healthRoutes(db: Db): Router {
  const router = Router();

  router.get('/health', async (_req, res) => {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error('délai dépassé'));
      }, DB_TIMEOUT_MS);
    });
    try {
      await Promise.race([db.query('SELECT 1'), timeout]);
    } catch (err) {
      console.error('health : base de données injoignable :', err);
      throw new HttpError(503, 'SERVICE_UNAVAILABLE', 'Database unavailable');
    } finally {
      clearTimeout(timer);
    }
    res.json({ status: 'ok', db: 'ok', time: new Date().toISOString() });
  });

  return router;
}
