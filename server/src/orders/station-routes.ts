import { Router } from 'express';
import { z } from 'zod';
import { getAuth } from '../auth/middleware.js';
import type { Config } from '../config.js';
import { audit, inTransaction, type Db } from '../db.js';
import { HttpError } from '../errors.js';
import { TIME_ZONE } from '../menu/availability.js';
import type { Realtime } from '../realtime.js';
import { requireOnShift } from '../shifts/on-shift.js';
import { forStation, hasActiveLines, loadOrder, loadOrders, type StationName } from './view.js';

const idParam = z.coerce.number().int().positive();

// Le barista prépare le bar, le cuisinier la cuisine.
const stationOf = (role: string): StationName => (role === 'barista' ? 'bar' : 'kitchen');

// Écran bar / cuisine (docs/api.md § 5 ter), barista et cuisinier en shift.
export function stationRoutes(db: Db, config: Config, realtime: Realtime): Router {
  const router = Router();
  const onShift = requireOnShift(db, config, ['barista', 'chef']);

  // Commandes confirmées du jour (heure de Tunis) que mon poste n'a pas encore marquées prêtes,
  // les plus anciennes d'abord. Une commande dont toutes les lignes de mon poste sont annulées
  // ou transférées n'a plus rien à préparer : elle sort de la liste.
  router.get('/station-orders', ...onShift, async (_req, res) => {
    const station = stationOf(getAuth(res).user.role);
    const { rows } = await db.query<{ id: number }>(
      `SELECT o.id FROM orders o
        WHERE o.status = 'confirmed'
          AND o.confirmed_at >= date_trunc('day', $1::timestamptz AT TIME ZONE $2) AT TIME ZONE $2
          AND NOT EXISTS (SELECT 1 FROM order_ready r WHERE r.order_id = o.id AND r.station = $3)
          AND EXISTS (SELECT 1 FROM order_lines l
                       WHERE l.order_id = o.id AND l.status = 'active'
                         AND l.station IN ($3, 'both'))
        ORDER BY o.confirmed_at, o.id`,
      [new Date(), TIME_ZONE, station],
    );
    const orders = await loadOrders(
      db,
      rows.map((row) => row.id),
    );
    res.json({ items: orders.map((order) => forStation(order, station)) });
  });

  // Prêt : la partie de mon poste disparaît de ma liste, les serveurs en shift sont prévenus.
  router.post('/orders/:id/ready', ...onShift, async (req, res) => {
    const id = idParam.safeParse(req.params['id']);
    if (!id.success) throw new HttpError(404, 'NOT_FOUND', 'Order not found');
    const { user } = getAuth(res);
    const station = stationOf(user.role);

    await inTransaction(db, async (client) => {
      const { rows } = await client.query<{ status: string; table_id: number }>(
        `SELECT status, table_id FROM orders WHERE id = $1 FOR UPDATE`,
        [id.data],
      );
      const row = rows[0];
      if (!row) throw new HttpError(404, 'NOT_FOUND', 'Order not found');
      if (row.status !== 'confirmed') {
        throw new HttpError(409, 'INVALID_STATUS', 'Order is not confirmed');
      }
      if (!hasActiveLines(await loadOrder(client, id.data), station)) {
        throw new HttpError(409, 'INVALID_STATUS', 'Nothing to prepare at this station');
      }
      const { rowCount } = await client.query(
        `INSERT INTO order_ready (order_id, station, ready_by, ready_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [id.data, station, user.id, new Date()],
      );
      if (!rowCount) throw new HttpError(409, 'INVALID_STATUS', 'Already ready');
      await audit(client, {
        userId: user.id,
        action: 'order.ready',
        entityType: 'order',
        entityId: id.data,
        tableId: row.table_id,
        details: { station },
      });
    });

    const view = forStation(await loadOrder(db, id.data), station);
    // Les autres baristas (ou cuisiniers) en shift la retirent aussi de leur liste.
    realtime.stationUpdated(station, view, false);
    // TODO : notification push aux serveurs en shift (orderReadyMessage).
    realtime.orderReady({ orderId: view.id, table: view.table, station });
    res.json(view);
  });

  return router;
}
