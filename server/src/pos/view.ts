import type pg from 'pg';
import type { Db } from '../db.js';

// PosJob de docs/api.md § PosJob : champs communs + champs propres au type (payload).
export type PosJob = {
  id: number;
  type: string;
  orderId?: number;
  tableNumber: number;
  toTableNumber?: number;
  status: string;
  blockedByJobId: number | null;
  attempts: number;
  lastError: string | null;
  createdAt: Date;
  startedAt: Date | null;
} & Record<string, unknown>;

// Tâche en échec qui bloque la tâche `j` : la plus ancienne tâche `failed` créée avant elle qui
// touche une de ses tables (départ ou arrivée). Les autres tables continuent.
export const BLOCKED_BY_SQL = `(
  SELECT f.id FROM pos_jobs f
   WHERE f.status = 'failed'
     AND (f.created_at, f.id) < (j.created_at, j.id)
     AND (f.table_id IN (j.table_id, j.to_table_id) OR f.to_table_id IN (j.table_id, j.to_table_id))
   ORDER BY f.created_at, f.id LIMIT 1)`;

type JobRow = {
  id: number;
  type: string;
  status: string;
  order_id: number | null;
  table_number: number;
  to_table_number: number | null;
  payload: Record<string, unknown>;
  blocked_by: number | null;
  attempts: number;
  last_error: string | null;
  created_at: Date;
  started_at: Date | null;
};

export async function loadJobs(db: Db | pg.PoolClient, ids: readonly number[]): Promise<PosJob[]> {
  if (ids.length === 0) return [];
  const { rows } = await db.query<JobRow>(
    `SELECT j.id, j.type, j.status, j.order_id, t.number AS table_number,
            tt.number AS to_table_number, j.payload, ${BLOCKED_BY_SQL} AS blocked_by,
            j.attempts, j.last_error, j.created_at, j.started_at
       FROM pos_jobs j
       JOIN tables t ON t.id = j.table_id
       LEFT JOIN tables tt ON tt.id = j.to_table_id
      WHERE j.id = ANY($1)`,
    [ids],
  );
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    if (!row) return [];
    return [
      {
        id: row.id,
        type: row.type,
        ...(row.type === 'enter_order' && row.order_id !== null ? { orderId: row.order_id } : {}),
        tableNumber: row.table_number,
        ...(row.to_table_number !== null ? { toTableNumber: row.to_table_number } : {}),
        ...row.payload,
        status: row.status,
        blockedByJobId: row.blocked_by,
        attempts: row.attempts,
        lastError: row.last_error,
        createdAt: row.created_at,
        startedAt: row.started_at,
      },
    ];
  });
}

export async function loadJob(db: Db | pg.PoolClient, id: number): Promise<PosJob | undefined> {
  return (await loadJobs(db, [id]))[0];
}
