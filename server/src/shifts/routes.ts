import { Router } from 'express';
import { getAuth, requireStaff } from '../auth/middleware.js';
import type { Config } from '../config.js';
import { audit, type Db } from '../db.js';
import { waitersOnShift } from './on-shift.js';

type ShiftRow = { id: number; started_at: Date };

// Routes shifts de docs/api.md § 5. La fin de shift est la clôture (POST /shifts/end).
export function shiftRoutes(db: Db, config: Config): Router {
  const router = Router();

  // Relançable : un shift déjà ouvert est renvoyé tel quel (double tap, requête renvoyée).
  router.post(
    '/shifts/start',
    requireStaff(db, config, { roles: ['waiter'] }),
    async (_req, res) => {
      const { user } = getAuth(res);
      const { rows: created } = await db.query<ShiftRow>(
        `INSERT INTO shifts (user_id) VALUES ($1)
       ON CONFLICT (user_id) WHERE ended_at IS NULL DO NOTHING
       RETURNING id, started_at`,
        [user.id],
      );
      const shift = created[0];
      if (shift) {
        await audit(db, {
          userId: user.id,
          action: 'shift.started',
          entityType: 'shift',
          entityId: shift.id,
        });
        res.status(201).json({ shiftId: shift.id, startedAt: shift.started_at });
        return;
      }

      const { rows: open } = await db.query<ShiftRow>(
        `SELECT id, started_at FROM shifts WHERE user_id = $1 AND ended_at IS NULL`,
        [user.id],
      );
      const existing = open[0];
      if (!existing) throw new Error('shift ouvert introuvable');
      res.json({ shiftId: existing.id, startedAt: existing.started_at });
    },
  );

  router.get('/shifts/current', requireStaff(db, config), async (_req, res) => {
    res.json({ waiters: await waitersOnShift(db) });
  });

  return router;
}
