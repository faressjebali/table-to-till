import type { Db } from '../db.js';
import type { Order, StationName } from '../orders/view.js';
import { waitersOnShift } from '../shifts/on-shift.js';
import type { PushMessage } from './send.js';

// Destinataires des notifications push (docs/api.md § 8) et contenu de chaque type.

// order:new, order:ready.
export async function waitersOnShiftIds(db: Db): Promise<number[]> {
  return (await waitersOnShift(db)).map((waiter) => waiter.id);
}

// station:order : baristas (bar) ou cuisiniers (kitchen) en shift.
export async function stationOnShiftIds(db: Db, station: 'bar' | 'kitchen'): Promise<number[]> {
  const { rows } = await db.query<{ id: number }>(
    `SELECT u.id FROM shifts s JOIN users u ON u.id = s.user_id
      WHERE s.ended_at IS NULL AND u.disabled_at IS NULL AND u.role = $1`,
    [station === 'bar' ? 'barista' : 'chef'],
  );
  return rows.map((row) => row.id);
}

// Clôture manquante.
export async function managerIds(db: Db): Promise<number[]> {
  const { rows } = await db.query<{ id: number }>(
    `SELECT id FROM users WHERE role = 'manager' AND disabled_at IS NULL`,
  );
  return rows.map((row) => row.id);
}

function articles(count: number): string {
  return count === 1 ? '1 article' : `${String(count)} articles`;
}

// « Table 7 · 3 articles » : jamais de note ni de montant.
export function orderNewMessage(order: Order): PushMessage {
  const count = order.lines.reduce((sum, line) => sum + line.quantity, 0);
  return {
    type: 'order:new',
    tag: `order-${String(order.id)}`,
    title: 'Nouvelle commande',
    body: `Table ${String(order.table.number)} · ${articles(count)}`,
    // Toucher la notification ouvre cette commande dans l'onglet Commandes (public/sw.js). Adresse
    // relative à celle de l'app staff (`/` en local, `/staff/` sur un hébergement).
    url: `./?order=${String(order.id)}`,
  };
}

// station:order, au barista ou au cuisinier : « Table 7 · 2 articles », seulement les articles
// actifs de son poste (`order` : vue du poste, comme forStation).
export function stationOrderMessage(order: Order, station: StationName): PushMessage {
  const count = order.lines.reduce(
    (sum, line) => (line.status === 'active' ? sum + line.quantity : sum),
    0,
  );
  return {
    type: 'station:order',
    tag: `station-${String(order.id)}-${station}`,
    title: 'Nouvelle commande',
    body: `Table ${String(order.table.number)} · ${articles(count)}`,
    url: './',
  };
}

// « Table 7 : boissons prêtes ».
export function orderReadyMessage(data: {
  orderId: number;
  table: { number: number };
  station: 'bar' | 'kitchen';
}): PushMessage {
  const what = data.station === 'bar' ? 'boissons prêtes' : 'plats prêts';
  return {
    type: 'order:ready',
    tag: `ready-${String(data.orderId)}-${data.station}`,
    title: 'Commande prête',
    body: `Table ${String(data.table.number)} : ${what}`,
    url: './',
  };
}
