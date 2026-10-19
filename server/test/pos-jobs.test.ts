import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth/passwords.js';
import type { Role } from '../src/auth/sessions.js';
import { loadConfig, type Config } from '../src/config.js';
import { createPool, type Db } from '../src/db.js';
import { loadOrder, type Order } from '../src/orders/view.js';
import {
  AGENT_OFFLINE_MS,
  failTimedOutJobs,
  JOB_TIMEOUT_MS,
  markAgentOffline,
} from '../src/pos/queue.js';
import { loadJob, type PosJob } from '../src/pos/view.js';
import { noopRealtime, type Realtime } from '../src/realtime.js';
import { parseMenuCsv } from '../src/seed/menu-csv.js';
import { seedMenu } from '../src/seed/seed-menu.js';
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
  posFailed: (data) => events.push({ name: 'pos:failed', data }),
  posStatus: (data) => events.push({ name: 'pos:status', data }),
  orderUpdated: (order) => events.push({ name: 'order:updated', data: order }),
};
const sent = (name: string) => events.filter((e) => e.name === name).map((e) => e.data);

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(MONDAY_10H);
  events = [];
  await db.query('TRUNCATE users, tables, audit_log, pos_agent RESTART IDENTITY CASCADE');
  // Tables 1 à 3 : 7, 8 et 9.
  await db.query(
    `INSERT INTO tables (number, kind, qr_token, layout_x, layout_y, layout_w, layout_h, layout_shape)
     VALUES (7, 'real', 'jeton-7', 0, 0, 1, 1, 'square'),
            (8, 'real', 'jeton-8', 1, 0, 1, 1, 'square'),
            (9, 'real', 'jeton-9', 2, 0, 1, 1, 'square')`,
  );
});

afterEach(() => {
  vi.useRealTimers();
});

// Une seule app par test : l'état de l'agent (pos:status) vit dans les routes.
let app: ReturnType<typeof createApp> | undefined;
beforeEach(() => {
  app = createApp({ db, config, realtime });
});
const api = () => {
  if (!app) throw new Error('app absente');
  return request(app);
};
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const agentAuth = { 'X-Agent-Key': AGENT_KEY };

async function staff(login: string, role: Role, { onShift = true } = {}) {
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

// Commande saisie par un serveur : tâche enter_order tout de suite.
async function staffOrder(token: string, tableId = 1): Promise<Order> {
  const res = await api()
    .post('/api/staff-orders')
    .set(auth(token))
    .send({
      clientRequestId: randomUUID(),
      tableId,
      lines: [{ menuItemId: espressoId, quantity: 2 }],
    });
  expect(res.status).toBe(201);
  return res.body as Order;
}

// Tâche sans commande (types créés par d'autres issues), directement en base.
async function insertJob(
  type: string,
  tableId: number,
  {
    toTableId = null,
    status = 'queued',
    payload = {},
  }: {
    toTableId?: number | null;
    status?: string;
    payload?: Record<string, unknown>;
  } = {},
): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO pos_jobs (type, status, table_id, to_table_id, payload, created_at)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [type, status, tableId, toTableId, payload, new Date()],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('tâche non créée');
  // Créations successives dans l'ordre, même avec l'horloge figée.
  vi.setSystemTime(new Date(Date.now() + 1000));
  return id;
}

const next = () => api().get('/api/pos/jobs/next').set(agentAuth);
const nextId = async () => {
  const res = await next();
  return res.status === 204 ? null : (res.body as PosJob).id;
};
const start = (id: number) =>
  api()
    .post(`/api/pos/jobs/${String(id)}/start`)
    .set(agentAuth);
const done = (id: number) =>
  api()
    .post(`/api/pos/jobs/${String(id)}/done`)
    .set(agentAuth);
const fail = (id: number, error = 'SCREEN_MISMATCH') =>
  api()
    .post(`/api/pos/jobs/${String(id)}/fail`)
    .set(agentAuth)
    .send({ error, step: 'open_table' });
const status = async (id: number) => {
  const { rows } = await db.query<{ status: string }>(`SELECT status FROM pos_jobs WHERE id = $1`, [
    id,
  ]);
  return rows[0]?.status;
};

