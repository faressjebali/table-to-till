import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth/passwords.js';
import type { Role } from '../src/auth/sessions.js';
import { loadConfig, type Config } from '../src/config.js';
import { createPool, type Db } from '../src/db.js';
import type { Order } from '../src/orders/view.js';
import type { PosJob } from '../src/pos/view.js';
import { noopRealtime, type Realtime } from '../src/realtime.js';
import { parseMenuCsv } from '../src/seed/menu-csv.js';
import { seedMenu } from '../src/seed/seed-menu.js';
import type { Table } from '../src/tables/view.js';
import { resetTestDatabase, testUrl } from './helpers/db.js';

const PASSWORD = 'bonjour123';
const AGENT_KEY = 'cle-agent-de-test';
const config: Config = {
  ...loadConfig(),
  loginRateLimitPerMinute: 1000,
  firstManagerLogin: '',
  firstManagerTempPassword: '',
  agentKey: AGENT_KEY,
};
const menu = parseMenuCsv(
  readFileSync(new URL('../../docs/menu/menu.csv', import.meta.url), 'utf8'),
);

// Heure de Tunis (UTC+1). Le 19/10/2026 est un lundi.
const MONDAY_10H = new Date('2026-10-19T10:00:00+01:00');
// Espresso : 6,5 DT.
const ESPRESSO_PRICE = 6500;

let db: Db;
let espressoId: number;

beforeAll(async () => {
  await resetTestDatabase();
  db = createPool(testUrl);
  const client = await db.connect();
  try {
    await seedMenu(client, menu);
  } finally {
    client.release();
  }
  const { rows } = await db.query<{ id: number }>(
    `SELECT id FROM menu_items WHERE name_fr = 'Espresso'`,
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('Espresso introuvable');
  espressoId = id;
});

afterAll(async () => {
  await db.end();
});

// Événements temps réel envoyés pendant le test.
let events: { name: string; data: unknown }[];
const realtime: Realtime = {
  ...noopRealtime,
  posJob: (jobId) => events.push({ name: 'pos:job', data: { jobId } }),
  tableUpdated: (table) => events.push({ name: 'table:updated', data: table }),
  reportUpdated: () => events.push({ name: 'report:updated', data: {} }),
};
const sent = (name: string) => events.filter((e) => e.name === name).map((e) => e.data);

let app: ReturnType<typeof createApp> | undefined;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(MONDAY_10H);
  events = [];
  await db.query('TRUNCATE users, tables, audit_log, pos_agent RESTART IDENTITY CASCADE');
  // Tables 1 et 2 : 7 et 8 (réelles) ; table 3 : 103, table d'offre sans compte.
  await db.query(
    `INSERT INTO tables (number, kind, qr_token, layout_x, layout_y, layout_w, layout_h, layout_shape)
     VALUES (7, 'real', 'jeton-7', 0, 0, 1, 1, 'square'),
            (8, 'real', 'jeton-8', 1, 0, 1, 1, 'square')`,
  );
  await db.query(
    `INSERT INTO tables (number, kind, offer_label) VALUES (103, 'virtual', 'Table des artistes')`,
  );
  app = createApp({ db, config, realtime });
});

afterEach(() => {
  vi.useRealTimers();
});

const api = () => {
  if (!app) throw new Error('app absente');
  return request(app);
};
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const agentAuth = { 'X-Agent-Key': AGENT_KEY };

