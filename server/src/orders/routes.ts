import { Router } from 'express';
import type pg from 'pg';
import { z } from 'zod';
import { getAuth } from '../auth/middleware.js';
import type { Config } from '../config.js';
import { audit, inTransaction, type Db } from '../db.js';
import { HttpError, validationError } from '../errors.js';
import { isCafeOpen } from '../menu/availability.js';
import type { Realtime } from '../realtime.js';
import { requireWaiterOnShift, waitersOnShift } from '../shifts/on-shift.js';
import { expireAndNotify } from './expiry.js';
import { linesTotal, orderLinesSchema, prepareLines, type PreparedLine } from './lines.js';
import { notifyOrders, notifyTables } from './notify.js';
import { loadOrder, loadOrders } from './view.js';

const idParam = z.coerce.number().int().positive();

const createBody = z.object({
  clientRequestId: z.uuid(),
  tableToken: z.string().min(1),
  lines: orderLinesSchema,
});

const staffOrderBody = z.object({
  clientRequestId: z.uuid(),
  tableId: z.number().int().positive(),
  // Seulement sur une table d'offre : interdits sur une table réelle.
  requestedById: z.number().int().positive().optional(),
  forClient: z.boolean().optional(),
  lines: orderLinesSchema,
});

const pendingQuery = z.object({
  status: z.literal('pending'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.coerce.number().int().nonnegative().optional(),
});

const rejectBody = z.object({ reason: z.string().max(200).nullable().optional() });

type Created = { orderId: number; status: 'pending'; total: number; expiresAt: Date };

function fieldError(field: string, message: string): HttpError {
  return new HttpError(400, 'VALIDATION_ERROR', 'Invalid request body', {
    fields: [{ field, message }],
  });
}

// clientRequestId déjà enregistré par une requête concurrente : la transaction est annulée.
class DuplicateRequest extends Error {}

// Réponse de POST /orders, aussi renvoyée telle quelle pour un clientRequestId déjà reçu.
async function createdResponse(db: Db | pg.PoolClient, orderId: number): Promise<Created> {
  const { rows } = await db.query<{ total: number; expires_at: Date }>(
    `SELECT o.expires_at,
            coalesce((SELECT sum(l.quantity * l.unit_price) FROM order_lines l
                       WHERE l.order_id = o.id), 0)::int AS total
       FROM orders o WHERE o.id = $1`,
    [orderId],
  );
  const row = rows[0];
  if (!row) throw new Error(`commande ${String(orderId)} introuvable`);
  return { orderId, status: 'pending', total: row.total, expiresAt: row.expires_at };
}

async function insertLines(client: pg.PoolClient, orderId: number, lines: PreparedLine[]) {
  for (const line of lines) {
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO order_lines (order_id, menu_item_id, name_fr, name_en, quantity, unit_price, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        orderId,
        line.menuItemId,
        line.nameFr,
        line.nameEn,
        line.quantity,
        line.unitPrice,
        line.note,
      ],
    );
    const lineId = rows[0]?.id;
    for (const choice of line.choices) {
      await client.query(
        `INSERT INTO order_line_choices (order_line_id, group_key, menu_item_id) VALUES ($1, $2, $3)`,
        [lineId, choice.group, choice.menuItemId],
      );
    }
  }
}

// Principal en cours : celui dont la caisse reçoit les tables qui s'ouvrent (docs/api.md § 5).
// Un seul principal à la fois pour l'instant ; la passation à deux principaux arrive plus tard.
async function currentPrincipalId(client: pg.PoolClient): Promise<number | null> {
  const { rows } = await client.query<{ user_id: number }>(
    `SELECT s.user_id FROM shifts s JOIN users u ON u.id = s.user_id
      WHERE s.ended_at IS NULL AND s.principal AND u.disabled_at IS NULL
      ORDER BY s.started_at DESC LIMIT 1`,
  );
  return rows[0]?.user_id ?? null;
}

// Session ouverte de la table, ouverte au nom du principal en cours si la table était libre.
// Table verrouillée : deux commandes sur une table libre n'ouvrent qu'une session.
async function openTableSession(client: pg.PoolClient, tableId: number, now: Date) {
  await client.query(`SELECT 1 FROM tables WHERE id = $1 FOR UPDATE`, [tableId]);
  const { rows: open } = await client.query<{ id: number }>(
    `SELECT id FROM table_sessions WHERE table_id = $1 AND closed_at IS NULL`,
    [tableId],
  );
  const existing = open[0]?.id;
  if (existing !== undefined) return existing;
  const { rows } = await client.query<{ id: number }>(
    `INSERT INTO table_sessions (table_id, opened_at, principal_id) VALUES ($1, $2, $3)
     RETURNING id`,
    [tableId, now, await currentPrincipalId(client)],
  );
  const created = rows[0]?.id;
  if (created === undefined) throw new Error('session de table non créée');
  return created;
}

