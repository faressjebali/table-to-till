import type { RequestHandler } from 'express';
import { getAuth, requireStaff } from '../auth/middleware.js';
import type { Role } from '../auth/sessions.js';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { HttpError } from '../errors.js';

// Rôles qui ont un shift : les serveurs, et le barista et le cuisinier (sans argent ni clôture).
export const SHIFT_ROLES = ['waiter', 'barista', 'chef'] as const satisfies readonly Role[];
export type ShiftRole = (typeof SHIFT_ROLES)[number];
export type StationRole = Exclude<ShiftRole, 'waiter'>;

export function isShiftRole(role: Role): role is ShiftRole {
  return (SHIFT_ROLES as readonly Role[]).includes(role);
}

export type WaiterOnShift = { id: number; name: string; startedAt: Date; principal: boolean };
export type StationOnShift = { id: number; name: string; role: StationRole; startedAt: Date };

// Serveurs en shift : shift ouvert, compte actif et toujours serveur.
// Sert aux notifications et au refus des commandes QR quand personne ne peut les confirmer.
export async function waitersOnShift(db: Db): Promise<WaiterOnShift[]> {
  const { rows } = await db.query<WaiterOnShift>(
    `SELECT u.id, u.name, s.started_at AS "startedAt", s.principal
       FROM shifts s JOIN users u ON u.id = s.user_id
      WHERE s.ended_at IS NULL AND u.disabled_at IS NULL AND u.role = 'waiter'
      ORDER BY s.started_at, u.id`,
  );
  return rows;
}

// Baristas et cuisiniers en shift : les serveurs préviennent « personne au bar » / « en cuisine ».
export async function stationsOnShift(db: Db): Promise<StationOnShift[]> {
  const { rows } = await db.query<StationOnShift>(
    `SELECT u.id, u.name, u.role, s.started_at AS "startedAt"
       FROM shifts s JOIN users u ON u.id = s.user_id
      WHERE s.ended_at IS NULL AND u.disabled_at IS NULL AND u.role IN ('barista', 'chef')
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

// Actions réservées au staff en shift (docs/api.md § 5). Mauvais rôle → FORBIDDEN ;
// hors shift → NOT_ON_SHIFT.
export function requireOnShift(
  db: Db,
  config: Config,
  roles: readonly ShiftRole[],
): RequestHandler[] {
  return [
    requireStaff(db, config, { roles: [...roles] }),
    async (_req, res, next) => {
      if (!(await isOnShift(db, getAuth(res).user.id))) {
        throw new HttpError(403, 'NOT_ON_SHIFT', 'Not on shift');
      }
      next();
    },
  ];
}

// Plan des tables et commandes : réservés aux serveurs en shift, lecture comprise.
export function requireWaiterOnShift(db: Db, config: Config): RequestHandler[] {
  return requireOnShift(db, config, ['waiter']);
}
