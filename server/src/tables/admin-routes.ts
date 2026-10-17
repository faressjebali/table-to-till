import { Router } from 'express';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { getAuth, requireStaff } from '../auth/middleware.js';
import type { Config } from '../config.js';
import { audit, type Db } from '../db.js';
import { HttpError, validationError } from '../errors.js';
import { newTableToken } from './token.js';

const layoutBody = z
  .object({
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    w: z.number().int().positive().default(1),
    h: z.number().int().positive().default(1),
    shape: z.enum(['square', 'round']).default('square'),
  })
  .strict();

const offerBody = z
  .object({
    label: z.string().trim().min(1).max(100),
    userId: z.number().int().positive().nullable(),
  })
  .strict();

const createBody = z
  .object({
    number: z.number().int().positive(),
    kind: z.enum(['real', 'virtual']),
    layout: layoutBody.optional(),
    offer: offerBody.optional(),
  })
  .strict();

const patchBody = z
  .object({
    number: z.number().int().positive().optional(),
    layout: layoutBody.optional(),
    offer: offerBody.nullable().optional(),
  })
  .strict()
  .refine((b) => b.number !== undefined || b.layout !== undefined || b.offer !== undefined, {
    message: 'Nothing to change',
  });

type Layout = z.infer<typeof layoutBody>;
type Offer = z.infer<typeof offerBody>;

type AdminTableRow = {
  id: number;
  number: number;
  kind: 'real' | 'virtual';
  qr_token: string | null;
  layout_x: number | null;
  layout_y: number | null;
  layout_w: number | null;
  layout_h: number | null;
  layout_shape: 'square' | 'round' | null;
  offer_label: string | null;
  offer_user_id: number | null;
};

const COLUMNS = `id, number, kind, qr_token, layout_x, layout_y, layout_w, layout_h, layout_shape,
  offer_label, offer_user_id`;

// Forme AdminTable de docs/api.md § 2 : jamais d'état ni de montant (la manager n'a pas le plan).
function toAdminTable(row: AdminTableRow) {
  return {
    id: row.id,
    number: row.number,
    kind: row.kind,
    layout:
      row.layout_x === null
        ? null
        : {
            x: row.layout_x,
            y: row.layout_y,
            w: row.layout_w,
            h: row.layout_h,
            shape: row.layout_shape,
          },
    offer: row.offer_label === null ? null : { label: row.offer_label, userId: row.offer_user_id },
    tableToken: row.qr_token,
  };
}

const fieldError = (field: string, message: string) =>
  new HttpError(400, 'VALIDATION_ERROR', message, { fields: [{ field, message }] });

const notFound = () => new HttpError(404, 'NOT_FOUND', 'Table not found');

function parseId(raw: string | undefined): number {
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) throw notFound();
  return id;
}

// Contrainte unique violée : numéro déjà pris, ou compte qui a déjà sa table d'offre.
function uniqueViolation(err: unknown): string | null {
  if (typeof err !== 'object' || err === null || !('code' in err) || err.code !== '23505') {
    return null;
  }
  return 'constraint' in err && typeof err.constraint === 'string' ? err.constraint : '';
}

function toFieldError(err: unknown): unknown {
  const constraint = uniqueViolation(err);
  if (constraint === 'tables_number_key') return fieldError('number', 'Number already taken');
  if (constraint === 'tables_one_offer_per_user') {
    return fieldError('offer.userId', 'This account already has an offer table');
  }
  return err;
}

// Le compte d'une table d'offre : manager ou comptable actif (docs/api.md § 6, Tables).
async function checkOfferUser(client: PoolClient, offer: Offer | null | undefined): Promise<void> {
  if (!offer || offer.userId === null) return;
  const { rowCount } = await client.query(
    `SELECT 1 FROM users WHERE id = $1 AND role IN ('manager', 'accountant') AND disabled_at IS NULL`,
    [offer.userId],
  );
  if (!rowCount) throw fieldError('offer.userId', 'Must be an active manager or accountant');
}

async function inTransaction<T>(db: Db, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw toFieldError(err);
  } finally {
    client.release();
  }
}

