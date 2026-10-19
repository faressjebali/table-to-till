import { Router } from 'express';
import { z } from 'zod';
import { getAuth, requireStaff } from '../auth/middleware.js';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { validationError } from '../errors.js';

// Corps = PushSubscription.toJSON() du navigateur ; expirationTime est ignoré.
const subscribeBody = z.object({
  endpoint: z.url({ protocol: /^https$/ }).max(2048),
  keys: z.object({
    p256dh: z.string().min(1).max(256),
    auth: z.string().min(1).max(256),
  }),
});

// POST /push/subscribe (docs/api.md § 5) : tout le staff, même hors shift.
export function pushRoutes(db: Db, config: Config): Router {
  const router = Router();

  // Relançable : le même téléphone (endpoint) est mis à jour, et passe au compte connecté.
  router.post('/push/subscribe', requireStaff(db, config), async (req, res) => {
    const parsed = subscribeBody.safeParse(req.body);
    if (!parsed.success) throw validationError(parsed.error);
    const { endpoint, keys } = parsed.data;
    const { user, sessionId } = getAuth(res);
    await db.query(
      `INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_id, session_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (endpoint) DO UPDATE
         SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, user_id = EXCLUDED.user_id,
             session_id = EXCLUDED.session_id, updated_at = now()`,
      [endpoint, keys.p256dh, keys.auth, user.id, sessionId],
    );
    res.status(204).end();
  });

  return router;
}
