import type { Db } from '../db.js';
import type { Realtime } from '../realtime.js';
import { loadTables } from '../tables/view.js';
import { loadOrders } from './view.js';

// Après COMMIT seulement : order:updated (ou order:new) pour chaque commande, puis table:updated
// pour leurs tables (état, montant en cours, commandes en attente). Une erreur ici ne doit pas
// faire échouer l'action déjà enregistrée : les apps rechargent via REST à la reconnexion.
export async function notifyOrders(
  db: Db,
  realtime: Realtime,
  orderIds: readonly number[],
  event: 'new' | 'updated' = 'updated',
): Promise<void> {
  if (orderIds.length === 0) return;
  try {
    const orders = await loadOrders(db, orderIds);
    for (const order of orders) {
      if (event === 'new') realtime.orderNew(order);
      else realtime.orderUpdated(order);
    }
    await notifyTables(
      db,
      realtime,
      orders.map((order) => order.table.id),
    );
  } catch (err) {
    console.error('temps réel (commandes) :', err);
  }
}

// table:updated aux serveurs en shift, après COMMIT.
export async function notifyTables(
  db: Db,
  realtime: Realtime,
  tableIds: readonly number[],
): Promise<void> {
  if (tableIds.length === 0) return;
  try {
    for (const table of await loadTables(db, [...new Set(tableIds)])) realtime.tableUpdated(table);
  } catch (err) {
    console.error('temps réel (tables) :', err);
  }
}
