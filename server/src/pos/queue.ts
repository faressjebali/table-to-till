import type pg from 'pg';
import { audit, type Db } from '../db.js';
import { notifyOrders } from '../orders/notify.js';
import type { Realtime } from '../realtime.js';
import { BLOCKED_BY_SQL, loadJobs } from './view.js';

// Tâche `in_progress` sans heartbeat de l'agent depuis 2 minutes → `failed` (docs/api.md § PosJob).
export const JOB_TIMEOUT_MS = 2 * 60_000;
// Agent sans heartbeat depuis 30 s (il en envoie toutes les 10 s) → `offline` (contrat v2.3).
export const AGENT_OFFLINE_MS = 30_000;
// Délai entre deux passages de la détection.
export const TIMEOUT_SWEEP_MS = 15_000;

export type AgentState = 'idle' | 'busy' | 'waiting_for_human' | 'offline';
export type AgentStatus = { state: AgentState; lastSeenAt: Date | null };

// État de l'agent (GET /pos/status, pos:status) : `offline` dès que le dernier heartbeat est trop
// ancien, même si le passage régulier ne l'a pas encore enregistré.
function effectiveStatus(row: { state: AgentState; last_seen_at: Date } | undefined, now: Date) {
  if (!row) return { state: 'offline', lastSeenAt: null } satisfies AgentStatus;
  const stale = row.last_seen_at.getTime() <= now.getTime() - AGENT_OFFLINE_MS;
  return {
    state: stale ? 'offline' : row.state,
    lastSeenAt: row.last_seen_at,
  } satisfies AgentStatus;
}

export async function agentStatus(db: Db, now: Date): Promise<AgentStatus> {
  const { rows } = await db.query<{ state: AgentState; last_seen_at: Date }>(
    `SELECT state, last_seen_at FROM pos_agent`,
  );
  return effectiveStatus(rows[0], now);
}

// Heartbeat enregistré ; renvoie l'état d'avant (pos:status seulement quand il change).
export async function recordHeartbeat(
  db: Db,
  state: Exclude<AgentState, 'offline'>,
  now: Date,
): Promise<AgentStatus> {
  const { rows } = await db.query<{ state: AgentState; last_seen_at: Date }>(
    `WITH previous AS (SELECT state, last_seen_at FROM pos_agent),
          saved AS (INSERT INTO pos_agent (state, last_seen_at) VALUES ($1, $2)
                    ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state,
                                                   last_seen_at = EXCLUDED.last_seen_at)
     SELECT state, last_seen_at FROM previous`,
    [state, now],
  );
  return effectiveStatus(rows[0], now);
}

// Agent silencieux depuis 30 s → `offline`, une seule fois. Renvoie le nouvel état, ou null.
export async function markAgentOffline(db: Db, now: Date): Promise<AgentStatus | null> {
  const { rows } = await db.query<{ last_seen_at: Date }>(
    `UPDATE pos_agent SET state = 'offline'
      WHERE state <> 'offline' AND last_seen_at <= $1
      RETURNING last_seen_at`,
    [new Date(now.getTime() - AGENT_OFFLINE_MS)],
  );
  const row = rows[0];
  return row ? { state: 'offline', lastSeenAt: row.last_seen_at } : null;
}

// Prochaine tâche pour l'agent : la plus ancienne `queued` qui n'attend pas une tâche en échec
// de sa table. Rien tant qu'une tâche est `in_progress`. Une tâche `waiting` n'est jamais renvoyée.
export async function nextJobId(db: Db | pg.PoolClient): Promise<number | null> {
  const { rows } = await db.query<{ id: number }>(
    `SELECT j.id FROM pos_jobs j
      WHERE j.status = 'queued'
        AND NOT EXISTS (SELECT 1 FROM pos_jobs WHERE status = 'in_progress')
        AND ${BLOCKED_BY_SQL} IS NULL
      ORDER BY j.created_at, j.id LIMIT 1`,
  );
  return rows[0]?.id ?? null;
}

// pos:job à l'agent pour la prochaine tâche, s'il y en a une (après un réessai, un « fait à la
// main » qui débloque une table…). Un simple réveil : l'agent relit GET /pos/jobs/next.
export async function wakeAgent(db: Db, realtime: Realtime): Promise<void> {
  try {
    const next = await nextJobId(db);
    if (next !== null) realtime.posJob(next);
  } catch (err) {
    console.error('temps réel (file caisse) :', err);
  }
}

// Après COMMIT : la commande d'une tâche enter_order change d'état caisse (Order.pos).
export async function notifyJobOrders(
  db: Db,
  realtime: Realtime,
  jobIds: readonly number[],
): Promise<void> {
  if (jobIds.length === 0) return;
  try {
    const { rows } = await db.query<{ order_id: number }>(
      `SELECT DISTINCT order_id FROM pos_jobs
        WHERE id = ANY($1) AND type = 'enter_order' AND order_id IS NOT NULL`,
      [jobIds],
    );
    await notifyOrders(
      db,
      realtime,
      rows.map((row) => row.order_id),
    );
  } catch (err) {
    console.error('temps réel (file caisse) :', err);
  }
}

// Après COMMIT : pos:failed aux serveurs en shift, et l'état caisse des commandes concernées.
export async function announceFailed(
  db: Db,
  realtime: Realtime,
  jobIds: readonly number[],
): Promise<void> {
  if (jobIds.length === 0) return;
  try {
    for (const job of await loadJobs(db, jobIds)) {
      realtime.posFailed({
        jobId: job.id,
        type: job.type,
        tableNumber: job.tableNumber,
        orderId: job.orderId ?? null,
        error: job.lastError ?? '',
      });
    }
  } catch (err) {
    console.error('temps réel (échecs caisse) :', err);
  }
  await notifyJobOrders(db, realtime, jobIds);
}

// Agent silencieux : jamais remise en file automatiquement, pour ne pas saisir deux fois
// la même chose ; le staff réessaie ou marque « fait à la main ».
export async function failTimedOutJobs(db: Db, now: Date): Promise<number[]> {
  const { rows } = await db.query<{ id: number; table_id: number }>(
    `UPDATE pos_jobs SET status = 'failed', last_error = 'AGENT_TIMEOUT', finished_at = $1
      WHERE status = 'in_progress' AND COALESCE(heartbeat_at, started_at) <= $2
      RETURNING id, table_id`,
    [now, new Date(now.getTime() - JOB_TIMEOUT_MS)],
  );
  for (const row of rows) {
    await audit(db, {
      userId: null,
      action: 'pos.failed',
      entityType: 'pos_job',
      entityId: row.id,
      tableId: row.table_id,
      details: { error: 'AGENT_TIMEOUT' },
    });
  }
  return rows.map((row) => row.id);
}

// Passage régulier, lancé au démarrage du serveur. Une erreur (base indisponible) est seulement
// journalisée : le passage suivant réessaie.
export function startPosTimeoutSweep(db: Db, realtime: Realtime): NodeJS.Timeout {
  return setInterval(() => {
    const now = new Date();
    failTimedOutJobs(db, now)
      .then((ids) => announceFailed(db, realtime, ids))
      .catch((err: unknown) => {
        console.error('tâches caisse sans heartbeat :', err);
      });
    markAgentOffline(db, now)
      .then((status) => {
        if (status) realtime.posStatus(status);
      })
      .catch((err: unknown) => {
        console.error('agent caisse hors ligne :', err);
      });
  }, TIMEOUT_SWEEP_MS);
}
