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
import { parseMenuCsv } from '../src/seed/menu-csv.js';
import { seedMenu } from '../src/seed/seed-menu.js';
import { resetTestDatabase, testUrl } from './helpers/db.js';

const PASSWORD = 'bonjour123';
const config: Config = {
  ...loadConfig(),
  loginRateLimitPerMinute: 1000,
  firstManagerLogin: '',
  firstManagerTempPassword: '',
  qrOrderRateLimit: 100,
};
const menu = parseMenuCsv(
  readFileSync(new URL('../../docs/menu/menu.csv', import.meta.url), 'utf8'),
);

// Heure de Tunis (UTC+1). Le 19/10/2026 est un lundi.
const MONDAY_10H = new Date('2026-10-19T10:00:00+01:00');
const SUNDAY_21H = new Date('2026-10-18T21:00:00+01:00');

let db: Db;
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
});

afterAll(async () => {
  await db.end();
});

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(MONDAY_10H);
  await db.query('TRUNCATE users, tables, audit_log RESTART IDENTITY CASCADE');
  await db.query(
    `INSERT INTO tables (number, kind, qr_token, layout_x, layout_y, layout_w, layout_h, layout_shape)
     VALUES (7, 'real', 'jeton-7', 0, 0, 1, 1, 'square'),
            (8, 'real', 'jeton-8', 1, 0, 1, 1, 'square')`,
  );
});

afterEach(() => {
  vi.useRealTimers();
});

const api = () => request(createApp({ db, config }));
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

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

type Line = {
  menuItemId: number;
  quantity: number;
  note?: string;
  choices?: { group: string; menuItemId: number }[];
};

// Commande saisie par un serveur : confirmée tout de suite.
async function staffOrder(token: string, lines: Line[], tableId = 1): Promise<Order> {
  const res = await api()
    .post('/api/staff-orders')
    .set(auth(token))
    .send({ clientRequestId: randomUUID(), tableId, lines });
  expect(res.status).toBe(201);
  return res.body as Order;
}

const espresso = (): Line => ({ menuItemId: item('Espresso'), quantity: 2, note: 'serré' });
const burger = (): Line => ({ menuItemId: item('Cheese Burger'), quantity: 1 });
const carrotCake = (): Line => ({ menuItemId: item('Carrot cake'), quantity: 1 });

const stationOrders = async (token: string) => {
  const res = await api().get('/api/station-orders').set(auth(token));
  expect(res.status).toBe(200);
  return (res.body as { items: Order[] }).items;
};
const ready = (token: string, orderId: number) =>
  api()
    .post(`/api/orders/${String(orderId)}/ready`)
    .set(auth(token));

describe('GET /station-orders', () => {
  it('chaque poste voit ses lignes, both chez les deux, avec notes et choix', async () => {
    const waiter = await staff('amira', 'waiter');
    const barista = await staff('nour', 'barista');
    const chef = await staff('hedi', 'chef');
    const order = await staffOrder(waiter.token, [
      espresso(),
      burger(),
      carrotCake(),
      {
        menuItemId: item('Early Bird'),
        quantity: 1,
        choices: [{ group: 'hot_drink', menuItemId: item('Capuccino') }],
      },
    ]);
    // Le serveur voit toutes les lignes, avec leur poste et rien de prêt.
    expect(order.lines.map((l) => l.station)).toEqual(['bar', 'kitchen', 'both', 'both']);
    expect(order.ready).toEqual({ bar: null, kitchen: null });

    const bar = await stationOrders(barista.token);
    expect(bar).toHaveLength(1);
    expect(bar[0]).toMatchObject({
      id: order.id,
      table: { number: 7 },
      confirmedBy: { id: waiter.id },
    });
    expect(bar[0]?.lines.map((l) => l.name.fr)).toEqual(['Espresso', 'Carrot cake', 'Early Bird']);
    expect(bar[0]?.lines[0]).toMatchObject({ quantity: 2, note: 'serré', station: 'bar' });
    expect(bar[0]?.lines[2]?.choices).toEqual([
      {
        group: 'hot_drink',
        menuItemId: item('Capuccino'),
        name: { fr: 'Capuccino', en: 'Cappuccino' },
      },
    ]);

    const kitchen = await stationOrders(chef.token);
    expect(kitchen[0]?.lines.map((l) => l.name.fr)).toEqual([
      'Cheese Burger',
      'Carrot cake',
      'Early Bird',
    ]);
  });

  it('seulement les commandes confirmées du jour, les plus anciennes d’abord', async () => {
    const waiter = await staff('amira', 'waiter');
    const barista = await staff('nour', 'barista');

    vi.setSystemTime(SUNDAY_21H);
    await staffOrder(waiter.token, [espresso()]);
    vi.setSystemTime(MONDAY_10H);
    const first = await staffOrder(waiter.token, [espresso()]);
    vi.setSystemTime(new Date(MONDAY_10H.getTime() + 60_000));
    const second = await staffOrder(waiter.token, [espresso()], 2);
    // Commande QR pas encore confirmée : jamais au bar.
    const qr = await api()
      .post('/api/orders')
      .send({ clientRequestId: randomUUID(), tableToken: 'jeton-7', lines: [espresso()] });
    expect(qr.status).toBe(201);
    // Commande sans ligne du bar.
    await staffOrder(waiter.token, [burger()]);

    expect((await stationOrders(barista.token)).map((o) => o.id)).toEqual([first.id, second.id]);
  });

  it('une commande dont les lignes du poste sont toutes annulées sort de la liste', async () => {
    const waiter = await staff('amira', 'waiter');
    const barista = await staff('nour', 'barista');
    const order = await staffOrder(waiter.token, [espresso(), carrotCake()]);
    await db.query(`UPDATE order_lines SET status = 'cancelled' WHERE id = $1`, [
      order.lines[0]?.id,
    ]);

    // Une ligne active reste : la ligne annulée s'affiche barrée.
    const [shown] = await stationOrders(barista.token);
    expect(shown?.lines.map((l) => l.status)).toEqual(['cancelled', 'active']);
    expect(shown?.total).toBe(order.lines[1]?.lineTotal);

    await db.query(`UPDATE order_lines SET status = 'cancelled' WHERE order_id = $1`, [order.id]);
    expect(await stationOrders(barista.token)).toEqual([]);
  });

  it('réservé au barista et au cuisinier en shift', async () => {
    const offShift = await staff('nour', 'barista', { onShift: false });
    const res = await api().get('/api/station-orders').set(auth(offShift.token));
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: { code: 'NOT_ON_SHIFT' } });

    for (const role of ['waiter', 'manager'] as const) {
      const other = await staff(role, role, { onShift: role === 'waiter' });
      const forbidden = await api().get('/api/station-orders').set(auth(other.token));
      expect(forbidden.status).toBe(403);
      expect(forbidden.body).toMatchObject({ error: { code: 'FORBIDDEN' } });
    }
  });
});