async function staff(login: string, role: Role = 'waiter', { onShift = true } = {}) {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO users (login, name, password_hash, role, must_change_password)
     VALUES ($1, $2, $3, $4, false) RETURNING id`,
    [login, `Nom ${login}`, await hashPassword(PASSWORD), role],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('aucun utilisateur créé');
  const login_ = await api().post('/api/auth/login').send({ login, password: PASSWORD });
  const token = (login_.body as { token: string }).token;
  if (onShift) expect((await api().post('/api/shifts/start').set(auth(token))).status).toBe(201);
  return { id, token };
}

// Commande saisie par un serveur : session ouverte et tâche enter_order.
async function staffOrder(token: string, tableId = 1, quantity = 2): Promise<Order> {
  const res = await api()
    .post('/api/staff-orders')
    .set(auth(token))
    .send({
      clientRequestId: randomUUID(),
      tableId,
      lines: [{ menuItemId: espressoId, quantity }],
    });
  expect(res.status).toBe(201);
  return res.body as Order;
}

async function plan(token: string): Promise<Table[]> {
  const res = await api().get('/api/tables').set(auth(token));
  expect(res.status).toBe(200);
  return (res.body as { tables: Table[] }).tables;
}

describe('POST /tables/:id/pay', () => {
  it('ferme la session tout de suite et met en file pay_table avec le total à lire en caisse', async () => {
    const principal = await staff('amira');
    await staffOrder(principal.token);
    events = [];

    const res = await api()
      .post('/api/tables/1/pay')
      .set(auth(principal.token))
      .send({ method: 'card' });

    expect(res.status).toBe(200);
    const job = res.body as PosJob;
    expect(job).toMatchObject({
      type: 'pay_table',
      tableNumber: 7,
      method: 'card',
      expectedTotal: 2 * ESPRESSO_PRICE,
      status: 'queued',
      blockedByJobId: null,
    });
    expect(job).not.toHaveProperty('orderId');

    const { rows } = await db.query<{ payment_method: string; closed_by: number; closed: boolean }>(
      `SELECT payment_method, closed_by, closed_at IS NOT NULL AS closed FROM table_sessions`,
    );
    expect(rows).toEqual([{ payment_method: 'card', closed_by: principal.id, closed: true }]);
    expect((await plan(principal.token)).find((t) => t.id === 1)).toMatchObject({
      state: 'free',
      openSessionId: null,
      openTotal: 0,
    });
    expect(sent('table:updated')).toEqual([expect.objectContaining({ id: 1, state: 'free' })]);
    expect(sent('report:updated')).toHaveLength(1);
    // L'agent est réveillé : la saisie de la commande, puis l'encaissement, dans l'ordre.
    expect(sent('pos:job')).toHaveLength(1);

    const { rows: log } = await db.query<{ action: string; details: Record<string, unknown> }>(
      `SELECT action, details FROM audit_log WHERE action = 'table.paid'`,
    );
    expect(log).toEqual([
      { action: 'table.paid', details: { method: 'card', total: 10500, jobId: job.id } },
    ]);
  });

  it('une nouvelle commande sur la table ouvre une nouvelle session', async () => {
    const principal = await staff('amira');
    await staffOrder(principal.token);
    expect(
      (await api().post('/api/tables/1/pay').set(auth(principal.token)).send({ method: 'cash' }))
        .status,
    ).toBe(200);

    await staffOrder(principal.token, 1, 1);

    const { rows } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM table_sessions WHERE table_id = 1`,
    );
    expect(rows[0]?.n).toBe(2);
    expect((await plan(principal.token)).find((t) => t.id === 1)).toMatchObject({
      state: 'occupied',
      openTotal: ESPRESSO_PRICE,
    });
  });

  it('encaissement en échec : la commande suivante de la table attend, les autres tables continuent', async () => {
    const principal = await staff('amira');
    await staffOrder(principal.token);
    await api().post('/api/tables/1/pay').set(auth(principal.token)).send({ method: 'cash' });
    // L'agent saisit la commande, puis échoue sur l'encaissement.
    for (const outcome of ['done', 'fail'] as const) {
      const next = await api().get('/api/pos/jobs/next').set(agentAuth);
      const id = (next.body as PosJob).id;
      expect(
        (
          await api()
            .post(`/api/pos/jobs/${String(id)}/start`)
            .set(agentAuth)
        ).status,
      ).toBe(200);
      const end = api()
        .post(`/api/pos/jobs/${String(id)}/${outcome}`)
        .set(agentAuth);
      expect(
        (await (outcome === 'fail' ? end.send({ error: 'TOTAL_MISMATCH', step: 'net' }) : end))
          .status,
      ).toBe(200);
    }

    const nextClient = await staffOrder(principal.token, 1, 1);
    const other = await staffOrder(principal.token, 2, 1);

    const next = await api().get('/api/pos/jobs/next').set(agentAuth);
    expect(next.status).toBe(200);
    expect(next.body).toMatchObject({ type: 'enter_order', orderId: other.id });
    const { rows } = await db.query<{ status: string }>(
      `SELECT status FROM pos_jobs WHERE order_id = $1`,
      [nextClient.id],
    );
    expect(rows).toEqual([{ status: 'queued' }]);
  });

  it('refuse un renfort (NOT_PRINCIPAL)', async () => {
    const principal = await staff('amira');
    const renfort = await staff('sami');
    await staffOrder(principal.token);

    const res = await api()
      .post('/api/tables/1/pay')
      .set(auth(renfort.token))
      .send({ method: 'cash' });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: { code: 'NOT_PRINCIPAL' } });
  });

  it('refuse un serveur hors shift et un barista', async () => {
    await staff('amira');
    const off = await staff('sami', 'waiter', { onShift: false });
    const barista = await staff('lina', 'barista');

    expect(
      (await api().post('/api/tables/1/pay').set(auth(off.token)).send({ method: 'cash' })).body,
    ).toMatchObject({ error: { code: 'NOT_ON_SHIFT' } });
    expect(
      (await api().post('/api/tables/1/pay').set(auth(barista.token)).send({ method: 'cash' }))
        .status,
    ).toBe(403);
  });

  it('refuse un moyen de paiement inconnu ou absent (VALIDATION_ERROR)', async () => {
    const principal = await staff('amira');
    await staffOrder(principal.token);

    for (const body of [{}, { method: 'mixed' }]) {
      const res = await api().post('/api/tables/1/pay').set(auth(principal.token)).send(body);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    }
    const { rows } = await db.query(`SELECT 1 FROM pos_jobs WHERE type = 'pay_table'`);
    expect(rows).toHaveLength(0);
  });

  it('table libre, déjà encaissée ou table d’offre : INVALID_STATUS ; table inconnue : 404', async () => {
    const principal = await staff('amira');
    await staffOrder(principal.token);
    const pay = (id: number | string) =>
      api()
        .post(`/api/tables/${String(id)}/pay`)
        .set(auth(principal.token))
        .send({ method: 'cash' });

    expect((await pay(1)).status).toBe(200);
    for (const id of [1, 2, 3]) {
      const res = await pay(id);
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ error: { code: 'INVALID_STATUS' } });
    }
    expect((await pay(99)).status).toBe(404);
    expect((await pay('abc')).status).toBe(404);
  });

  it('refuse tant qu’une annulation de la table attend (CANCEL_WAITING)', async () => {
    const principal = await staff('amira');
    const order = await staffOrder(principal.token);
    const line = order.lines[0];
    if (!line) throw new Error('ligne absente');
    // Annulation en attente (pas encore créée par l’API), directement en base.
    await db.query(
      `INSERT INTO pos_jobs (type, status, table_id, payload)
       VALUES ('cancel_line', 'waiting', 1, $1)`,
      [{ orderLineId: line.id, posCode: '10', quantity: 1 }],
    );

    const res = await api()
      .post('/api/tables/1/pay')
      .set(auth(principal.token))
      .send({ method: 'cash' });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: { code: 'CANCEL_WAITING' } });
    const { rows } = await db.query(`SELECT 1 FROM table_sessions WHERE closed_at IS NULL`);
    expect(rows).toHaveLength(1);
  });
});

