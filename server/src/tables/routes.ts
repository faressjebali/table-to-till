import { Router } from 'express';
import type pg from 'pg';
import { z } from 'zod';
import { getAuth } from '../auth/middleware.js';
import type { Config } from '../config.js';
import { audit, inTransaction, type Db } from '../db.js';
import { HttpError, validationError } from '../errors.js';
import { notifyTables } from '../orders/notify.js';
import { wakeAgent } from '../pos/queue.js';
import { loadJob } from '../pos/view.js';
import type { Realtime } from '../realtime.js';
import { requirePrincipal, requireWaiterOnShift } from '../shifts/on-shift.js';
import { loadOpenSession, loadTables } from './view.js';

const idParam = z.coerce.number().int().positive();

const payBody = z.object({ method: z.enum(['cash', 'card']) });

function parseId(raw: unknown): number {
  const id = idParam.safeParse(raw);
  if (!id.success) throw new HttpError(404, 'NOT_FOUND', 'Table not found');
  return id.data;
}

// Session ouverte de la table, verrouillée jusqu'à la fin de la transaction (deux encaissements
// en même temps : le second voit la table libre). Table inconnue → 404 ; libre → INVALID_STATUS.
async function lockOpenSession(client: pg.PoolClient, tableId: number) {
  const { rows } = await client.query<{ session_id: number | null }>(
    `SELECT s.id AS session_id
       FROM tables t
       LEFT JOIN table_sessions s ON s.table_id = t.id AND s.closed_at IS NULL
      WHERE t.id = $1
        FOR UPDATE OF t`,
    [tableId],
  );
  const row = rows[0];
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Table not found');
  const found = row.session_id === null ? null : await loadOpenSession(client, tableId);
  if (!found) throw new HttpError(409, 'INVALID_STATUS', 'No open session');
  return found.session;
}

// Tâche pay_table ou print_bill. expectedTotal : le net que l'agent lit en caisse (fieldTotal) ;
// TODO : remise staff déduite quand elle existera.
async function insertJob(
  client: pg.PoolClient,
  type: 'pay_table' | 'print_bill',
  tableId: number,
  payload: Record<string, unknown>,
  now: Date,
): Promise<number> {
  const { rows } = await client.query<{ id: number }>(
    `INSERT INTO pos_jobs (type, table_id, payload, created_at) VALUES ($1, $2, $3, $4) RETURNING id`,
    [type, tableId, payload, now],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('tâche caisse non créée');
  return id;
}

// Routes tables de docs/api.md § 3 (jeton du QR) et § 5 (plan de la salle, encaissement, addition).
export function tableRoutes(db: Db, config: Config, realtime: Realtime): Router {
  const router = Router();

  // Plan des tables : serveurs en shift seulement, lecture comprise.
  router.get('/tables', ...requireWaiterOnShift(db, config), async (_req, res) => {
    res.json({ tables: await loadTables(db) });
  });

  // Commandes de la table : sa session ouverte, ou 404 si la table est libre (ou inconnue).
  router.get('/tables/:id/session', ...requireWaiterOnShift(db, config), async (req, res) => {
    const id = idParam.safeParse(req.params['id']);
    const found = id.success ? await loadOpenSession(db, id.data) : null;
    if (!found) throw new HttpError(404, 'NOT_FOUND', 'No open session');
    // TODO : les offerts de la table, quand ils existeront.
    res.json({ ...found, gifts: [] });
  });

  // Encaissement (Espèces ou Carte) par le principal : la session est fermée tout de suite dans
  // l'app (table libre), l'agent encaisse ensuite dans LegacyPOS. En une seule fois.
  // TODO : le barista encaisse aussi une vente directe ; TODO : principal de la table.
  router.post(
    '/tables/:id/pay',
    ...requireWaiterOnShift(db, config),
    requirePrincipal(db),
    async (req, res) => {
      const tableId = parseId(req.params['id']);
      const body = payBody.safeParse(req.body ?? {});
      if (!body.success) throw validationError(body.error);
      const { method } = body.data;
      const { user } = getAuth(res);
      const now = new Date();
      const jobId = await inTransaction(db, async (client) => {
        const session = await lockOpenSession(client, tableId);
        // Une annulation qui attend un autre article serait perdue : la retirer ou attendre.
        const { rowCount } = await client.query(
          `SELECT 1 FROM pos_jobs WHERE table_id = $1 AND status = 'waiting'`,
          [tableId],
        );
        if (rowCount) {
          throw new HttpError(409, 'CANCEL_WAITING', 'A cancellation is waiting on this table');
        }
        await client.query(
          `UPDATE table_sessions SET closed_at = $2, payment_method = $3, closed_by = $4
            WHERE id = $1`,
          [session.id, now, method, user.id],
        );
        const id = await insertJob(
          client,
          'pay_table',
          tableId,
          { method, expectedTotal: session.total },
          now,
        );
        await audit(client, {
          userId: user.id,
          action: 'table.paid',
          entityType: 'table_session',
          entityId: session.id,
          tableId,
          details: { method, total: session.total, jobId: id },
        });
        return id;
      });
      await notifyTables(db, realtime, [tableId]);
      realtime.reportUpdated();
      await wakeAgent(db, realtime);
      res.json(await loadJob(db, jobId));
    },
  );

  // Addition imprimée par l'agent dans LegacyPOS : tout serveur en shift, renfort compris.
  router.post('/tables/:id/print-bill', ...requireWaiterOnShift(db, config), async (req, res) => {
    const tableId = parseId(req.params['id']);
    const { user } = getAuth(res);
    const now = new Date();
    const jobId = await inTransaction(db, async (client) => {
      const session = await lockOpenSession(client, tableId);
      const id = await insertJob(
        client,
        'print_bill',
        tableId,
        { expectedTotal: session.total },
        now,
      );
      await audit(client, {
        userId: user.id,
        action: 'table.bill_printed',
        entityType: 'table_session',
        entityId: session.id,
        tableId,
        details: { total: session.total, jobId: id },
      });
      return id;
    });
    await wakeAgent(db, realtime);
    res.json(await loadJob(db, jobId));
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
