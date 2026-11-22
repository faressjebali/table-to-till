import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth/passwords.js';
import type { Role } from '../src/auth/sessions.js';
import { loadConfig, type Config } from '../src/config.js';
import { createPool, type Db } from '../src/db.js';
import { resetTestDatabase, testUrl } from './helpers/db.js';

const PASSWORD = 'bonjour123';
const config: Config = {
  ...loadConfig(),
  loginRateLimitPerMinute: 1000,
  firstManagerLogin: '',
  firstManagerTempPassword: '',
};

let db: Db;
let api: ReturnType<typeof request>;

beforeAll(async () => {
  await resetTestDatabase();
  db = createPool(testUrl);
  api = request(createApp({ db, config }));
});

afterAll(async () => {
  await db.end();
});

beforeEach(async () => {
  await db.query('TRUNCATE users, tables, audit_log RESTART IDENTITY CASCADE');
});

async function createUser(login: string, role: Role = 'waiter'): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO users (login, name, password_hash, role, must_change_password)
     VALUES ($1, $2, $3, $4, false) RETURNING id`,
    [login, `Nom ${login}`, await hashPassword(PASSWORD), role],
  );
  const row = rows[0];
  if (!row) throw new Error('aucun utilisateur créé');
  return row.id;
}

async function tokenFor(login: string): Promise<string> {
  const res = await api.post('/api/auth/login').send({ login, password: PASSWORD });
  expect(res.status).toBe(200);
  return (res.body as { token: string }).token;
}

// Serveur en shift, prêt à consulter le plan.
async function waiterOnShift(login = 'amira'): Promise<{ id: number; token: string }> {
  const id = await createUser(login);
  const token = await tokenFor(login);
  expect((await api.post('/api/shifts/start').set('Authorization', `Bearer ${token}`)).status).toBe(
    201,
  );
  return { id, token };
}

async function createTable(
  number: number,
  kind: 'real' | 'virtual' = 'real',
  layout = { x: 0, y: 0 },
): Promise<{ id: number; token: string | null }> {
  const token = kind === 'real' ? `jeton-${String(number)}` : null;
  const { rows } = await db.query<{ id: number }>(
    kind === 'real'
      ? `INSERT INTO tables (number, kind, qr_token, layout_x, layout_y, layout_w, layout_h, layout_shape)
         VALUES ($1, 'real', $2, $3, $4, 1, 1, 'square') RETURNING id`
      : `INSERT INTO tables (number, kind) VALUES ($1, 'virtual') RETURNING id`,
    kind === 'real' ? [number, token, layout.x, layout.y] : [number],
  );
  const row = rows[0];
  if (!row) throw new Error('aucune table créée');
  return { id: row.id, token };
}

async function menuItem(): Promise<number> {
  const { rows: categories } = await db.query<{ id: number }>(
    `INSERT INTO categories (section, name_fr, name_en) VALUES ('drinks', 'Cafés', 'Coffees')
     ON CONFLICT (name_fr) DO UPDATE SET name_en = EXCLUDED.name_en RETURNING id`,
  );
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO menu_items (category_id, name_fr, price, station) VALUES ($1, 'Capuccino', 8500, 'bar')
     RETURNING id`,
    [categories[0]?.id],
  );
  const row = rows[0];
  if (!row) throw new Error('aucun article créé');
  return row.id;
}

type Line = { quantity: number; unitPrice: number; discountPercent?: number; status?: string };

async function openSession(tableId: number, principalId: number | null): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    'INSERT INTO table_sessions (table_id, principal_id) VALUES ($1, $2) RETURNING id',
    [tableId, principalId],
  );
  const row = rows[0];
  if (!row) throw new Error('aucune session créée');
  return row.id;
}