// Tâche enter_order d'une commande confirmée. L'agent tape seulement les articles, par leur code :
// ni notes ni choix (docs/api.md § PosJob). Renvoie l'id de la tâche (pos:job après COMMIT).
async function queueEnterOrder(
  client: pg.PoolClient,
  orderId: number,
  tableId: number,
  now: Date,
): Promise<number> {
  const { rows: lines } = await client.query<{
    id: number;
    pos_code: string | null;
    quantity: number;
    menu_item_id: number;
    name_fr: string;
  }>(
    `SELECT l.id, i.pos_code, l.quantity, l.menu_item_id, l.name_fr
       FROM order_lines l JOIN menu_items i ON i.id = l.menu_item_id
      WHERE l.order_id = $1 ORDER BY l.id`,
    [orderId],
  );
  // Code retiré depuis la commande : impossible à saisir en caisse.
  const missing = lines.find((line) => line.pos_code === null);
  if (missing) {
    throw new HttpError(409, 'ITEM_UNAVAILABLE', `${missing.name_fr} has no product code`, {
      menuItemId: missing.menu_item_id,
    });
  }
  const { rows } = await client.query<{ id: number }>(
    `INSERT INTO pos_jobs (type, table_id, order_id, payload, created_at)
     VALUES ('enter_order', $1, $2, $3, $4) RETURNING id`,
    [
      tableId,
      orderId,
      {
        lines: lines.map((line) => ({
          orderLineId: line.id,
          posCode: line.pos_code,
          quantity: line.quantity,
        })),
      },
      now,
    ],
  );
  const jobId = rows[0]?.id;
  if (jobId === undefined) throw new Error('tâche caisse non créée');
  return jobId;
}

type PendingRow = { id: number; table_id: number; status: string; expires_at: Date };

// Commande verrouillée pour la confirmer ou la rejeter : 404 si inconnue,
// 409 INVALID_STATUS si déjà traitée (par un autre serveur) ou expirée.
async function lockPending(client: pg.PoolClient, orderId: number): Promise<PendingRow> {
  const { rows } = await client.query<PendingRow>(
    `SELECT id, table_id, status, expires_at FROM orders WHERE id = $1 AND source = 'qr' FOR UPDATE`,
    [orderId],
  );
  const order = rows[0];
  if (!order) throw new HttpError(404, 'NOT_FOUND', 'Order not found');
  if (order.status !== 'pending') {
    throw new HttpError(409, 'INVALID_STATUS', `Order is ${order.status}`);
  }
  return order;
}