// Tâche lancée puis en échec.
async function failedJob(id: number) {
  expect((await start(id)).status).toBe(200);
  expect((await fail(id)).status).toBe(200);
}

describe('authentification de l’agent', () => {
  it('refuse une clé absente ou fausse', async () => {
    expect((await api().get('/api/pos/jobs/next')).status).toBe(401);
    const res = await api().get('/api/pos/jobs/next').set('X-Agent-Key', 'mauvaise');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
  });

  it('refuse tout agent quand aucune clé n’est configurée', async () => {
    const noKey = createApp({ db, config: { ...config, agentKey: '' }, realtime });
    expect((await request(noKey).get('/api/pos/jobs/next').set('X-Agent-Key', '')).status).toBe(
      401,
    );
  });

  it('refuse un jeton staff', async () => {
    const waiter = await staff('amira', 'waiter');
    expect((await api().get('/api/pos/jobs/next').set(auth(waiter.token))).status).toBe(401);
  });
});

describe('GET /pos/jobs/next', () => {
  it('renvoie 204 quand la file est vide', async () => {
    expect((await next()).status).toBe(204);
  });

  it('renvoie la plus ancienne tâche, au format PosJob', async () => {
    const waiter = await staff('amira', 'waiter');
    const order = await staffOrder(waiter.token);
    await staffOrder(waiter.token, 2);
    const res = await next();
    expect(res.status).toBe(200);
    const line = order.lines[0];
    expect(res.body).toEqual({
      id: 1,
      type: 'enter_order',
      orderId: order.id,
      tableNumber: 7,
      lines: [{ orderLineId: line?.id, posCode: expect.any(String) as unknown, quantity: 2 }],
      status: 'queued',
      blockedByJobId: null,
      attempts: 0,
      lastError: null,
      createdAt: MONDAY_10H.toISOString(),
      startedAt: null,
    });
  });

  it('donne toTableNumber pour un transfert, et jamais une tâche waiting', async () => {
    await insertJob('cancel_line', 1, { status: 'waiting', payload: { orderLineId: 1 } });
    const id = await insertJob('move_table', 1, { toTableId: 2 });
    const res = await next();
    expect(res.body).toMatchObject({ id, type: 'move_table', tableNumber: 7, toTableNumber: 8 });
  });

  it('ne renvoie rien tant qu’une tâche est en cours', async () => {
    const first = await insertJob('print_bill', 1, { payload: { expectedTotal: 10500 } });
    await insertJob('print_bill', 2, { payload: { expectedTotal: 6500 } });
    expect((await start(first)).status).toBe(200);
    expect((await next()).status).toBe(204);
    expect((await done(first)).status).toBe(200);
    expect(await nextId()).toBe(first + 1);
  });
});

describe('POST /pos/jobs/:id/start, done', () => {
  it('passe la tâche en cours puis faite, et la commande saisie', async () => {
    const waiter = await staff('amira', 'waiter');
    const order = await staffOrder(waiter.token);
    const started = await start(1);
    expect(started.status).toBe(200);
    expect(started.body).toMatchObject({
      status: 'in_progress',
      attempts: 1,
      startedAt: MONDAY_10H.toISOString(),
    });

    const res = await done(1);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'done' });
    const updated = sent('order:updated') as Order[];
    expect(updated.at(-1)).toMatchObject({ id: order.id, pos: { status: 'entered' } });
    expect(await loadOrder(db, order.id)).toMatchObject({ pos: { status: 'entered' } });
  });

  it('refuse une deuxième tâche en cours', async () => {
    const first = await insertJob('print_bill', 1);
    const second = await insertJob('print_bill', 2);
    expect((await start(first)).status).toBe(200);
    const res = await start(second);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: { code: 'INVALID_STATUS' } });
    expect(await status(second)).toBe('queued');
  });

  it('est rejouable sans doublon', async () => {
    const id = await insertJob('print_bill', 1);
    expect((await start(id)).status).toBe(200);
    expect((await start(id)).body).toMatchObject({ status: 'in_progress', attempts: 1 });
    expect((await done(id)).status).toBe(200);
    expect((await done(id)).status).toBe(200);
    const { rows } = await db.query(`SELECT 1 FROM audit_log WHERE action = 'pos.done'`);
    expect(rows).toHaveLength(1);
  });

  it('refuse les mauvais statuts et les tâches inconnues', async () => {
    const id = await insertJob('print_bill', 1);
    expect((await done(id)).status).toBe(409);
    expect((await fail(id)).status).toBe(409);
    const waiting = await insertJob('cancel_line', 1, { status: 'waiting' });
    expect((await start(waiting)).status).toBe(409);
    expect((await start(999)).status).toBe(404);
    expect((await start(Number.NaN)).status).toBe(404);
  });
});