// Routes de docs/api.md § 6 (tables), réservées à la manager.
export function adminTableRoutes(db: Db, config: Config): Router {
  const router = Router();
  router.use('/admin/tables', requireStaff(db, config, { roles: ['manager'] }));

  router.get('/admin/tables', async (_req, res) => {
    const { rows } = await db.query<AdminTableRow>(`SELECT ${COLUMNS} FROM tables ORDER BY number`);
    res.json({ tables: rows.map(toAdminTable) });
  });

  router.post('/admin/tables', async (req, res) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) throw validationError(parsed.error);
    const { number, kind, layout, offer } = parsed.data;
    const { user: me } = getAuth(res);

    if (kind === 'real' && !layout) throw fieldError('layout', 'A real table needs a layout');
    if (kind === 'virtual' && layout) {
      throw fieldError('layout', 'A virtual table is not on the floor plan');
    }
    if (kind === 'real' && offer) throw fieldError('offer', 'Only a virtual table can be an offer');

    const created = await inTransaction(db, async (client) => {
      await checkOfferUser(client, offer);
      const l: Partial<Layout> = layout ?? {};
      const { rows } = await client.query<AdminTableRow>(
        `INSERT INTO tables (number, kind, qr_token, layout_x, layout_y, layout_w, layout_h,
                             layout_shape, offer_label, offer_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING ${COLUMNS}`,
        [
          number,
          kind,
          kind === 'real' ? newTableToken() : null,
          l.x ?? null,
          l.y ?? null,
          l.w ?? null,
          l.h ?? null,
          l.shape ?? null,
          offer?.label ?? null,
          offer?.userId ?? null,
        ],
      );
      const row = rows[0];
      if (!row) throw new Error('aucune table créée');
      await audit(client, {
        userId: me.id,
        action: 'table.created',
        entityType: 'table',
        entityId: row.id,
        details: { number, kind, offer: offer ?? null },
      });
      return row;
    });
    res.status(201).json(toAdminTable(created));
  });

  router.patch('/admin/tables/:id', async (req, res) => {
    const id = parseId(req.params['id']);
    const parsed = patchBody.safeParse(req.body);
    if (!parsed.success) throw validationError(parsed.error);
    const { number, layout, offer } = parsed.data;
    const { user: me } = getAuth(res);

    const updated = await inTransaction(db, async (client) => {
      const { rows } = await client.query<AdminTableRow>(
        `SELECT ${COLUMNS} FROM tables WHERE id = $1 FOR UPDATE`,
        [id],
      );
      const before = rows[0];
      if (!before) throw notFound();
      if (before.kind === 'virtual' && layout) {
        throw fieldError('layout', 'A virtual table is not on the floor plan');
      }
      if (before.kind === 'real' && offer) {
        throw fieldError('offer', 'Only a virtual table can be an offer');
      }

      // Une table en cours d'utilisation ne change pas : son addition est ouverte dans la caisse.
      const { rowCount: inUse } = await client.query(
        `SELECT 1 WHERE
           EXISTS (SELECT 1 FROM table_sessions WHERE table_id = $1 AND closed_at IS NULL)
           OR EXISTS (SELECT 1 FROM orders WHERE table_id = $1 AND status = 'pending'
                        AND expires_at > now())
           OR EXISTS (SELECT 1 FROM pos_jobs WHERE table_id = $1
                        AND status IN ('queued', 'in_progress', 'failed'))`,
        [id],
      );
      if (inUse) throw new HttpError(409, 'INVALID_STATUS', 'This table is in use');

      await checkOfferUser(client, offer);
      const { rows: after } = await client.query<AdminTableRow>(
        `UPDATE tables SET
            number = coalesce($2, number),
            layout_x = coalesce($3, layout_x),
            layout_y = coalesce($4, layout_y),
            layout_w = coalesce($5, layout_w),
            layout_h = coalesce($6, layout_h),
            layout_shape = coalesce($7, layout_shape),
            offer_label = CASE WHEN $8 THEN $9 ELSE offer_label END,
            offer_user_id = CASE WHEN $8 THEN $10 ELSE offer_user_id END
          WHERE id = $1
          RETURNING ${COLUMNS}`,
        [
          id,
          number ?? null,
          layout?.x ?? null,
          layout?.y ?? null,
          layout?.w ?? null,
          layout?.h ?? null,
          layout?.shape ?? null,
          offer !== undefined,
          offer?.label ?? null,
          offer?.userId ?? null,
        ],
      );
      const row = after[0];
      if (!row) throw notFound();
      await audit(client, {
        userId: me.id,
        action: 'table.updated',
        entityType: 'table',
        entityId: id,
        details: {
          from: toAdminTable({ ...before, qr_token: null }),
          to: toAdminTable({ ...row, qr_token: null }),
        },
      });
      return row;
    });
    res.json(toAdminTable(updated));
  });

  // Nouveau jeton QR : l'ancien QR ne marche plus (« demandez au serveur »).
  router.post('/admin/tables/:id/rotate-token', async (req, res) => {
    const id = parseId(req.params['id']);
    const { user: me } = getAuth(res);
    const { rows } = await db.query<{ kind: 'real' | 'virtual' }>(
      'SELECT kind FROM tables WHERE id = $1',
      [id],
    );
    const table = rows[0];
    if (!table) throw notFound();
    if (table.kind === 'virtual') {
      throw new HttpError(409, 'INVALID_STATUS', 'A virtual table has no QR code');
    }
    const tableToken = newTableToken();
    await db.query('UPDATE tables SET qr_token = $2 WHERE id = $1', [id, tableToken]);
    await audit(db, {
      userId: me.id,
      action: 'table.token_rotated',
      entityType: 'table',
      entityId: id,
    });
    res.json({ tableToken });
  });

  return router;
}
