import type pg from 'pg';
import type { Db } from '../db.js';
import { localized, type Localized, type Station } from '../menu/items.js';

// Écran bar / cuisine (docs/api.md § 5 ter) : une ligne `both` s'affiche aux deux postes.
export type StationName = 'bar' | 'kitchen';
export const STATIONS = ['bar', 'kitchen'] as const satisfies readonly StationName[];

type Ready = { at: Date; by: { id: number; name: string } } | null;

type PosStatus = 'not_sent' | 'queued' | 'entered' | 'failed' | 'manual';

// Forme Order de docs/api.md § 2.
export type Order = {
  id: number;
  table: { id: number; number: number };
  tableSessionId: number | null;
  source: 'qr' | 'waiter' | 'direct';
  status: 'pending' | 'confirmed' | 'rejected' | 'expired';
  lines: {
    id: number;
    menuItemId: number;
    name: Localized;
    quantity: number;
    note: string | null;
    unitPrice: number;
    discountPercent: number;
    lineTotal: number;
    status: 'active' | 'cancelled' | 'transferred';
    station: Station;
    choices?: { group: string; menuItemId: number; name: Localized }[];
  }[];
  total: number;
  createdAt: Date;
  confirmedAt: Date | null;
  confirmedBy: { id: number; name: string } | null;
  offer: null;
  ready: Record<StationName, Ready>;
  pos: { status: PosStatus; error: string | null } | null;
};

type OrderRow = {
  id: number;
  table_id: number;
  table_number: number;
  table_session_id: number | null;
  source: Order['source'];
  status: Order['status'];
  created_at: Date;
  confirmed_at: Date | null;
  confirmed_by_id: number | null;
  confirmed_by_name: string | null;
  job_status: string | null;
  job_error: string | null;
};

type LineRow = {
  id: number;
  order_id: number;
  menu_item_id: number;
  name_fr: string;
  name_en: string | null;
  quantity: number;
  note: string | null;
  unit_price: number;
  discount_percent: number;
  status: Order['lines'][number]['status'];
  station: Station;
  choices: { group: string; menuItemId: number; nameFr: string; nameEn: string | null }[] | null;
};

// Tâche enter_order → état caisse de la commande (docs/api.md § Order, pos.status).
function posStatus(jobStatus: string | null): PosStatus {
  switch (jobStatus) {
    case null:
      return 'not_sent';
    case 'done':
      return 'entered';
    case 'failed':
      return 'failed';
    case 'manual':
      return 'manual';
    default:
      return 'queued';
  }
}

// lineTotal = quantité × prix × (100 − remise) / 100, arrondi au millime ;
// une ligne annulée ou transférée compte 0 dans le total.
const lineTotal = (line: LineRow) =>
  Math.round((line.quantity * line.unit_price * (100 - line.discount_percent)) / 100);