async function confirmedOrder(
  tableId: number,
  sessionId: number,
  waiterId: number,
  lines: Line[],
): Promise<void> {
  const itemId = await menuItem();
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO orders (client_request_id, table_id, table_session_id, source, status, created_by,
                         confirmed_at, confirmed_by)
     VALUES ($1, $2, $3, 'waiter', 'confirmed', $4, now(), $4) RETURNING id`,
    [randomUUID(), tableId, sessionId, waiterId],
  );
  for (const line of lines) {
    await db.query(
      `INSERT INTO order_lines (order_id, menu_item_id, name_fr, quantity, unit_price, discount_percent, status, station)
       VALUES ($1, $2, 'Capuccino', $3, $4, $5, $6, 'bar')`,
      [
        rows[0]?.id,
        itemId,
        line.quantity,
        line.unitPrice,
        line.discountPercent ?? 0,
        line.status ?? 'active',
      ],
    );
  }
}

async function pendingQrOrder(tableId: number, expiresInSeconds: number): Promise<void> {
  await db.query(
    `INSERT INTO orders (client_request_id, table_id, source, status, expires_at)
     VALUES ($1, $2, 'qr', 'pending', now() + make_interval(secs => $3))`,
    [randomUUID(), tableId, expiresInSeconds],
  );
}

type TableBody = {
  id: number;
  number: number;
  kind: string;
  state: string;
  openSessionId: number | null;
  openTotal: number;
  pendingOrders: number;
  layout: unknown;
  offer: unknown;
  principalId: number | null;
};

async function plan(token: string): Promise<TableBody[]> {
  const res = await api.get('/api/tables').set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  return (res.body as { tables: TableBody[] }).tables;
}

describe('GET /tables/:tableToken', () => {
  it('renvoie la table réelle du QR, sans connexion', async () => {
    const table = await createTable(7);
    const res = await api.get(`/api/tables/${String(table.token)}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: table.id, number: 7 });
  });

  it('404 TABLE_NOT_FOUND pour un jeton inconnu', async () => {
    await createTable(7);
    const res = await api.get('/api/tables/inconnu');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: { code: 'TABLE_NOT_FOUND' } });
  });
});

describe('GET /tables', () => {
  it('renvoie les tables réelles du plan, au format du contrat, triées par numéro', async () => {
    const { token } = await waiterOnShift();
    await createTable(12, 'real', { x: 14, y: 4 });
    const t2 = await createTable(2, 'real', { x: 12, y: 7 });
    await createTable(333, 'virtual');

    const tables = await plan(token);
    expect(tables.map((t) => t.number)).toEqual([2, 12]);
    expect(tables[0]).toEqual({
      id: t2.id,
      number: 2,
      kind: 'real',
      state: 'free',
      openSessionId: null,
      openTotal: 0,
      pendingOrders: 0,
      layout: { room: 'inside', x: 12, y: 7, w: 1, h: 1, shape: 'square' },
      offer: null,
      principalId: null,
    });
  });

  it('table occupée : montant des lignes actives confirmées, remise déduite, et son principal', async () => {
    const waiter = await waiterOnShift();
    const table = await createTable(5);
    const sessionId = await openSession(table.id, waiter.id);
    await confirmedOrder(table.id, sessionId, waiter.id, [
      { quantity: 2, unitPrice: 8500 },
      // Remise staff 20 % : 5 500 × 0,8 = 4 400.
      { quantity: 1, unitPrice: 6000, discountPercent: 20 },
      // Annulée ou transférée : compte 0.
      { quantity: 1, unitPrice: 28500, status: 'cancelled' },
      { quantity: 1, unitPrice: 7000, status: 'transferred' },
    ]);

    const [row] = await plan(waiter.token);
    expect(row).toMatchObject({
      state: 'occupied',
      openSessionId: sessionId,
      openTotal: 21800,
      principalId: waiter.id,
    });
  });

  it('arrondit chaque ligne remisée au millime', async () => {
    const waiter = await waiterOnShift();
    const table = await createTable(5);
    const sessionId = await openSession(table.id, waiter.id);
    // 1 × 5 503 × 0,8 = 4 402,4 → 4 402.
    await confirmedOrder(table.id, sessionId, waiter.id, [
      { quantity: 1, unitPrice: 5503, discountPercent: 20 },
    ]);
    const [row] = await plan(waiter.token);
    expect(row?.openTotal).toBe(4402);
  });

  it('une session fermée laisse la table libre', async () => {
    const waiter = await waiterOnShift();
    const table = await createTable(5);
    const sessionId = await openSession(table.id, waiter.id);
    await confirmedOrder(table.id, sessionId, waiter.id, [{ quantity: 1, unitPrice: 8500 }]);
    await db.query(
      `UPDATE table_sessions SET closed_at = now(), payment_method = 'cash' WHERE id = $1`,
      [sessionId],
    );
    const [row] = await plan(waiter.token);
    expect(row).toMatchObject({ state: 'free', openSessionId: null, openTotal: 0 });
  });

  it('une commande en attente ne rend pas la table occupée ; une commande expirée ne compte pas', async () => {
    const { token } = await waiterOnShift();
    const table = await createTable(5);
    await pendingQrOrder(table.id, 300);
    await pendingQrOrder(table.id, -1);

    const [row] = await plan(token);
    expect(row).toMatchObject({ state: 'free', openTotal: 0, pendingOrders: 1 });
  });

  it('refuse un serveur hors shift, les autres rôles et les appels sans token', async () => {
    await createUser('hors-shift');
    await createUser('rania', 'manager');
    await createUser('barista', 'barista');

    const offShiftToken = await tokenFor('hors-shift');
    const offShift = await api.get('/api/tables').set('Authorization', `Bearer ${offShiftToken}`);
    expect(offShift.status).toBe(403);
    expect(offShift.body).toMatchObject({ error: { code: 'NOT_ON_SHIFT' } });

    for (const login of ['rania', 'barista']) {
      const token = await tokenFor(login);
      const res = await api.get('/api/tables').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ error: { code: 'FORBIDDEN' } });
    }

    expect((await api.get('/api/tables')).status).toBe(401);
  });
});

