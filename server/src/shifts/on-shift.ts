import type { RequestHandler } from 'express';
import { getAuth, requireStaff } from '../auth/middleware.js';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { HttpError } from '../errors.js';

export type WaiterOnShift = { id: number; name: string; startedAt: Date };

// Serveurs en shift : shift ouvert, compte actif et toujours serveur.
// Sert aux notifications et au refus des commandes QR quand personne ne peut les confirmer.
export async function waitersOnShift(db: Db): Promise<WaiterOnShift[]> {
  const { rows } = await db.query<WaiterOnShift>(
    `SELECT u.id, u.name, s.started_at AS "startedAt"
       FROM shifts s JOIN users u ON u.id = s.user_id
      WHERE s.ended_at IS NULL AND u.disabled_at IS NULL AND u.role = 'waiter'
      ORDER BY s.started_at, u.id`,
  );
  return rows;
}

export async function isOnShift(db: Db, userId: number): Promise<boolean> {
  const { rowCount } = await db.query(
    `SELECT 1 FROM shifts WHERE user_id = $1 AND ended_at IS NULL`,
    [userId],
  );
  return rowCount !== null && rowCount > 0;
}

// Plan des tables et commandes : réservés aux serveurs en shift, lecture comprise
// (docs/api.md § 5). Mauvais rôle → FORBIDDEN ; serveur hors shift → NOT_ON_SHIFT.
export function requireWaiterOnShift(db: Db, config: Config): RequestHandler[] {
  return [
    requireStaff(db, config, { roles: ['waiter'] }),
    async (_req, res, next) => {
      if (!(await isOnShift(db, getAuth(res).user.id))) {
        throw new HttpError(403, 'NOT_ON_SHIFT', 'Not on shift');
      }
      next();
    },
  ];
}