describe('POST /orders/:id/ready', () => {
  it('marque prête la partie du poste, sans toucher à l’autre', async () => {
    const waiter = await staff('amira', 'waiter');
    const barista = await staff('nour', 'barista');
    const chef = await staff('hedi', 'chef');
    const order = await staffOrder(waiter.token, [espresso(), burger()]);

    const res = await ready(barista.token, order.id);
    expect(res.status).toBe(200);
    const body = res.body as Order;
    expect(body.lines.map((l) => l.name.fr)).toEqual(['Espresso']);
    expect(body.ready).toEqual({
      bar: { at: MONDAY_10H.toISOString(), by: { id: barista.id, name: 'Nom nour' } },
      kitchen: null,
    });

    expect(await stationOrders(barista.token)).toEqual([]);
    expect((await stationOrders(chef.token)).map((o) => o.id)).toEqual([order.id]);

    const { rows } = await db.query<{ user_id: number; details: unknown }>(
      `SELECT user_id, details FROM audit_log WHERE action = 'order.ready'`,
    );
    expect(rows).toEqual([{ user_id: barista.id, details: { station: 'bar' } }]);

    // Déjà prête.
    const again = await ready(barista.token, order.id);
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ error: { code: 'INVALID_STATUS' } });
  });

  it('409 sans ligne active du poste ou pour une commande pas confirmée, 404 inconnue', async () => {
    const waiter = await staff('amira', 'waiter');
    const barista = await staff('nour', 'barista');
    const order = await staffOrder(waiter.token, [burger()]);
    const noBar = await ready(barista.token, order.id);
    expect(noBar.status).toBe(409);
    expect(noBar.body).toMatchObject({ error: { code: 'INVALID_STATUS' } });

    const qr = await api()
      .post('/api/orders')
      .send({ clientRequestId: randomUUID(), tableToken: 'jeton-8', lines: [espresso()] });
    const pending = await ready(barista.token, (qr.body as { orderId: number }).orderId);
    expect(pending.status).toBe(409);

    for (const id of ['999999', 'abc']) {
      const missing = await api().post(`/api/orders/${id}/ready`).set(auth(barista.token));
      expect(missing.status).toBe(404);
      expect(missing.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
    }
  });

  it('réservé au barista et au cuisinier en shift', async () => {
    const waiter = await staff('amira', 'waiter');
    const order = await staffOrder(waiter.token, [espresso()]);
    const forbidden = await ready(waiter.token, order.id);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body).toMatchObject({ error: { code: 'FORBIDDEN' } });

    const offShift = await staff('nour', 'barista', { onShift: false });
    const res = await ready(offShift.token, order.id);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: { code: 'NOT_ON_SHIFT' } });
  });
});
