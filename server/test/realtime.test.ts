import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as connectClient, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth/passwords.js';
import type { Role } from '../src/auth/sessions.js';
import { loadConfig, type Config } from '../src/config.js';
import { createPool, type Db } from '../src/db.js';
import { createRealtime, type Realtime } from '../src/realtime.js';
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
  orderPendingTtlSeconds: 300,
  qrOrderRateLimit: 100,
  qrOrderRateWindowMinutes: 10,
  agentKey: AGENT_KEY,
};
const menu = parseMenuCsv(
  readFileSync(new URL('../../docs/menu/menu.csv', import.meta.url), 'utf8'),
);

// Heure de Tunis (UTC+1). Le 19/10/2026 est un lundi.
const MONDAY_10H = new Date('2026-10-19T10:00:00+01:00');

// Rien reçu pendant ce délai = rien envoyé.
const QUIET_MS = 150;

let db: Db;
let server: Server;
let realtime: Realtime;
let url: string;
const sockets: Socket[] = [];
const ids = new Map<string, number>();
const item = (nameFr: string) => {
  const value = ids.get(nameFr);
  if (value === undefined) throw new Error(`article inconnu : ${nameFr}`);
  return value;
};

beforeAll(async () => {
  await resetTestDatabase();
  db = createPool(testUrl);
  const client = await db.connect();
  try {
    await seedMenu(client, menu);
  } finally {
    client.release();
  }
  const { rows } = await db.query<{ id: number; name_fr: string }>(
    'SELECT id, name_fr FROM menu_items',
  );
  for (const row of rows) ids.set(row.name_fr, row.id);

  // Même montage que src/index.ts : l'API d'abord, puis Socket.IO.
  server = createServer((req, res) => {
    app(req, res);
  });
  realtime = createRealtime(server, { db, config });
  const app = createApp({ db, config, realtime });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  url = `http://localhost:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await realtime.close();
  await db.end();
});

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(MONDAY_10H);
  await db.query('TRUNCATE users, tables, audit_log RESTART IDENTITY CASCADE');
  await db.query(`UPDATE menu_items SET sold_out = false`);
  await db.query(
    `INSERT INTO tables (number, kind, qr_token, layout_x, layout_y, layout_w, layout_h, layout_shape)
     VALUES (7, 'real', 'jeton-7', 0, 0, 1, 1, 'square'),
            (8, 'real', 'jeton-8', 1, 0, 1, 1, 'square')`,
  );
});

afterEach(() => {
  for (const socket of sockets.splice(0)) socket.disconnect();
  vi.useRealTimers();
});

const api = () => request(url);
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

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
  const res = await api().post('/api/auth/login').send({ login, password: PASSWORD });
  expect(res.status).toBe(200);
  return (res.body as { token: string }).token;
}

async function staff(login: string, role: Role = 'waiter') {
  const id = await createUser(login, role);
  return { id, token: await tokenFor(login) };
}

async function startShift(token: string) {
  const res = await api().post('/api/shifts/start').set(auth(token));
  expect(res.status).toBe(201);
}

async function waiterOnShift(login = 'amira') {
  const waiter = await staff(login);
  await startShift(waiter.token);
  return waiter;
}

// Socket connecté, ou erreur de connexion (connect_error) en rejet.
function connect(authData: Record<string, string>): Promise<Socket> {
  const socket = connectClient(url, {
    auth: authData,
    forceNew: true,
    reconnection: false,
    transports: ['websocket'],
  });
  sockets.push(socket);
  return new Promise((resolve, reject) => {
    socket.once('connect', () => {
      resolve(socket);
    });
    socket.once('connect_error', reject);
  });
}

async function connectError(authData: Record<string, string>) {
  const err = await connect(authData).then(
    () => {
      throw new Error('connexion acceptée');
    },
    (e: unknown) => e as Error & { data?: unknown },
  );
  return { code: err.message, data: err.data };
}

// Enregistre tout ce que reçoit un socket, pour vérifier aussi ce qu'il ne reçoit pas.
function record(socket: Socket) {
  const received: { event: string; data: unknown }[] = [];
  socket.onAny((event: string, data: unknown) => {
    received.push({ event, data });
  });
  const of = (event: string) => received.filter((r) => r.event === event).map((r) => r.data);
  // Nombre d'événements déjà rendus par next(), par nom.
  const consumed = new Map<string, number>();
  return {
    of,
    // Prochain événement pas encore rendu, même s'il est arrivé avant l'appel.
    async next(event: string, timeoutMs = 2000): Promise<unknown> {
      // Date est simulé : performance.now() mesure le vrai temps.
      const start = performance.now();
      const index = consumed.get(event) ?? 0;
      while (of(event).length <= index) {
        if (performance.now() - start > timeoutMs) {
          throw new Error(`${event} non reçu`);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      consumed.set(event, index + 1);
      return of(event)[index];
    },
  };
}

const quiet = () => new Promise((resolve) => setTimeout(resolve, QUIET_MS));

function disconnected(socket: Socket): Promise<string> {
  if (socket.disconnected) return Promise.resolve('déjà déconnecté');
  return new Promise((resolve) => socket.once('disconnect', resolve));
}

async function pendingOrder(tableToken = 'jeton-7'): Promise<number> {
  const res = await api()
    .post('/api/orders')
    .send({
      clientRequestId: randomUUID(),
      tableToken,
      lines: [{ menuItemId: item('Cheese Burger'), quantity: 1 }],
    });
  expect(res.status).toBe(201);
  return (res.body as { orderId: number }).orderId;
}

describe('connexion', () => {
  it('refuse une connexion sans identifiants, avec un jeton ou une clé invalide', async () => {
    expect((await connectError({})).code).toBe('UNAUTHORIZED');
    expect((await connectError({ token: 'faux' })).code).toBe('UNAUTHORIZED');
    expect((await connectError({ agentKey: 'fausse' })).code).toBe('UNAUTHORIZED');
    const table = await connectError({ tableToken: 'inconnu' });
    expect(table.code).toBe('TABLE_NOT_FOUND');
    expect(table.data).toEqual({ error: { code: 'TABLE_NOT_FOUND', message: 'Unknown table' } });
  });

  it("refuse un compte désactivé et un compte qui n'a pas changé son mot de passe", async () => {
    const { id, token } = await staff('amira');
    await db.query(`UPDATE users SET must_change_password = true WHERE id = $1`, [id]);
    expect((await connectError({ token })).code).toBe('PASSWORD_CHANGE_REQUIRED');
    await db.query(`UPDATE users SET disabled_at = now() WHERE id = $1`, [id]);
    expect((await connectError({ token })).code).toBe('ACCOUNT_DISABLED');
  });

  it('accepte le staff, une table réelle et l’agent', async () => {
    const { token } = await staff('amira');
    await connect({ token });
    await connect({ tableToken: 'jeton-7' });
    await connect({ agentKey: AGENT_KEY });
  });
});

describe('commandes QR', () => {
  it('order:new et table:updated seulement aux serveurs en shift', async () => {
    const onShift = record(await connect({ token: (await waiterOnShift('amira')).token }));
    const offShift = record(await connect({ token: (await staff('karim')).token }));
    const barista = record(await connect({ token: (await staff('sami', 'barista')).token }));
    const table7 = record(await connect({ tableToken: 'jeton-7' }));

    const orderId = await pendingOrder();

    expect(await onShift.next('order:new')).toMatchObject({
      id: orderId,
      status: 'pending',
      table: { number: 7 },
    });
    expect(await onShift.next('table:updated')).toMatchObject({ number: 7, state: 'free' });
    await quiet();
    for (const other of [offShift, barista, table7]) {
      expect(other.of('order:new')).toEqual([]);
      expect(other.of('table:updated')).toEqual([]);
    }
  });

  it('un barista ou un cuisinier en shift ne reçoit pas les événements des serveurs', async () => {
    const barista = await staff('nour', 'barista');
    const chef = await staff('hedi', 'chef');
    await startShift(barista.token);
    const events = [
      record(await connect({ token: barista.token })),
      record(await connect({ token: chef.token })),
    ];
    // Shift démarré après la connexion : même résultat.
    await startShift(chef.token);
    await waiterOnShift('amira');

    await pendingOrder();
    await quiet();
    for (const e of events) {
      expect(e.of('order:new')).toEqual([]);
      expect(e.of('table:updated')).toEqual([]);
    }
  });

  it('un serveur qui démarre son shift reçoit les commandes sans se reconnecter', async () => {
    await waiterOnShift('amira');
    const karim = await staff('karim');
    const events = record(await connect({ token: karim.token }));

    await pendingOrder();
    await quiet();
    expect(events.of('order:new')).toEqual([]);

    await startShift(karim.token);
    const orderId = await pendingOrder();
    expect(await events.next('order:new')).toMatchObject({ id: orderId });
  });

  it('confirmation : order:updated, table:updated, état à la table et pos:job à l’agent', async () => {
    const waiter = await waiterOnShift();
    const orderId = await pendingOrder();
    const waiters = record(await connect({ token: waiter.token }));
    const table7 = record(await connect({ tableToken: 'jeton-7' }));
    const table8 = record(await connect({ tableToken: 'jeton-8' }));
    const agent = record(await connect({ agentKey: AGENT_KEY }));

    const res = await api()
      .post(`/api/orders/${String(orderId)}/confirm`)
      .set(auth(waiter.token));
    expect(res.status).toBe(200);

    expect(await waiters.next('order:updated')).toMatchObject({ id: orderId, status: 'confirmed' });
    expect(await waiters.next('table:updated')).toMatchObject({
      number: 7,
      state: 'occupied',
      pendingOrders: 0,
    });
    expect(await table7.next('order:updated')).toEqual({ orderId, status: 'confirmed' });
    const { rows } = await db.query<{ id: number }>(`SELECT id FROM pos_jobs WHERE order_id = $1`, [
      orderId,
    ]);
    expect(await agent.next('pos:job')).toEqual({ jobId: rows[0]?.id });
    await quiet();
    expect(table8.of('order:updated')).toEqual([]);
    expect(waiters.of('pos:job')).toEqual([]);
  });

  it('rejet : order:updated aux serveurs et à la table, rien à l’agent', async () => {
    const waiter = await waiterOnShift();
    const orderId = await pendingOrder();
    const waiters = record(await connect({ token: waiter.token }));
    const table7 = record(await connect({ tableToken: 'jeton-7' }));
    const agent = record(await connect({ agentKey: AGENT_KEY }));

    const res = await api()
      .post(`/api/orders/${String(orderId)}/reject`)
      .set(auth(waiter.token));
    expect(res.status).toBe(200);

    expect(await waiters.next('order:updated')).toMatchObject({ id: orderId, status: 'rejected' });
    expect(await table7.next('order:updated')).toEqual({ orderId, status: 'rejected' });
    await quiet();
    expect(agent.of('pos:job')).toEqual([]);
  });

  it('expiration : la table est prévenue (« appelez un serveur »)', async () => {
    const waiter = await waiterOnShift();
    const orderId = await pendingOrder();
    const waiters = record(await connect({ token: waiter.token }));
    const table7 = record(await connect({ tableToken: 'jeton-7' }));

    // Lecture des commandes en attente : l'expiration passe avant.
    vi.setSystemTime(MONDAY_10H.getTime() + 301_000);
    const res = await api().get('/api/orders?status=pending').set(auth(waiter.token));
    expect(res.status).toBe(200);

    expect(await table7.next('order:updated')).toEqual({ orderId, status: 'expired' });
    expect(await waiters.next('order:updated')).toMatchObject({ id: orderId, status: 'expired' });
    expect(await waiters.next('table:updated')).toMatchObject({ number: 7, pendingOrders: 0 });
  });
});

describe('commande saisie par un serveur', () => {
  it('table:updated aux serveurs en shift et pos:job à l’agent', async () => {
    const waiter = await waiterOnShift();
    const waiters = record(await connect({ token: waiter.token }));
    const agent = record(await connect({ agentKey: AGENT_KEY }));
    const { rows } = await db.query<{ id: number }>(`SELECT id FROM tables WHERE number = 8`);

    const res = await api()
      .post('/api/staff-orders')
      .set(auth(waiter.token))
      .send({
        clientRequestId: randomUUID(),
        tableId: rows[0]?.id,
        lines: [{ menuItemId: item('Espresso'), quantity: 2 }],
      });
    expect(res.status).toBe(201);

    expect(await waiters.next('table:updated')).toMatchObject({
      number: 8,
      state: 'occupied',
      openTotal: 10_500,
    });
    expect(await agent.next('pos:job')).toMatchObject({ jobId: expect.any(Number) as number });
    await quiet();
    expect(waiters.of('order:new')).toEqual([]);
  });
});

describe('ruptures', () => {
  it('menu:updated au staff et aux clients, seulement quand la rupture change', async () => {
    const barista = await staff('sami', 'barista');
    await startShift(barista.token);
    const staffEvents = record(await connect({ token: (await staff('karim')).token }));
    const table7 = record(await connect({ tableToken: 'jeton-7' }));
    const agent = record(await connect({ agentKey: AGENT_KEY }));
    const espresso = item('Espresso');
    const markSoldOut = () =>
      api()
        .patch(`/api/menu-items/${String(espresso)}/availability`)
        .set(auth(barista.token))
        .send({ available: false });

    expect((await markSoldOut()).status).toBe(200);
    const update = { menuItemId: espresso, available: false, unavailableReason: 'sold_out' };
    expect(await staffEvents.next('menu:updated')).toEqual(update);
    expect(await table7.next('menu:updated')).toEqual(update);

    expect((await markSoldOut()).status).toBe(200);
    await quiet();
    expect(staffEvents.of('menu:updated')).toHaveLength(1);
    expect(agent.of('menu:updated')).toEqual([]);
  });
});

describe('sessions', () => {
  it('déconnexion : session:revoked LOGGED_OUT sur ce téléphone seulement', async () => {
    await createUser('amira');
    const phone1 = await tokenFor('amira');
    const phone2 = await tokenFor('amira');
    const socket1 = await connect({ token: phone1 });
    const socket2 = await connect({ token: phone2 });
    const events1 = record(socket1);
    const gone = disconnected(socket1);

    expect((await api().post('/api/auth/logout').set(auth(phone1))).status).toBe(204);

    expect(await events1.next('session:revoked')).toEqual({ reason: 'LOGGED_OUT' });
    await gone;
    await quiet();
    expect(socket2.connected).toBe(true);
  });

  it('désactivation : session:revoked ACCOUNT_DISABLED, reconnexion refusée', async () => {
    await createUser('nadia', 'manager');
    const manager = await tokenFor('nadia');
    const sami = await staff('sami', 'barista');
    const socket = await connect({ token: sami.token });
    const events = record(socket);
    const gone = disconnected(socket);

    const res = await api()
      .patch(`/api/users/${String(sami.id)}`)
      .set(auth(manager))
      .send({ active: false });
    expect(res.status).toBe(200);

    expect(await events.next('session:revoked')).toEqual({ reason: 'ACCOUNT_DISABLED' });
    await gone;
    // Sessions révoquées avec la désactivation : même réponse que REST pour l'ancien jeton.
    expect((await connectError({ token: sami.token })).code).toBe('UNAUTHORIZED');
  });

  it('mot de passe réinitialisé : connexions coupées sans événement, reconnexion refusée', async () => {
    await createUser('nadia', 'manager');
    const manager = await tokenFor('nadia');
    const sami = await staff('sami', 'barista');
    const socket = await connect({ token: sami.token });
    const events = record(socket);
    const gone = disconnected(socket);

    const res = await api()
      .post(`/api/users/${String(sami.id)}/reset-password`)
      .set(auth(manager));
    expect(res.status).toBe(200);

    await gone;
    expect(events.of('session:revoked')).toEqual([]);
    expect(await connectError({ token: sami.token })).toEqual({
      code: 'UNAUTHORIZED',
      data: { error: { code: 'UNAUTHORIZED', message: 'Invalid token' } },
    });
  });

  it('rôle changé : connexions coupées, la reconnexion donne le nouveau rôle', async () => {
    await createUser('nadia', 'manager');
    const manager = await tokenFor('nadia');
    const sami = await staff('sami', 'barista');
    const socket = await connect({ token: sami.token });
    const gone = disconnected(socket);

    const res = await api()
      .patch(`/api/users/${String(sami.id)}`)
      .set(auth(manager))
      .send({ role: 'chef' });
    expect(res.status).toBe(200);

    await gone;
    await connect({ token: sami.token });
  });

  it('mot de passe changé : les autres téléphones sont coupés, pas celui-ci', async () => {
    await createUser('amira');
    const phone1 = await tokenFor('amira');
    const phone2 = await tokenFor('amira');
    const socket1 = await connect({ token: phone1 });
    const socket2 = await connect({ token: phone2 });
    const gone = disconnected(socket2);

    const res = await api()
      .post('/api/auth/change-password')
      .set(auth(phone1))
      .send({ currentPassword: PASSWORD, newPassword: 'nouveau-mot-2026' });
    expect(res.status).toBe(204);

    await gone;
    await quiet();
    expect(socket1.connected).toBe(true);
  });
});
