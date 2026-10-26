import { Router, type RequestHandler } from 'express';
import type pg from 'pg';
import { z } from 'zod';
import { getAuth, requireStaff } from '../auth/middleware.js';
import type { Config } from '../config.js';
import { audit, inTransaction, type Db } from '../db.js';
import { HttpError, validationError } from '../errors.js';
import { sameSecret, type Realtime } from '../realtime.js';
import { isOnShift, requirePrincipal, requireWaiterOnShift } from '../shifts/on-shift.js';
import {
  agentStatus,
  announceFailed,
  nextJobId,
  notifyJobOrders,
  recordHeartbeat,
  wakeAgent,
} from './queue.js';
import { BLOCKED_BY_SQL, loadJob, loadJobs } from './view.js';

const idParam = z.coerce.number().int().positive();

const failBody = z.object({
  error: z.string().min(1).max(100),
  step: z.string().max(200),
});

const heartbeatBody = z.object({
  state: z.enum(['idle', 'busy', 'waiting_for_human']),
  jobId: z.number().int().positive().optional(),
});

const listQuery = z.object({
  status: z.enum(['failed', 'waiting']),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.coerce.number().int().nonnegative().optional(),
});

const resolveBody = z.object({ note: z.string().max(200).nullable().optional() });

// `X-Agent-Key` (docs/api.md § Authentification). Pas de clé configurée : aucun agent accepté.
function requireAgent(config: Config): RequestHandler {
  return (req, _res, next) => {
    const key = req.get('X-Agent-Key') ?? '';
    if (config.agentKey === '' || !sameSecret(key, config.agentKey)) {
      throw new HttpError(401, 'UNAUTHORIZED', 'Invalid agent key');
    }
    next();
  };
}

type JobRow = { status: string; table_id: number; blocked_by: number | null };

// Tâche verrouillée pour changer son statut : 404 si inconnue.
async function lockJob(client: pg.PoolClient, id: number): Promise<JobRow> {
  const { rows } = await client.query<JobRow>(
    `SELECT j.status, j.table_id, ${BLOCKED_BY_SQL} AS blocked_by
       FROM pos_jobs j WHERE j.id = $1 FOR UPDATE`,
    [id],
  );
  const row = rows[0];
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Job not found');
  return row;
}

const isOneInProgress = (err: unknown) =>
  err instanceof Error && 'constraint' in err && err.constraint === 'pos_jobs_one_in_progress';

const anotherInProgress = () => new HttpError(409, 'INVALID_STATUS', 'Another job is in progress');

