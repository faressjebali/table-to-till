import type pg from 'pg';
import { audit, type Db } from '../db.js';
import type { Realtime } from '../realtime.js';
import { notifyOrders } from './notify.js';

// Délai entre deux passages de l'expiration automatique.
export const EXPIRY_SWEEP_MS = 30_000;

// Commandes en attente dont le délai est dépassé → `expired` (docs/api.md § Order).
// Appelée régulièrement, et avant chaque lecture ou action sur les commandes en attente pour
// qu'une commande périmée ne soit jamais confirmée entre deux passages.
// Renvoie les commandes expirées ; expireAndNotify les envoie aussi en temps réel.
export async function expirePendingOrders(
  db: Db | pg.PoolClient,
  now: Date,
): Promise<{ id: number; tableId: number }[]> {
  const { rows } = await db.query<{ id: number; table_id: number }>(
    `UPDATE orders SET status = 'expired'
      WHERE status = 'pending' AND expires_at <= $1
      RETURNING id, table_id`,
    [now],
  );
  for (const row of rows) {
    await audit(db, {
      userId: null,
      action: 'order.expired',
      entityType: 'order',
      entityId: row.id,
      tableId: row.table_id,
    });
  }
  return rows.map((row) => ({ id: row.id, tableId: row.table_id }));
}

// Expiration + order:updated aux serveurs en shift et à la table (« appelez un serveur »).
export async function expireAndNotify(db: Db, realtime: Realtime, now: Date): Promise<void> {
  const expired = await expirePendingOrders(db, now);
  await notifyOrders(
    db,
    realtime,
    expired.map((order) => order.id),
  );
}

// Passage régulier, lancé au démarrage du serveur. Une erreur (base indisponible) est seulement
// journalisée : le passage suivant réessaie.
export function startExpirySweep(db: Db, realtime: Realtime): NodeJS.Timeout {
  return setInterval(() => {
    expireAndNotify(db, realtime, new Date()).catch((err: unknown) => {
      console.error('expiration des commandes :', err);
    });
  }, EXPIRY_SWEEP_MS);
}