describe('tâche en échec', () => {
  it('alerte les serveurs, garde la raison et l’étape, et passe la commande en échec', async () => {
    const waiter = await staff('amira', 'waiter');
    const order = await staffOrder(waiter.token);
    await failedJob(1);
    expect(sent('pos:failed')).toEqual([
      {
        jobId: 1,
        type: 'enter_order',
        tableNumber: 7,
        orderId: order.id,
        error: 'SCREEN_MISMATCH',
      },
    ]);
    expect((sent('order:updated') as Order[]).at(-1)).toMatchObject({ pos: { status: 'failed' } });
    const { rows } = await db.query(`SELECT last_step FROM pos_jobs WHERE id = 1`);
    expect(rows[0]).toEqual({ last_step: 'open_table' });
    // Rejouée : pas de deuxième alerte.
    expect((await fail(1)).status).toBe(200);
    expect(sent('pos:failed')).toHaveLength(1);
  });

  it('valide le corps', async () => {
    const id = await insertJob('print_bill', 1);
    await start(id);
    const res = await api()
      .post(`/api/pos/jobs/${String(id)}/fail`)
      .set(agentAuth)
      .send({ step: 'x' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });

  it('bloque les tâches suivantes de la même table (départ ou arrivée), pas les autres', async () => {
    const pay = await insertJob('pay_table', 1, {
      payload: { method: 'cash', expectedTotal: 10500 },
    });
    const sameTable = await insertJob('print_bill', 1);
    const arriving = await insertJob('move_table', 3, { toTableId: 1 });
    const otherTable = await insertJob('print_bill', 2);
    await failedJob(pay);

    expect(await loadJob(db, sameTable)).toMatchObject({ status: 'queued', blockedByJobId: pay });
    expect(await loadJob(db, arriving)).toMatchObject({ blockedByJobId: pay });
    expect(await loadJob(db, otherTable)).toMatchObject({ blockedByJobId: null });
    expect(await nextId()).toBe(otherTable);
    expect((await start(sameTable)).status).toBe(409);
    await start(otherTable);
    await done(otherTable);
    expect(await nextId()).toBeNull();
  });

  it('ne bloque pas une tâche créée avant l’échec', async () => {
    const before = await insertJob('print_bill', 1);
    const pay = await insertJob('pay_table', 1);
    // L'agent a pris la tâche plus récente (ex. tâche plus ancienne réessayée après coup).
    await db.query(`UPDATE pos_jobs SET status = 'failed' WHERE id = $1`, [pay]);
    expect(await loadJob(db, before)).toMatchObject({ blockedByJobId: null });
    expect(await nextId()).toBe(before);
  });

  it('se débloque après un réessai réussi', async () => {
    const waiter = await staff('amira', 'waiter');
    const pay = await insertJob('pay_table', 1);
    const after = await insertJob('print_bill', 1);
    await failedJob(pay);
    expect(await nextId()).toBeNull();

    const res = await api()
      .post(`/api/pos/jobs/${String(pay)}/retry`)
      .set(auth(waiter.token));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'queued', attempts: 1 });
    expect(sent('pos:job')).toContainEqual({ jobId: pay });
    // Réessayée, elle garde sa place : avant la tâche qu'elle bloquait.
    expect(await nextId()).toBe(pay);
    await start(pay);
    await done(pay);
    expect(await nextId()).toBe(after);
  });

  it('se débloque quand le principal la marque faite à la main', async () => {
    const principal = await staff('amira', 'waiter');
    const helper = await staff('sami', 'waiter');
    const pay = await insertJob('pay_table', 1);
    const after = await insertJob('print_bill', 1);
    await failedJob(pay);

    const url = `/api/pos/jobs/${String(pay)}/resolve-manually`;
    const refused = await api().post(url).set(auth(helper.token)).send({});
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ error: { code: 'NOT_PRINCIPAL' } });

    const res = await api()
      .post(url)
      .set(auth(principal.token))
      .send({ note: 'encaissée au comptoir' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'manual' });
    expect(sent('pos:job')).toContainEqual({ jobId: after });
    expect(await nextId()).toBe(after);
    const { rows } = await db.query(
      `SELECT user_id, note FROM audit_log WHERE action = 'pos.manual'`,
    );
    expect(rows).toEqual([{ user_id: principal.id, note: 'encaissée au comptoir' }]);
    expect((await api().post(url).set(auth(principal.token)).send({})).status).toBe(409);
  });

  it('commande en échec marquée faite à la main', async () => {
    const waiter = await staff('amira', 'waiter');
    const order = await staffOrder(waiter.token);
    await failedJob(1);
    await api().post('/api/pos/jobs/1/resolve-manually').set(auth(waiter.token)).send({});
    expect(await loadOrder(db, order.id)).toMatchObject({ pos: { status: 'manual' } });
  });
});

