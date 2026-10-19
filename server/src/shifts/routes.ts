import { Router } from 'express';
import { getAuth, requireStaff } from '../auth/middleware.js';
import type { Config } from '../config.js';
import { audit, type Db } from '../db.js';
import type { Realtime } from '../realtime.js';
import { waitersOnShift } from './on-shift.js';

type ShiftRow = { id: number; started_at: Date; principal: boolean };

function isPrincipalConflict(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'constraint' in err &&
    err.constraint === 'shifts_one_principal'
  );
}

// Routes shifts de docs/api.md § 5. La fin de shift est la clôture (POST /shifts/end).
export function shiftRoutes(db: Db, config: Config, realtime: Realtime): Router {
  const router = Router();

  // Premier serveur en shift = principal, les suivants = renforts.
  const openShift = (userId: number) =>
    db.query<ShiftRow>(
      `INSERT INTO shifts (user_id, principal)
       SELECT $1, NOT EXISTS (SELECT 1 FROM shifts WHERE ended_at IS NULL AND principal)
       ON CONFLICT (user_id) WHERE ended_at IS NULL DO NOTHING
       RETURNING id, started_at, principal`,
      [userId],
    );

  // Relançable : un shift déjà ouvert est renvoyé tel quel (double tap, requête renvoyée).
  router.post(
    '/shifts/start',
    requireStaff(db, config, { roles: ['waiter'] }),
    async (_req, res) => {
      const { user } = getAuth(res);
      let created: ShiftRow[];
      try {
        ({ rows: created } = await openShift(user.id));
      } catch (err) {
        // Deux serveurs arrivés en même temps : le second devient renfort.
        if (!isPrincipalConflict(err)) throw err;
        ({ rows: created } = await openShift(user.id));
      }
      const shift = created[0];
      if (shift) {
        await audit(db, {
          userId: user.id,
          action: 'shift.started',
          entityType: 'shift',
          entityId: shift.id,
          details: { principal: shift.principal },
        });
        realtime.shiftStarted(user.id);
        res.status(201).json({
          shiftId: shift.id,
          startedAt: shift.started_at,
          principal: shift.principal,
        });
        return;
      }

      const { rows: open } = await db.query<ShiftRow>(
        `SELECT id, started_at, principal FROM shifts WHERE user_id = $1 AND ended_at IS NULL`,
        [user.id],
      );
      const existing = open[0];
      if (!existing) throw new Error('shift ouvert introuvable');
      res.json({
        shiftId: existing.id,
        startedAt: existing.started_at,
        principal: existing.principal,
      });
    },
  );

  router.get('/shifts/current', requireStaff(db, config), async (_req, res) => {
    res.json({ waiters: await waitersOnShift(db) });
  });

  return router;
}