// Routes commandes QR de docs/api.md § 3 (client) et § 5 (serveur en shift).
export function orderRoutes(db: Db, config: Config, realtime: Realtime): Router {
  const router = Router();

  // Commande du client (sans connexion), en attente de confirmation par un serveur.
  router.post('/orders', async (req, res) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) throw validationError(parsed.error);
    const body = parsed.data;
    const now = new Date();

    // Requête renvoyée (réseau coupé, double tap) : même réponse, rien de recréé.
    const { rows: existing } = await db.query<{ id: number; source: string }>(
      `SELECT id, source FROM orders WHERE client_request_id = $1`,
      [body.clientRequestId],
    );
    const replay = existing[0];
    if (replay) {
      if (replay.source !== 'qr') {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid request body', {
          fields: [{ field: 'clientRequestId', message: 'Already used' }],
        });
      }
      res.status(201).json(await createdResponse(db, replay.id));
      return;
    }

    // Café fermé : vérifié avant tout le reste (docs/api.md § 3).
    if (!isCafeOpen(now)) throw new HttpError(409, 'CAFE_CLOSED', 'The café is closed');

    const { rows: tables } = await db.query<{ id: number }>(
      `SELECT id FROM tables WHERE qr_token = $1 AND kind = 'real'`,
      [body.tableToken],
    );
    const table = tables[0];
    if (!table) throw new HttpError(404, 'TABLE_NOT_FOUND', 'Unknown table');

    // Anti-abus : au plus qrOrderRateLimit commandes QR par table sur la fenêtre.
    const windowMs = config.qrOrderRateWindowMinutes * 60_000;
    const { rows: recent } = await db.query<{ count: number; oldest: Date | null }>(
      `SELECT count(*)::int AS count, min(created_at) AS oldest FROM orders
        WHERE table_id = $1 AND source = 'qr' AND created_at > $2`,
      [table.id, new Date(now.getTime() - windowMs)],
    );
    const { count = 0, oldest = null } = recent[0] ?? {};
    if (count >= config.qrOrderRateLimit && oldest) {
      throw new HttpError(429, 'TOO_MANY_REQUESTS', 'Too many orders for this table', {
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((oldest.getTime() + windowMs - now.getTime()) / 1000),
        ),
      });
    }

    if ((await waitersOnShift(db)).length === 0) {
      throw new HttpError(409, 'NO_WAITER_ON_SHIFT', 'No waiter on shift');
    }

    const lines = await prepareLines(db, body.lines, now, 'customer');
    const expiresAt = new Date(now.getTime() + config.orderPendingTtlSeconds * 1000);

    const orderId = await inTransaction(db, async (client) => {
      // Même clientRequestId reçu deux fois en même temps : la seconde attend la première.
      const { rows } = await client.query<{ id: number }>(
        `INSERT INTO orders (client_request_id, table_id, source, status, created_at, expires_at)
         VALUES ($1, $2, 'qr', 'pending', $3, $4)
         ON CONFLICT (client_request_id) DO NOTHING RETURNING id`,
        [body.clientRequestId, table.id, now, expiresAt],
      );
      const created = rows[0];
      if (!created) return null;
      await insertLines(client, created.id, lines);
      return created.id;
    });

    if (orderId === null) {
      const { rows } = await db.query<{ id: number }>(
        `SELECT id FROM orders WHERE client_request_id = $1 AND source = 'qr'`,
        [body.clientRequestId],
      );
      const first = rows[0];
      if (!first) throw new Error('commande en double introuvable');
      res.status(201).json(await createdResponse(db, first.id));
      return;
    }

    // order:new aux serveurs en shift (notifications push).
    await notifyOrders(db, realtime, [orderId], 'new');
    const response: Created = {
      orderId,
      status: 'pending',
      total: linesTotal(lines),
      expiresAt,
    };
    res.status(201).json(response);
  });

  // État d'une commande pour le menu QR, après reconnexion. Seulement depuis sa table.
  router.get('/orders/:id', async (req, res) => {
    const id = idParam.safeParse(req.params['id']);
    const tableToken = req.query['tableToken'];
    if (!id.success || typeof tableToken !== 'string' || tableToken === '') {
      throw new HttpError(404, 'NOT_FOUND', 'Order not found');
    }
    await expireAndNotify(db, realtime, new Date());
    const { rows } = await db.query<{ status: string }>(
      `SELECT o.status FROM orders o JOIN tables t ON t.id = o.table_id
        WHERE o.id = $1 AND o.source = 'qr' AND t.qr_token = $2`,
      [id.data, tableToken],
    );
    const order = rows[0];
    if (!order) throw new HttpError(404, 'NOT_FOUND', 'Order not found');
    res.json({ orderId: id.data, status: order.status });
  });

  // Commandes en attente de confirmation, les plus anciennes d'abord.
  router.get('/orders', ...requireWaiterOnShift(db, config), async (req, res) => {
    const parsed = pendingQuery.safeParse(req.query);
    if (!parsed.success) throw validationError(parsed.error);
    const { limit, cursor } = parsed.data;
    await expireAndNotify(db, realtime, new Date());
    const { rows } = await db.query<{ id: number }>(
      `SELECT id FROM orders WHERE status = 'pending' AND id > $1 ORDER BY id LIMIT $2`,
      [cursor ?? 0, limit + 1],
    );
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    res.json({
      items: await loadOrders(
        db,
        page.map((row) => row.id),
      ),
      nextCursor: rows.length > limit && last ? String(last.id) : null,
    });
  });

  // Confirmation après vérification avec la table : ouvre la session si la table était libre
  // et met la commande en file caisse (docs/api.md § 5, docs/product.md § 6).
  router.post('/orders/:id/confirm', ...requireWaiterOnShift(db, config), async (req, res) => {
    const id = idParam.safeParse(req.params['id']);
    if (!id.success) throw new HttpError(404, 'NOT_FOUND', 'Order not found');
    const { user } = getAuth(res);
    const now = new Date();
    await expireAndNotify(db, realtime, now);

    const jobId = await inTransaction(db, async (client) => {
      const order = await lockPending(client, id.data);
      const sessionId = await openTableSession(client, order.table_id, now);

      await client.query(
        `UPDATE orders SET status = 'confirmed', table_session_id = $2, confirmed_at = $3,
                confirmed_by = $4
          WHERE id = $1`,
        [order.id, sessionId, now, user.id],
      );
      const queued = await queueEnterOrder(client, order.id, order.table_id, now);

      await audit(client, {
        userId: user.id,
        action: 'order.confirmed',
        entityType: 'order',
        entityId: order.id,
        tableId: order.table_id,
        details: { tableSessionId: sessionId },
      });
      return queued;
    });

    await notifyOrders(db, realtime, [id.data]);
    realtime.posJob(jobId);
    res.json(await loadOrder(db, id.data));
  });

  // Fausse commande : rejetée, rien n'est ouvert ni envoyé en caisse.
  router.post('/orders/:id/reject', ...requireWaiterOnShift(db, config), async (req, res) => {
    const id = idParam.safeParse(req.params['id']);
    if (!id.success) throw new HttpError(404, 'NOT_FOUND', 'Order not found');
    const parsed = rejectBody.safeParse(req.body ?? {});
    if (!parsed.success) throw validationError(parsed.error);
    const reason = parsed.data.reason === '' ? null : (parsed.data.reason ?? null);
    const { user } = getAuth(res);
    const now = new Date();
    await expireAndNotify(db, realtime, now);

    await inTransaction(db, async (client) => {
      const order = await lockPending(client, id.data);
      await client.query(
        `UPDATE orders SET status = 'rejected', rejected_at = $2, rejected_by = $3,
                reject_reason = $4
          WHERE id = $1`,
        [order.id, now, user.id, reason],
      );
      await audit(client, {
        userId: user.id,
        action: 'order.rejected',
        entityType: 'order',
        entityId: order.id,
        tableId: order.table_id,
        ...(reason !== null && { details: { reason } }),
      });
    });

    await notifyOrders(db, realtime, [id.data]);
    res.json(await loadOrder(db, id.data));
  });

  // Commande saisie par un serveur en shift (principal ou renfort) pour un client sans téléphone :
  // directement confirmée et mise en file caisse (docs/api.md § 5, docs/product.md § 6).
  router.post('/staff-orders', ...requireWaiterOnShift(db, config), async (req, res) => {
    const parsed = staffOrderBody.safeParse(req.body);
    if (!parsed.success) throw validationError(parsed.error);
    const body = parsed.data;
    const { user } = getAuth(res);
    const now = new Date();

    // Requête renvoyée (réseau coupé, double tap) : même commande, rien de recréé.
    const replayId = async () => {
      const { rows } = await db.query<{ id: number; source: string }>(
        `SELECT id, source FROM orders WHERE client_request_id = $1`,
        [body.clientRequestId],
      );
      const replay = rows[0];
      if (replay && replay.source !== 'waiter') {
        throw fieldError('clientRequestId', 'Already used');
      }
      return replay?.id ?? null;
    };
    const replay = await replayId();
    if (replay !== null) {
      res.status(201).json(await loadOrder(db, replay));
      return;
    }

    const { rows: tables } = await db.query<{ id: number; kind: string }>(
      `SELECT id, kind FROM tables WHERE id = $1`,
      [body.tableId],
    );
    const table = tables[0];
    if (!table) throw new HttpError(404, 'NOT_FOUND', 'Table not found');
    // TODO : tables d'offre (commande offerte, requestedById et forClient obligatoires).
    // Les tables de vente directe passent par /direct-sales.
    if (table.kind !== 'real') throw fieldError('tableId', 'Must be a real table');
    if (body.requestedById !== undefined) {
      throw fieldError('requestedById', 'Only for an offer table');
    }
    if (body.forClient !== undefined) throw fieldError('forClient', 'Only for an offer table');

    // Après 22h et avant 8h, la saisie reste possible ; seuls les horaires des articles comptent.
    const lines = await prepareLines(db, body.lines, now, 'staff');

    const created = await inTransaction(db, async (client) => {
      const sessionId = await openTableSession(client, table.id, now);
      // Même clientRequestId reçu deux fois en même temps : la seconde attend la première,
      // puis tout est annulé (session comprise) et la première commande est renvoyée.
      const { rows } = await client.query<{ id: number }>(
        `INSERT INTO orders (client_request_id, table_id, table_session_id, source, status,
                             created_by, created_at, confirmed_at, confirmed_by)
         VALUES ($1, $2, $3, 'waiter', 'confirmed', $4, $5, $5, $4)
         ON CONFLICT (client_request_id) DO NOTHING RETURNING id`,
        [body.clientRequestId, table.id, sessionId, user.id, now],
      );
      const order = rows[0];
      if (!order) throw new DuplicateRequest();
      await insertLines(client, order.id, lines);
      const jobId = await queueEnterOrder(client, order.id, table.id, now);
      await audit(client, {
        userId: user.id,
        action: 'order.entered',
        entityType: 'order',
        entityId: order.id,
        tableId: table.id,
        details: { tableSessionId: sessionId },
      });
      return { orderId: order.id, jobId };
    }).catch(async (err: unknown) => {
      if (!(err instanceof DuplicateRequest)) throw err;
      const first = await replayId();
      if (first === null) throw new Error('commande en double introuvable');
      return { orderId: first, jobId: null };
    });

    // Requête en double : déjà envoyé par la première.
    if (created.jobId !== null) {
      await notifyTables(db, realtime, [table.id]);
      realtime.posJob(created.jobId);
    }
    res.status(201).json(await loadOrder(db, created.orderId));
  });

  return router;
}