describe('délai sans heartbeat', () => {
  it('passe en échec AGENT_TIMEOUT, sans remise en file', async () => {
    const id = await insertJob('print_bill', 1);
    await start(id);
    const startedAt = Date.now();

    // Un heartbeat repousse le délai.
    vi.setSystemTime(new Date(startedAt + JOB_TIMEOUT_MS - 1000));
    const beat = await api()
      .post('/api/pos/heartbeat')
      .set(agentAuth)
      .send({ state: 'busy', jobId: id });
    expect(beat.status).toBe(204);
    expect(await failTimedOutJobs(db, new Date(startedAt + JOB_TIMEOUT_MS))).toEqual([]);

    const later = new Date(startedAt + 2 * JOB_TIMEOUT_MS);
    expect(await failTimedOutJobs(db, later)).toEqual([id]);
    const { rows } = await db.query(`SELECT status, last_error FROM pos_jobs WHERE id = $1`, [id]);
    expect(rows[0]).toEqual({ status: 'failed', last_error: 'AGENT_TIMEOUT' });
    // L'agent qui se réveille ne peut plus la terminer : le staff décide.
    expect((await done(id)).status).toBe(409);
  });
});

describe('POST /pos/heartbeat', () => {
  it('annonce pos:status seulement quand l’état change', async () => {
    const beat = (state: string) => api().post('/api/pos/heartbeat').set(agentAuth).send({ state });
    expect((await beat('idle')).status).toBe(204);
    expect((await beat('idle')).status).toBe(204);
    expect((await beat('waiting_for_human')).status).toBe(204);
    expect(sent('pos:status')).toEqual([
      { state: 'idle', lastSeenAt: MONDAY_10H },
      { state: 'waiting_for_human', lastSeenAt: MONDAY_10H },
    ]);
    expect((await beat('sleeping')).status).toBe(400);
  });
});