describe('POST /tables/:id/print-bill', () => {
  it('met en file print_bill avec le total ; la table reste ouverte', async () => {
    const principal = await staff('amira');
    await staffOrder(principal.token);
    events = [];

    const res = await api().post('/api/tables/1/print-bill').set(auth(principal.token));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      type: 'print_bill',
      tableNumber: 7,
      expectedTotal: 2 * ESPRESSO_PRICE,
      status: 'queued',
    });
    expect((await plan(principal.token)).find((t) => t.id === 1)).toMatchObject({
      state: 'occupied',
    });
    expect(sent('pos:job')).toHaveLength(1);
    const { rows } = await db.query<{ action: string }>(
      `SELECT action FROM audit_log WHERE action = 'table.bill_printed'`,
    );
    expect(rows).toHaveLength(1);
  });

  it('possible pour un renfort', async () => {
    const principal = await staff('amira');
    const renfort = await staff('sami');
    await staffOrder(principal.token);

    const res = await api().post('/api/tables/1/print-bill').set(auth(renfort.token));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ type: 'print_bill' });
  });

  it('table libre : INVALID_STATUS ; hors shift : NOT_ON_SHIFT', async () => {
    const principal = await staff('amira');
    const off = await staff('sami', 'waiter', { onShift: false });

    const free = await api().post('/api/tables/2/print-bill').set(auth(principal.token));
    expect(free.status).toBe(409);
    expect(free.body).toMatchObject({ error: { code: 'INVALID_STATUS' } });
    const offShift = await api().post('/api/tables/2/print-bill').set(auth(off.token));
    expect(offShift.body).toMatchObject({ error: { code: 'NOT_ON_SHIFT' } });
  });
});