// File caisse (docs/api.md § 5 « Échecs caisse » et § 7) : l'agent prend une tâche à la fois,
// dans l'ordre de création ; les serveurs en shift réessaient ou règlent les échecs.
export function posRoutes(db: Db, config: Config, realtime: Realtime): Router {
  const router = Router();
  const agent = requireAgent(config);
  const parseId = (raw: unknown) => {
    const id = idParam.safeParse(raw);
    if (!id.success) throw new HttpError(404, 'NOT_FOUND', 'Job not found');
    return id.data;
  };
  router.get('/pos/jobs/next', agent, async (_req, res) => {
    const id = await nextJobId(db);
    const job = id === null ? undefined : await loadJob(db, id);
    if (!job) {
      res.status(204).end();
      return;
    }
    res.json(job);
  });

  // Rejouable : une tâche déjà en cours est renvoyée telle quelle (réponse perdue par l'agent).
  router.post('/pos/jobs/:id/start', agent, async (req, res) => {
    const id = parseId(req.params['id']);
    await inTransaction(db, async (client) => {
      const job = await lockJob(client, id);
      if (job.status === 'in_progress') return;
      if (job.status !== 'queued' || job.blocked_by !== null) {
        throw new HttpError(409, 'INVALID_STATUS', 'Job is not ready');
      }
      const now = new Date();
      await client.query(
        `UPDATE pos_jobs SET status = 'in_progress', started_at = $2, heartbeat_at = $2,
                             attempts = attempts + 1
          WHERE id = $1`,
        [id, now],
      );
    }).catch((err: unknown) => {
      throw isOneInProgress(err) ? anotherInProgress() : err;
    });
    res.json(await loadJob(db, id));
  });

  router.post('/pos/jobs/:id/done', agent, async (req, res) => {
    const id = parseId(req.params['id']);
    const changed = await inTransaction(db, async (client) => {
      const job = await lockJob(client, id);
      if (job.status === 'done') return false;
      if (job.status !== 'in_progress') {
        throw new HttpError(409, 'INVALID_STATUS', 'Job is not in progress');
      }
      await client.query(`UPDATE pos_jobs SET status = 'done', finished_at = $2 WHERE id = $1`, [
        id,
        new Date(),
      ]);
      await audit(client, {
        userId: null,
        action: 'pos.done',
        entityType: 'pos_job',
        entityId: id,
        tableId: job.table_id,
      });
      // TODO : une annulation `waiting` de la table repasse `queued` quand d'autres articles
      // sont saisis.
      return true;
    });
    if (changed) await notifyJobOrders(db, realtime, [id]);
    res.json(await loadJob(db, id));
  });

  router.post('/pos/jobs/:id/fail', agent, async (req, res) => {
    const id = parseId(req.params['id']);
    const body = failBody.safeParse(req.body);
    if (!body.success) throw validationError(body.error);
    const changed = await inTransaction(db, async (client) => {
      const job = await lockJob(client, id);
      if (job.status === 'failed') return false;
      if (job.status !== 'in_progress') {
        throw new HttpError(409, 'INVALID_STATUS', 'Job is not in progress');
      }
      await client.query(
        `UPDATE pos_jobs SET status = 'failed', last_error = $2, last_step = $3, finished_at = $4
          WHERE id = $1`,
        [id, body.data.error, body.data.step, new Date()],
      );
      await audit(client, {
        userId: null,
        action: 'pos.failed',
        entityType: 'pos_job',
        entityId: id,
        tableId: job.table_id,
        details: { error: body.data.error, step: body.data.step },
      });
      return true;
    });
    if (changed) {
      await announceFailed(db, realtime, [id]);
      // Les tâches des autres tables continuent.
      await wakeAgent(db, realtime);
    }
    res.json(await loadJob(db, id));
  });

  // Toutes les 10 s. Le heartbeat de la tâche en cours repousse son délai de 2 minutes.
  router.post('/pos/heartbeat', agent, async (req, res) => {
    const body = heartbeatBody.safeParse(req.body);
    if (!body.success) throw validationError(body.error);
    const now = new Date();
    if (body.data.jobId !== undefined) {
      await db.query(
        `UPDATE pos_jobs SET heartbeat_at = $2 WHERE id = $1 AND status = 'in_progress'`,
        [body.data.jobId, now],
      );
    }
    const previous = await recordHeartbeat(db, body.data.state, now);
    if (previous.state !== body.data.state) {
      realtime.posStatus({ state: body.data.state, lastSeenAt: now });
    }
    res.status(204).end();
  });

  // État de l'agent, relu après une reconnexion (pos:status ne rejoue rien).
  router.get(
    '/pos/status',
    requireStaff(db, config, { roles: ['waiter', 'manager'] }),
    async (_req, res) => {
      const { user } = getAuth(res);
      if (user.role === 'waiter' && !(await isOnShift(db, user.id))) {
        throw new HttpError(403, 'NOT_ON_SHIFT', 'Not on shift');
      }
      res.json(await agentStatus(db, new Date()));
    },
  );

  // Échecs et annulations en attente, les plus anciens d'abord.
  router.get('/pos/jobs', ...requireWaiterOnShift(db, config), async (req, res) => {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) throw validationError(parsed.error);
    const { status, limit, cursor } = parsed.data;
    const { rows } = await db.query<{ id: number }>(
      `SELECT id FROM pos_jobs WHERE status = $1 AND id > $2 ORDER BY id LIMIT $3`,
      [status, cursor ?? 0, limit + 1],
    );
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    res.json({
      items: await loadJobs(
        db,
        page.map((row) => row.id),
      ),
      nextCursor: rows.length > limit && last ? String(last.id) : null,
    });
  });

  // Réessai par n'importe quel serveur en shift : la tâche reprend sa place dans la file.
  router.post('/pos/jobs/:id/retry', ...requireWaiterOnShift(db, config), async (req, res) => {
    const id = parseId(req.params['id']);
    const { user } = getAuth(res);
    await inTransaction(db, async (client) => {
      const job = await lockJob(client, id);
      if (job.status !== 'failed') throw new HttpError(409, 'INVALID_STATUS', 'Job is not failed');
      await client.query(
        `UPDATE pos_jobs SET status = 'queued', finished_at = NULL WHERE id = $1`,
        [id],
      );
      await audit(client, {
        userId: user.id,
        action: 'pos.retry',
        entityType: 'pos_job',
        entityId: id,
        tableId: job.table_id,
      });
    });
    await notifyJobOrders(db, realtime, [id]);
    await wakeAgent(db, realtime);
    res.json(await loadJob(db, id));
  });

  // Fait à la main au comptoir : la table est débloquée, la tâche n'est plus jamais tapée.
  router.post(
    '/pos/jobs/:id/resolve-manually',
    ...requireWaiterOnShift(db, config),
    requirePrincipal(db),
    async (req, res) => {
      const id = parseId(req.params['id']);
      const body = resolveBody.safeParse(req.body ?? {});
      if (!body.success) throw validationError(body.error);
      const note = body.data.note ?? null;
      const { user } = getAuth(res);
      await inTransaction(db, async (client) => {
        const job = await lockJob(client, id);
        if (job.status !== 'failed') {
          throw new HttpError(409, 'INVALID_STATUS', 'Job is not failed');
        }
        await client.query(
          `UPDATE pos_jobs SET status = 'manual', resolved_by = $2, resolve_note = $3,
                               finished_at = $4
            WHERE id = $1`,
          [id, user.id, note, new Date()],
        );
        await audit(client, {
          userId: user.id,
          action: 'pos.manual',
          entityType: 'pos_job',
          entityId: id,
          tableId: job.table_id,
          note,
        });
      });
      await notifyJobOrders(db, realtime, [id]);
      await wakeAgent(db, realtime);
      res.json(await loadJob(db, id));
    },
  );

  return router;
}
