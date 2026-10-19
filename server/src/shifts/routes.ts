import { Router } from 'express';
import { getAuth, requireStaff } from '../auth/middleware.js';
import type { Config } from '../config.js';
import { audit, type Db } from '../db.js';
import type { Realtime } from '../realtime.js';
import {
  isShiftRole,
  requireOnShift,
  SHIFT_ROLES,
  stationsOnShift,
  waitersOnShift,
} from './on-shift.js';

type ShiftRow = { id: number; started_at: Date; principal: boolean };

function isPrincipalConflict(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'constraint' in err &&
    err.constraint === 'shifts_one_principal'
  );
}

// Routes shifts de docs/api.md § 5. La fin de shift d'un serveur est la clôture.
export function shiftRoutes(db: Db, config: Config, realtime: Realtime): Router {
  const router = Router();

  // Premier serveur en shift = principal, les suivants = renforts. Le barista et le cuisinier
  // ne sont jamais principaux.
  const openShift = (userId: number, waiter: boolean) =>
    db.query<ShiftRow>(
      `INSERT INTO shifts (user_id, principal)
       SELECT $1, $2 AND NOT EXISTS (SELECT 1 FROM shifts WHERE ended_at IS NULL AND principal)
       ON CONFLICT (user_id) WHERE ended_at IS NULL DO NOTHING
       RETURNING id, started_at, principal`,
      [userId, waiter],
    );

  // Relançable : un shift déjà ouvert est renvoyé tel quel (double tap, requête renvoyée).
  router.post(
    '/shifts/start',
    requireStaff(db, config, { roles: [...SHIFT_ROLES] }),
    async (_req, res) => {
      const { user } = getAuth(res);
      if (!isShiftRole(user.role)) throw new Error(`rôle sans shift : ${user.role}`);
      const waiter = user.role === 'waiter';
      let created: ShiftRow[];
      try {
        ({ rows: created } = await openShift(user.id, waiter));
      } catch (err) {
        // Deux serveurs arrivés en même temps : le second devient renfort.
        if (!isPrincipalConflict(err)) throw err;
        ({ rows: created } = await openShift(user.id, waiter));
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
        realtime.shiftStarted(user.id, user.role);
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

  // Barista et cuisinier : fin de shift sans argent ni clôture. Serveurs :.
  router.post(
    '/shifts/end',
    ...requireOnShift(db, config, ['barista', 'chef']),
    async (_req, res) => {
      const { user } = getAuth(res);
      const { rows } = await db.query<{ id: number }>(
        `UPDATE shifts SET ended_at = now()
          WHERE user_id = $1 AND ended_at IS NULL
          RETURNING id`,
        [user.id],
      );
      const shift = rows[0];
      // Deux appels en même temps : le premier a déjà terminé le shift.
      if (shift) {
        await audit(db, {
          userId: user.id,
          action: 'shift.ended',
          entityType: 'shift',
          entityId: shift.id,
        });
        realtime.shiftEnded(user.id);
      }
      res.status(204).end();
    },
  );

  router.get('/shifts/current', requireStaff(db, config), async (_req, res) => {
    const [waiters, stations] = await Promise.all([waitersOnShift(db), stationsOnShift(db)]);
    res.json({ waiters, stations });
  });

  return router;
}