export async function loadOrders(db: Db | pg.PoolClient, ids: readonly number[]): Promise<Order[]> {
  if (ids.length === 0) return [];
  const [{ rows: orders }, { rows: lines }, { rows: ready }] = await Promise.all([
    db.query<OrderRow>(
      `SELECT o.id, o.table_id, t.number AS table_number, o.table_session_id, o.source, o.status,
              o.created_at, o.confirmed_at, u.id AS confirmed_by_id, u.name AS confirmed_by_name,
              j.status AS job_status, j.last_error AS job_error
         FROM orders o
         JOIN tables t ON t.id = o.table_id
         LEFT JOIN users u ON u.id = o.confirmed_by
         LEFT JOIN LATERAL (SELECT status, last_error FROM pos_jobs
                             WHERE order_id = o.id AND type = 'enter_order'
                             ORDER BY id DESC LIMIT 1) j ON true
        WHERE o.id = ANY($1)`,
      [ids],
    ),
    db.query<LineRow>(
      `SELECT l.id, l.order_id, l.menu_item_id, l.name_fr, l.name_en, l.quantity, l.note,
              l.unit_price, l.discount_percent, l.status, l.station,
              (SELECT json_agg(json_build_object('group', c.group_key, 'menuItemId', c.menu_item_id,
                                                 'nameFr', i.name_fr, 'nameEn', i.name_en)
                               ORDER BY g.sort_order, c.group_key)
                 FROM order_line_choices c
                 JOIN menu_items i ON i.id = c.menu_item_id
                 LEFT JOIN menu_item_choice_groups g
                   ON g.menu_item_id = l.menu_item_id AND g.group_key = c.group_key
                WHERE c.order_line_id = l.id) AS choices
         FROM order_lines l
        WHERE l.order_id = ANY($1)
        ORDER BY l.id`,
      [ids],
    ),
    db.query<{
      order_id: number;
      station: StationName;
      ready_at: Date;
      user_id: number;
      user_name: string;
    }>(
      `SELECT r.order_id, r.station, r.ready_at, u.id AS user_id, u.name AS user_name
         FROM order_ready r JOIN users u ON u.id = r.ready_by
        WHERE r.order_id = ANY($1)`,
      [ids],
    ),
  ]);

  const byId = new Map(
    orders.map((row): [number, Order] => [
      row.id,
      {
        id: row.id,
        table: { id: row.table_id, number: row.table_number },
        tableSessionId: row.table_session_id,
        source: row.source,
        status: row.status,
        lines: [],
        total: 0,
        createdAt: row.created_at,
        confirmedAt: row.confirmed_at,
        confirmedBy:
          row.confirmed_by_id === null || row.confirmed_by_name === null
            ? null
            : { id: row.confirmed_by_id, name: row.confirmed_by_name },
        offer: null,
        ready: { bar: null, kitchen: null },
        pos: {
          status: posStatus(row.job_status),
          error: row.job_status === 'failed' ? row.job_error : null,
        },
      },
    ]),
  );

  for (const line of lines) {
    const order = byId.get(line.order_id);
    if (!order) continue;
    const total = lineTotal(line);
    order.lines.push({
      id: line.id,
      menuItemId: line.menu_item_id,
      name: localized(line.name_fr, line.name_en),
      quantity: line.quantity,
      note: line.note,
      unitPrice: line.unit_price,
      discountPercent: line.discount_percent,
      lineTotal: total,
      status: line.status,
      station: line.station,
      ...(line.choices && {
        choices: line.choices.map((c) => ({
          group: c.group,
          menuItemId: c.menuItemId,
          name: localized(c.nameFr, c.nameEn),
        })),
      }),
    });
    if (line.status === 'active') order.total += total;
  }
  for (const row of ready) {
    const order = byId.get(row.order_id);
    if (order) {
      order.ready[row.station] = { at: row.ready_at, by: { id: row.user_id, name: row.user_name } };
    }
  }

  // Même ordre que les ids demandés.
  return ids.flatMap((id) => {
    const order = byId.get(id);
    return order ? [order] : [];
  });
}

export async function loadOrder(db: Db | pg.PoolClient, id: number): Promise<Order> {
  const [order] = await loadOrders(db, [id]);
  if (!order) throw new Error(`commande ${String(id)} introuvable`);
  return order;
}

const onStation = (line: Order['lines'][number], station: StationName) =>
  line.station === station || line.station === 'both';

// La commande vue par un poste : seulement ses lignes (annulées et transférées comprises,
// affichées barrées) ; le total ne compte que ces lignes.
export function forStation(order: Order, station: StationName): Order {
  const lines = order.lines.filter((line) => onStation(line, station));
  const total = lines.reduce((sum, l) => (l.status === 'active' ? sum + l.lineTotal : sum), 0);
  return { ...order, lines, total };
}

// Le poste a quelque chose à préparer dans cette commande.
export const hasActiveLines = (order: Order, station: StationName) =>
  order.lines.some((line) => line.status === 'active' && onStation(line, station));