describe('GET /pos/jobs', () => {
  it('liste les échecs et les annulations en attente, paginés', async () => {
    const waiter = await staff('amira', 'waiter');
    const a = await insertJob('print_bill', 1);
    await failedJob(a);
    const b = await insertJob('print_bill', 2);
    await failedJob(b);
    const waiting = await insertJob('cancel_line', 3, { status: 'waiting' });

    const page1 = await api().get('/api/pos/jobs?status=failed&limit=1').set(auth(waiter.token));
    expect(page1.status).toBe(200);
    expect(page1.body).toMatchObject({
      items: [{ id: a, status: 'failed' }],
      nextCursor: String(a),
    });
    const page2 = await api()
      .get(`/api/pos/jobs?status=failed&limit=1&cursor=${String(a)}`)
      .set(auth(waiter.token));
    expect(page2.body).toMatchObject({ items: [{ id: b }], nextCursor: null });
    const res = await api().get('/api/pos/jobs?status=waiting').set(auth(waiter.token));
    expect((res.body as { items: PosJob[] }).items.map((j) => j.id)).toEqual([waiting]);
    expect((await api().get('/api/pos/jobs?status=done').set(auth(waiter.token))).status).toBe(400);
  });

  it('réservé aux serveurs en shift', async () => {
    const off = await staff('sami', 'waiter', { onShift: false });
    const manager = await staff('neila', 'manager', { onShift: false });
    const offRes = await api().get('/api/pos/jobs?status=failed').set(auth(off.token));
    expect(offRes.body).toMatchObject({ error: { code: 'NOT_ON_SHIFT' } });
    const mRes = await api().get('/api/pos/jobs?status=failed').set(auth(manager.token));
    expect(mRes.body).toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect((await api().post('/api/pos/jobs/1/retry').set(auth(off.token))).status).toBe(403);
  });

  it('refuse de réessayer une tâche qui n’est pas en échec', async () => {
    const waiter = await staff('amira', 'waiter');
    const id = await insertJob('print_bill', 1);
    const res = await api()
      .post(`/api/pos/jobs/${String(id)}/retry`)
      .set(auth(waiter.token));
    expect(res.status).toBe(409);
  });
});

describe('agent hors ligne, GET /pos/status', () => {
  const beat = (state: string) => api().post('/api/pos/heartbeat').set(agentAuth).send({ state });
  const readStatus = async (token: string) => {
    const res = await api().get('/api/pos/status').set(auth(token));
    expect(res.status).toBe(200);
    return res.body as { state: string; lastSeenAt: string | null };
  };

  it('offline tant que l’agent n’a jamais envoyé de heartbeat', async () => {
    const waiter = await staff('amira', 'waiter');
    expect(await readStatus(waiter.token)).toEqual({ state: 'offline', lastSeenAt: null });
  });

  it('relit le dernier état, puis offline après 30 s sans heartbeat', async () => {
    const waiter = await staff('amira', 'waiter');
    await beat('busy');
    expect(await readStatus(waiter.token)).toEqual({
      state: 'busy',
      lastSeenAt: MONDAY_10H.toISOString(),
    });
    // Avant le passage régulier, la lecture voit déjà l'agent hors ligne.
    vi.setSystemTime(new Date(MONDAY_10H.getTime() + AGENT_OFFLINE_MS));
    expect(await readStatus(waiter.token)).toEqual({
      state: 'offline',
      lastSeenAt: MONDAY_10H.toISOString(),
    });
  });

  it('annonce offline une seule fois, puis le retour de l’agent', async () => {
    await beat('idle');
    const later = new Date(MONDAY_10H.getTime() + AGENT_OFFLINE_MS - 1);
    expect(await markAgentOffline(db, later)).toBeNull();
    const after = new Date(MONDAY_10H.getTime() + AGENT_OFFLINE_MS);
    expect(await markAgentOffline(db, after)).toEqual({ state: 'offline', lastSeenAt: MONDAY_10H });
    expect(await markAgentOffline(db, after)).toBeNull();

    vi.setSystemTime(after);
    events = [];
    await beat('idle');
    expect(sent('pos:status')).toEqual([{ state: 'idle', lastSeenAt: after }]);
  });

  it('heartbeat en retard : annoncé comme un retour, même avant le passage régulier', async () => {
    await beat('idle');
    vi.setSystemTime(new Date(MONDAY_10H.getTime() + 2 * AGENT_OFFLINE_MS));
    events = [];
    await beat('idle');
    expect(sent('pos:status')).toHaveLength(1);
  });

  it('serveurs en shift et manager seulement', async () => {
    const manager = await staff('neila', 'manager', { onShift: false });
    expect(await readStatus(manager.token)).toMatchObject({ state: 'offline' });
    const off = await staff('sami', 'waiter', { onShift: false });
    const offRes = await api().get('/api/pos/status').set(auth(off.token));
    expect(offRes.body).toMatchObject({ error: { code: 'NOT_ON_SHIFT' } });
    const barista = await staff('nour', 'barista');
    const bRes = await api().get('/api/pos/status').set(auth(barista.token));
    expect(bRes.body).toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect((await api().get('/api/pos/status').set(agentAuth)).status).toBe(401);
  });
});
