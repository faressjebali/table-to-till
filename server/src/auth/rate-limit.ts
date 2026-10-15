import type { RequestHandler } from 'express';
import { HttpError } from '../errors.js';

// Limite par adresse IP sur une fenêtre fixe, gardée en mémoire (un seul processus serveur).
export function rateLimitByIp(limit: number, windowMs: number): RequestHandler {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return (req, _res, next) => {
    const now = Date.now();
    // Nettoyage des fenêtres terminées pour que la Map ne grossisse pas.
    for (const [ip, entry] of hits) if (entry.resetAt <= now) hits.delete(ip);

    const ip = req.ip ?? 'unknown';
    const entry = hits.get(ip) ?? { count: 0, resetAt: now + windowMs };
    entry.count += 1;
    hits.set(ip, entry);

    if (entry.count > limit) {
      throw new HttpError(429, 'TOO_MANY_REQUESTS', 'Too many requests', {
        retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000),
      });
    }
    next();
  };
}
