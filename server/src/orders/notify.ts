import type { Db } from '../db.js';
import type { Realtime } from '../realtime.js';
import { loadTables } from '../tables/view.js';
import { forStation, hasActiveLines, loadOrders, STATIONS } from './view.js';

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

// Écran bar / cuisine, après COMMIT : chaque poste reçoit la commande avec ses lignes seulement.
// `order` : nouvelle commande confirmée ou saisie (station:order), aux postes qui ont quelque
// chose à préparer. `updated` : annulation (avec alerte), transfert, changement de table
// (station:updated), aux postes qui ont des lignes dans la commande et ne l'ont pas encore
// marquée prête.
export async function notifyStations(
  db: Db,
  realtime: Realtime,
  orderIds: readonly number[],
  event: 'order' | 'updated',
  alert = false,
): Promise<void> {
  if (orderIds.length === 0) return;
  try {
    for (const order of await loadOrders(db, orderIds)) {
      for (const station of STATIONS) {
        const view = forStation(order, station);
        if (event === 'order') {
          // TODO : notification push aux baristas / cuisiniers en shift.
          if (hasActiveLines(order, station)) realtime.stationOrder(station, view);
        } else if (view.lines.length > 0 && order.ready[station] === null) {
          realtime.stationUpdated(station, view, alert);
        }
      }
    }
  } catch (err) {
    console.error('temps réel (bar / cuisine) :', err);
  }
}