describe('GET /tables/:id/session', () => {
  const session = (token: string, tableId: number | string) =>
    api.get(`/api/tables/${String(tableId)}/session`).set('Authorization', `Bearer ${token}`);

  it('renvoie la session ouverte, ses commandes confirmées et son principal', async () => {
    const waiter = await waiterOnShift();
    const table = await createTable(5);
    const sessionId = await openSession(table.id, waiter.id);
    await confirmedOrder(table.id, sessionId, waiter.id, [
      { quantity: 2, unitPrice: 8500 },
      { quantity: 1, unitPrice: 7000, status: 'cancelled' },
    ]);
    await confirmedOrder(table.id, sessionId, waiter.id, [
      { quantity: 1, unitPrice: 6000, discountPercent: 20 },
    ]);
    // Une commande en attente n'est pas dans la session.
    await pendingQrOrder(table.id, 300);

    const res = await session(waiter.token, table.id);
    expect(res.status).toBe(200);
    const body = res.body as {
      session: Record<string, unknown>;
      orders: { id: number; total: number; lines: unknown[] }[];
      gifts: unknown[];
    };
    expect(body.session).toMatchObject({
      id: sessionId,
      tableId: table.id,
      closedAt: null,
      status: 'open',
      total: 21800,
      orderIds: body.orders.map((order) => order.id),
      principal: { id: waiter.id, name: 'Nom amira' },
    });
    expect(body.orders.map((order) => order.total)).toEqual([17000, 4800]);
    expect(body.orders[0]?.lines).toHaveLength(2);
    expect(body.gifts).toEqual([]);
  });

  it('404 pour une table libre ou inconnue', async () => {
    const { token } = await waiterOnShift();
    const table = await createTable(5);
    for (const id of [table.id, 999, 'abc']) {
      const res = await session(token, id);
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
    }
  });

  it('réservé aux serveurs en shift', async () => {
    const table = await createTable(5);
    await createUser('hors-shift');
    await createUser('rania', 'manager');
    const offShift = await session(await tokenFor('hors-shift'), table.id);
    expect(offShift.body).toMatchObject({ error: { code: 'NOT_ON_SHIFT' } });
    const manager = await session(await tokenFor('rania'), table.id);
    expect(manager.body).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });
});
