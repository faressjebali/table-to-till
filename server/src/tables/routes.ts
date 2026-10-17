import { Router } from 'express';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { HttpError } from '../errors.js';
import { requireWaiterOnShift } from '../shifts/on-shift.js';

type TableRow = {
  id: number;
  number: number;
  layout_x: number;
  layout_y: number;
  layout_w: number;
  layout_h: number;
  layout_shape: 'square' | 'round';
  open_session_id: number | null;
  open_total: number;
  pending_orders: number;
  principal_id: number | null;
};

// Forme Table de docs/api.md § 2. GET /tables ne renvoie que les tables réelles : jamais d'offre.
function toTable(row: TableRow) {
  return {
    id: row.id,
    number: row.number,
    kind: 'real' as const,
    state: row.open_session_id === null ? ('free' as const) : ('occupied' as const),
    openSessionId: row.open_session_id,
    openTotal: row.open_total,
    pendingOrders: row.pending_orders,
    layout: {
      x: row.layout_x,
      y: row.layout_y,
      w: row.layout_w,
      h: row.layout_h,
      shape: row.layout_shape,
    },
    offer: null,
    principalId: row.principal_id,
  };
}

// Routes tables de docs/api.md § 3 (jeton du QR) et § 5 (plan de la salle).
export function tableRoutes(db: Db, config: Config): Router {
  const router = Router();

  // Plan des tables : serveurs en shift seulement, lecture comprise.
  router.get('/tables', ...requireWaiterOnShift(db, config), async (_req, res) => {
    // openTotal : lignes actives des commandes confirmées de la session ouverte, remise déduite,
    // chaque ligne arrondie au millime (docs/api.md § Order). Une commande en attente ne compte pas.
    const { rows } = await db.query<TableRow>(
      `SELECT t.id, t.number, t.layout_x, t.layout_y, t.layout_w, t.layout_h, t.layout_shape,
              s.id AS open_session_id, s.principal_id,
              coalesce((SELECT sum(round(l.quantity * l.unit_price * (100 - l.discount_percent) / 100.0))
                          FROM orders o JOIN order_lines l ON l.order_id = o.id
                         WHERE o.table_session_id = s.id AND o.status = 'confirmed'
                           AND l.status = 'active'), 0)::int AS open_total,
              (SELECT count(*) FROM orders o
                WHERE o.table_id = t.id AND o.status = 'pending' AND o.expires_at > now())::int
                AS pending_orders
         FROM tables t
         LEFT JOIN table_sessions s ON s.table_id = t.id AND s.closed_at IS NULL
        WHERE t.kind = 'real'
        ORDER BY t.number`,
    );
    res.json({ tables: rows.map(toTable) });
  });

  // Jeton du QR (sans connexion) : seulement une table réelle. Inconnu → « demandez au serveur ».
  router.get('/tables/:tableToken', async (req, res) => {
    const { rows } = await db.query<{ id: number; number: number }>(
      `SELECT id, number FROM tables WHERE qr_token = $1 AND kind = 'real'`,
      [req.params['tableToken']],
    );
    const table = rows[0];
    if (!table) throw new HttpError(404, 'TABLE_NOT_FOUND', 'Unknown table');
    res.json({ id: table.id, number: table.number });
  });

  return router;
}
