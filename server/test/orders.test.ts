import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth/passwords.js';
import type { Role } from '../src/auth/sessions.js';
import { loadConfig, type Config } from '../src/config.js';
import { createPool, type Db } from '../src/db.js';
import { expirePendingOrders } from '../src/orders/expiry.js';
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
  orderPendingTtlSeconds: 300,
  qrOrderRateLimit: 10,
  qrOrderRateWindowMinutes: 10,
};
const menu = parseMenuCsv(
  readFileSync(new URL('../../docs/menu/menu.csv', import.meta.url), 'utf8'),
);

// Heure de Tunis (UTC+1). Le 19/10/2026 est un lundi.
const MONDAY_10H = new Date('2026-10-19T10:00:00+01:00');
const MONDAY_13H = new Date('2026-10-19T13:00:00+01:00');
const MONDAY_7H30 = new Date('2026-10-19T07:30:00+01:00');
const MONDAY_22H = new Date('2026-10-19T22:00:00+01:00');

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
  await db.query(`UPDATE menu_items SET sold_out = false`);
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

async function waiterOnShift(login = 'amira'): Promise<{ id: number; token: string }> {
  const id = await createUser(login);
  const token = await tokenFor(login);
  const res = await api().post('/api/shifts/start').set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(201);
  return { id, token };
}

type Line = {
  menuItemId: number;
  quantity: number;
  note?: string | null;
  choices?: { group: string; menuItemId: number }[];
};

const burger = (): Line => ({
  menuItemId: item('Cheese Burger'),
  quantity: 1,
  note: 'sans oignon',
});

function postOrder(lines: Line[], options: { tableToken?: string; clientRequestId?: string } = {}) {
  return api()
    .post('/api/orders')
    .send({
      clientRequestId: options.clientRequestId ?? randomUUID(),
      tableToken: options.tableToken ?? 'jeton-7',
      lines,
    });
}

async function pendingOrder(lines: Line[] = [burger()], tableToken = 'jeton-7'): Promise<number> {
  const res = await postOrder(lines, { tableToken });
  expect(res.status).toBe(201);
  return (res.body as { orderId: number }).orderId;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('POST /orders', () => {
  it('crée une commande en attente, prix calculés par le serveur', async () => {
    await waiterOnShift();
    const res = await postOrder([
      { ...burger(), quantity: 2 },
      { menuItemId: item('Bacon de bœuf'), quantity: 1, note: null },
      {
        menuItemId: item('Early Bird'),
        quantity: 1,
        note: '',
        choices: [{ group: 'hot_drink', menuItemId: item('Capuccino') }],
      },
    ]);
    expect(res.status).toBe(201);
    const { rows: prices } = await db.query<{ id: number; price: number }>(
      'SELECT id, price FROM menu_items WHERE id = ANY($1)',
      [[item('Cheese Burger'), item('Bacon de bœuf'), item('Early Bird')]],
    );
    const price = (id: number) => prices.find((p) => p.id === id)?.price ?? NaN;
    const total =
      2 * price(item('Cheese Burger')) + price(item('Bacon de bœuf')) + price(item('Early Bird'));
    expect(res.body).toEqual({
      orderId: 1,
      status: 'pending',
      total,
      expiresAt: new Date(MONDAY_10H.getTime() + 300_000).toISOString(),
    });

    const { rows: lines } = await db.query(
      `SELECT name_fr, quantity, unit_price, note FROM order_lines ORDER BY id`,
    );
    expect(lines).toEqual([
      {
        name_fr: 'Cheese Burger',
        quantity: 2,
        unit_price: price(item('Cheese Burger')),
        note: 'sans oignon',
      },
      {
        name_fr: 'Bacon de bœuf',
        quantity: 1,
        unit_price: price(item('Bacon de bœuf')),
        note: null,
      },
      {
        name_fr: 'Early Bird',
        quantity: 1,
        unit_price: price(item('Early Bird')),
        note: null,
      },
    ]);
    const { rows: choices } = await db.query(
      `SELECT group_key, menu_item_id FROM order_line_choices`,
    );
    expect(choices).toEqual([{ group_key: 'hot_drink', menu_item_id: item('Capuccino') }]);
  });

  it('ignore un prix envoyé par le client', async () => {
    await waiterOnShift();
    const res = await postOrder([{ ...burger(), unitPrice: 1 } as Line]);
    expect(res.status).toBe(201);
    const { rows } = await db.query<{ unit_price: number }>('SELECT unit_price FROM order_lines');
    expect(rows[0]?.unit_price).toBe(28500);
  });

  it('même clientRequestId : même réponse, rien de recréé', async () => {
    await waiterOnShift();
    const clientRequestId = randomUUID();
    const first = await postOrder([burger()], { clientRequestId });
    const again = await postOrder([burger(), burger()], { clientRequestId });
    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(again.body).toEqual(first.body);
    const { rows } = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM orders');
    expect(rows[0]?.count).toBe(1);
  });

  it('café fermé : CAFE_CLOSED avant tout le reste', async () => {
    await waiterOnShift();
    for (const time of [MONDAY_7H30, MONDAY_22H]) {
      vi.setSystemTime(time);
      const res = await postOrder([burger()], { tableToken: 'inconnu' });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ error: { code: 'CAFE_CLOSED' } });
    }
  });

  it('jeton de table inconnu : TABLE_NOT_FOUND', async () => {
    await waiterOnShift();
    const res = await postOrder([burger()], { tableToken: 'inconnu' });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: { code: 'TABLE_NOT_FOUND' } });
  });

  it('aucun serveur en shift : NO_WAITER_ON_SHIFT', async () => {
    const res = await postOrder([burger()]);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: { code: 'NO_WAITER_ON_SHIFT' } });
  });

  it('article hors de ses horaires : OUTSIDE_HOURS avec menuItemId', async () => {
    await waiterOnShift();
    vi.setSystemTime(MONDAY_13H);
    const res = await postOrder([
      burger(),
      {
        menuItemId: item('Early Bird'),
        quantity: 1,
        choices: [{ group: 'hot_drink', menuItemId: item('Capuccino') }],
      },
    ]);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      error: {
        code: 'OUTSIDE_HOURS',
        details: { menuItemId: item('Early Bird') },
      },
    });
  });

  it('article ou option en rupture : ITEM_UNAVAILABLE', async () => {
    await waiterOnShift();
    await db.query('UPDATE menu_items SET sold_out = true WHERE id = $1', [item('Capuccino')]);
    const option = await postOrder([
      {
        menuItemId: item('Early Bird'),
        quantity: 1,
        choices: [{ group: 'hot_drink', menuItemId: item('Capuccino') }],
      },
    ]);
    expect(option.status).toBe(409);
    expect(option.body).toMatchObject({
      error: {
        code: 'ITEM_UNAVAILABLE',
        details: { menuItemId: item('Capuccino') },
      },
    });

    await db.query('UPDATE menu_items SET sold_out = true WHERE id = $1', [item('Cheese Burger')]);
    const line = await postOrder([burger()]);
    expect(line.status).toBe(409);
    expect(line.body).toMatchObject({
      error: {
        code: 'ITEM_UNAVAILABLE',
        details: { menuItemId: item('Cheese Burger') },
      },
    });
  });

  it('article sans code produit : ITEM_UNAVAILABLE', async () => {
    await waiterOnShift();
    await db.query('UPDATE menu_items SET pos_code = NULL WHERE id = $1', [item('Cheese Burger')]);
    try {
      const res = await postOrder([burger()]);
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ error: { code: 'ITEM_UNAVAILABLE' } });
    } finally {
      await db.query(`UPDATE menu_items SET pos_code = '250' WHERE id = $1`, [
        item('Cheese Burger'),
      ]);
    }
  });

  it.each([
    ['choix manquants', [{ menuItemId: 0, quantity: 1 }], 'lines.0.choices'],
    ['quantité > 20', [{ menuItemId: 0, quantity: 21 }], 'lines.0.quantity'],
    [
      'note > 200 caractères',
      [{ menuItemId: 0, quantity: 1, note: 'x'.repeat(201) }],
      'lines.0.note',
    ],
    ['aucune ligne', [], 'lines'],
  ])('%s : VALIDATION_ERROR', async (_name, rawLines, field) => {
    await waiterOnShift();
    const lines = (rawLines as Line[]).map((line) => ({
      ...line,
      menuItemId: field === 'lines.0.choices' ? item('Early Bird') : item('Cheese Burger'),
    }));
    const res = await postOrder(lines);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    expect(res.body).toMatchObject({ error: { details: { fields: [{ field }] } } });
  });

  it('choix invalides ou article inconnu : VALIDATION_ERROR', async () => {
    await waiterOnShift();
    const cases: [Line, string][] = [
      [
        { ...burger(), choices: [{ group: 'hot_drink', menuItemId: item('Capuccino') }] },
        'lines.0.choices',
      ],
      [
        {
          menuItemId: item('Early Bird'),
          quantity: 1,
          choices: [{ group: 'hot_drink', menuItemId: item('Cheese Burger') }],
        },
        'lines.0.choices.0.menuItemId',
      ],
      [
        {
          menuItemId: item('Early Bird'),
          quantity: 1,
          choices: [
            { group: 'hot_drink', menuItemId: item('Capuccino') },
            { group: 'hot_drink', menuItemId: item('Capuccino') },
          ],
        },
        'lines.0.choices',
      ],
      [{ menuItemId: 99999, quantity: 1 }, 'lines.0.menuItemId'],
    ];
    for (const [line, field] of cases) {
      const res = await postOrder([line]);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: { details: { fields: [{ field }] } } });
    }
    const { rows } = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM orders');
    expect(rows[0]?.count).toBe(0);
  });

  it('plus de 10 commandes en 10 minutes sur une table : TOO_MANY_REQUESTS', async () => {
    await waiterOnShift();
    for (let i = 0; i < 10; i++) expect((await postOrder([burger()])).status).toBe(201);
    vi.setSystemTime(new Date(MONDAY_10H.getTime() + 60_000));
    const res = await postOrder([burger()]);
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({
      error: {
        code: 'TOO_MANY_REQUESTS',
        details: { retryAfterSeconds: 540 },
      },
    });
    // Les autres tables ne sont pas touchées ; la fenêtre passée, la table recommande.
    expect((await postOrder([burger()], { tableToken: 'jeton-8' })).status).toBe(201);
    vi.setSystemTime(new Date(MONDAY_10H.getTime() + 600_000));
    expect((await postOrder([burger()])).status).toBe(201);
  });
});

describe('GET /orders/:id', () => {
  it("renvoie l'état depuis la table, expirée après le délai", async () => {
    await waiterOnShift();
    const orderId = await pendingOrder();
    const res = await api().get(`/api/orders/${String(orderId)}?tableToken=jeton-7`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ orderId, status: 'pending' });

    vi.setSystemTime(new Date(MONDAY_10H.getTime() + 300_000));
    const later = await api().get(`/api/orders/${String(orderId)}?tableToken=jeton-7`);
    expect(later.body).toEqual({ orderId, status: 'expired' });
  });

  it('introuvable depuis une autre table ou sans jeton', async () => {
    await waiterOnShift();
    const orderId = await pendingOrder();
    for (const query of ['?tableToken=jeton-8', '']) {
      const res = await api().get(`/api/orders/${String(orderId)}${query}`);
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
    }
  });
});

describe('GET /orders?status=pending', () => {
  it('liste les commandes en attente au format Order, avec pagination', async () => {
    const waiter = await waiterOnShift();
    const first = await pendingOrder([
      {
        menuItemId: item('Early Bird'),
        quantity: 1,
        note: 'sans sucre',
        choices: [{ group: 'hot_drink', menuItemId: item('Capuccino') }],
      },
    ]);
    const second = await pendingOrder([burger()], 'jeton-8');

    const page = await api().get('/api/orders?status=pending&limit=1').set(auth(waiter.token));
    expect(page.status).toBe(200);
    const body = page.body as { items: Order[]; nextCursor: string | null };
    expect(body.nextCursor).toBe(String(first));
    const [order] = body.items;
    expect(order).toMatchObject({
      id: first,
      table: { id: 1, number: 7 },
      tableSessionId: null,
      source: 'qr',
      status: 'pending',
      total: 10500,
      confirmedAt: null,
      confirmedBy: null,
      offer: null,
      pos: { status: 'not_sent', error: null },
      lines: [
        {
          menuItemId: item('Early Bird'),
          name: { fr: 'Early Bird', en: 'Early Bird' },
          quantity: 1,
          note: 'sans sucre',
          unitPrice: 10500,
          discountPercent: 0,
          lineTotal: 10500,
          status: 'active',
          choices: [
            {
              group: 'hot_drink',
              menuItemId: item('Capuccino'),
              name: { fr: 'Capuccino', en: 'Cappuccino' },
            },
          ],
        },
      ],
    });

    const next = await api()
      .get(`/api/orders?status=pending&limit=1&cursor=${String(body.nextCursor)}`)
      .set(auth(waiter.token));
    const nextBody = next.body as { items: Order[]; nextCursor: string | null };
    expect(nextBody.items.map((o) => o.id)).toEqual([second]);
    expect(nextBody.nextCursor).toBeNull();
    expect(nextBody.items[0]?.lines[0]).not.toHaveProperty('choices');
  });

  it('les commandes expirées disparaissent de la liste', async () => {
    const waiter = await waiterOnShift();
    await pendingOrder();
    vi.setSystemTime(new Date(MONDAY_10H.getTime() + 301_000));
    const res = await api().get('/api/orders?status=pending').set(auth(waiter.token));
    expect(res.body).toEqual({ items: [], nextCursor: null });
  });

  it('réservée aux serveurs en shift', async () => {
    await waiterOnShift();
    await createUser('lina', 'manager');
    await createUser('sami');
    const manager = await api()
      .get('/api/orders?status=pending')
      .set(auth(await tokenFor('lina')));
    expect(manager.status).toBe(403);
    expect(manager.body).toMatchObject({ error: { code: 'FORBIDDEN' } });
    const offShift = await api()
      .get('/api/orders?status=pending')
      .set(auth(await tokenFor('sami')));
    expect(offShift.status).toBe(403);
    expect(offShift.body).toMatchObject({ error: { code: 'NOT_ON_SHIFT' } });
  });

  it('status absent ou autre que pending : VALIDATION_ERROR', async () => {
    const waiter = await waiterOnShift();
    const res = await api().get('/api/orders?status=confirmed').set(auth(waiter.token));
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });
});

describe('POST /orders/:id/confirm', () => {
  it('ouvre la session au nom du principal, met la commande en file caisse', async () => {
    const principal = await waiterOnShift('amira');
    const backup = await waiterOnShift('karim');
    const orderId = await pendingOrder([
      { ...burger(), quantity: 2 },
      {
        menuItemId: item('Early Bird'),
        quantity: 1,
        note: 'sans sucre',
        choices: [{ group: 'hot_drink', menuItemId: item('Capuccino') }],
      },
    ]);

    vi.setSystemTime(new Date(MONDAY_10H.getTime() + 60_000));
    // Le renfort confirme : la table compte quand même dans la caisse du principal.
    const res = await api()
      .post(`/api/orders/${String(orderId)}/confirm`)
      .set(auth(backup.token));
    expect(res.status).toBe(200);
    const order = res.body as Order;
    expect(order).toMatchObject({
      status: 'confirmed',
      tableSessionId: 1,
      confirmedBy: { id: backup.id, name: 'Nom karim' },
      confirmedAt: new Date(MONDAY_10H.getTime() + 60_000).toISOString(),
      total: 67500,
      pos: { status: 'queued', error: null },
    });

    const { rows: sessions } = await db.query('SELECT table_id, principal_id FROM table_sessions');
    expect(sessions).toEqual([{ table_id: 1, principal_id: principal.id }]);

    // Ni notes ni choix en caisse : seulement les codes produits et les quantités.
    const { rows: jobs } = await db.query(
      'SELECT type, status, table_id, order_id, payload FROM pos_jobs',
    );
    expect(jobs).toEqual([
      {
        type: 'enter_order',
        status: 'queued',
        table_id: 1,
        order_id: orderId,
        payload: {
          lines: [
            { orderLineId: order.lines[0]?.id, posCode: '250', quantity: 2 },
            { orderLineId: order.lines[1]?.id, posCode: '215', quantity: 1 },
          ],
        },
      },
    ]);

    const { rows: log } = await db.query(
      `SELECT user_id, action, entity_id, table_id FROM audit_log WHERE action = 'order.confirmed'`,
    );
    expect(log).toEqual([
      { user_id: backup.id, action: 'order.confirmed', entity_id: orderId, table_id: 1 },
    ]);

    const plan = await api().get('/api/tables').set(auth(principal.token));
    expect((plan.body as { tables: unknown[] }).tables[0]).toMatchObject({
      number: 7,
      state: 'occupied',
      openSessionId: 1,
      openTotal: 67500,
      pendingOrders: 0,
      principalId: principal.id,
    });
  });

  it('une deuxième commande de la table rejoint la session ouverte', async () => {
    const waiter = await waiterOnShift();
    const first = await pendingOrder();
    const second = await pendingOrder();
    await api()
      .post(`/api/orders/${String(first)}/confirm`)
      .set(auth(waiter.token));
    const res = await api()
      .post(`/api/orders/${String(second)}/confirm`)
      .set(auth(waiter.token));
    expect(res.body).toMatchObject({ tableSessionId: 1 });
    const { rows } = await db.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM table_sessions',
    );
    expect(rows[0]?.count).toBe(1);
  });

  it('deux confirmations en même temps : une seule passe', async () => {
    const amira = await waiterOnShift('amira');
    const karim = await waiterOnShift('karim');
    const orderId = await pendingOrder();
    const results = await Promise.all(
      [amira, karim].map((w) =>
        api()
          .post(`/api/orders/${String(orderId)}/confirm`)
          .set(auth(w.token)),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const { rows } = await db.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM pos_jobs',
    );
    expect(rows[0]?.count).toBe(1);
  });

  it('déjà traitée ou expirée : INVALID_STATUS ; inconnue : NOT_FOUND', async () => {
    const waiter = await waiterOnShift();
    const rejected = await pendingOrder();
    await api()
      .post(`/api/orders/${String(rejected)}/reject`)
      .set(auth(waiter.token));
    const again = await api()
      .post(`/api/orders/${String(rejected)}/confirm`)
      .set(auth(waiter.token));
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ error: { code: 'INVALID_STATUS' } });

    const late = await pendingOrder();
    vi.setSystemTime(new Date(MONDAY_10H.getTime() + 300_000));
    const expired = await api()
      .post(`/api/orders/${String(late)}/confirm`)
      .set(auth(waiter.token));
    expect(expired.status).toBe(409);
    expect(expired.body).toMatchObject({ error: { code: 'INVALID_STATUS' } });
    const { rows } = await db.query('SELECT status FROM orders WHERE id = $1', [late]);
    expect(rows[0]).toEqual({ status: 'expired' });

    const unknown = await api().post('/api/orders/9999/confirm').set(auth(waiter.token));
    expect(unknown.status).toBe(404);
  });

  it('article ou option passé en rupture : ITEM_UNAVAILABLE, rien n’est confirmé', async () => {
    const waiter = await waiterOnShift();
    const burgerOrder = await pendingOrder();
    const morningOrder = await pendingOrder([
      {
        menuItemId: item('Early Bird'),
        quantity: 1,
        choices: [{ group: 'hot_drink', menuItemId: item('Capuccino') }],
      },
    ]);
    await db.query(`UPDATE menu_items SET sold_out = true WHERE name_fr IN ($1, $2)`, [
      'Cheese Burger',
      'Capuccino',
    ]);

    for (const [orderId, menuItemId] of [
      [burgerOrder, item('Cheese Burger')],
      [morningOrder, item('Capuccino')],
    ] as const) {
      const res = await api()
        .post(`/api/orders/${String(orderId)}/confirm`)
        .set(auth(waiter.token));
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        error: { code: 'ITEM_UNAVAILABLE', details: { menuItemId } },
      });
    }

    const { rows } = await db.query('SELECT status FROM orders ORDER BY id');
    expect(rows).toEqual([{ status: 'pending' }, { status: 'pending' }]);
    const { rows: counts } = await db.query<{ sessions: number; jobs: number }>(
      `SELECT (SELECT count(*) FROM table_sessions)::int AS sessions,
              (SELECT count(*) FROM pos_jobs)::int AS jobs`,
    );
    expect(counts[0]).toEqual({ sessions: 0, jobs: 0 });

    // Le serveur peut ensuite la rejeter.
    const rejected = await api()
      .post(`/api/orders/${String(burgerOrder)}/reject`)
      .set(auth(waiter.token));
    expect(rejected.status).toBe(200);
  });

  it('horaires pas revérifiés : envoyée avant midi, confirmée après', async () => {
    const waiter = await waiterOnShift();
    vi.setSystemTime(new Date('2026-10-19T11:58:00+01:00'));
    const orderId = await pendingOrder([
      {
        menuItemId: item('Early Bird'),
        quantity: 1,
        choices: [{ group: 'hot_drink', menuItemId: item('Capuccino') }],
      },
    ]);
    vi.setSystemTime(new Date('2026-10-19T12:01:00+01:00'));
    const res = await api()
      .post(`/api/orders/${String(orderId)}/confirm`)
      .set(auth(waiter.token));
    expect(res.status).toBe(200);
  });

  it('réservée aux serveurs en shift', async () => {
    await waiterOnShift();
    const orderId = await pendingOrder();
    await createUser('nour', 'barista');
    const res = await api()
      .post(`/api/orders/${String(orderId)}/confirm`)
      .set(auth(await tokenFor('nour')));
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });
});

describe('POST /orders/:id/reject', () => {
  it('rejette sans ouvrir de session ni envoyer en caisse', async () => {
    const waiter = await waiterOnShift();
    const orderId = await pendingOrder();
    const res = await api()
      .post(`/api/orders/${String(orderId)}/reject`)
      .set(auth(waiter.token))
      .send({ reason: 'fausse commande' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'rejected', tableSessionId: null, confirmedBy: null });

    const { rows: order } = await db.query('SELECT rejected_by, reject_reason FROM orders');
    expect(order).toEqual([{ rejected_by: waiter.id, reject_reason: 'fausse commande' }]);
    const { rows: counts } = await db.query(
      `SELECT (SELECT count(*) FROM table_sessions)::int AS sessions,
              (SELECT count(*) FROM pos_jobs)::int AS jobs`,
    );
    expect(counts).toEqual([{ sessions: 0, jobs: 0 }]);
    const { rows: log } = await db.query(
      `SELECT action, details FROM audit_log WHERE action = 'order.rejected'`,
    );
    expect(log).toEqual([{ action: 'order.rejected', details: { reason: 'fausse commande' } }]);
  });

  it('sans motif ; déjà confirmée : INVALID_STATUS', async () => {
    const waiter = await waiterOnShift();
    const orderId = await pendingOrder();
    const res = await api()
      .post(`/api/orders/${String(orderId)}/reject`)
      .set(auth(waiter.token));
    expect(res.status).toBe(200);

    const confirmed = await pendingOrder();
    await api()
      .post(`/api/orders/${String(confirmed)}/confirm`)
      .set(auth(waiter.token));
    const late = await api()
      .post(`/api/orders/${String(confirmed)}/reject`)
      .set(auth(waiter.token));
    expect(late.status).toBe(409);
    expect(late.body).toMatchObject({ error: { code: 'INVALID_STATUS' } });
  });
});

describe('expiration automatique', () => {
  it('passe les commandes en attente trop anciennes en expired, au journal', async () => {
    await waiterOnShift();
    const old = await pendingOrder();
    vi.setSystemTime(new Date(MONDAY_10H.getTime() + 200_000));
    const recent = await pendingOrder();

    const expired = await expirePendingOrders(db, new Date(MONDAY_10H.getTime() + 300_000));
    expect(expired).toEqual([{ id: old, tableId: 1 }]);
    const { rows } = await db.query('SELECT id, status FROM orders ORDER BY id');
    expect(rows).toEqual([
      { id: old, status: 'expired' },
      { id: recent, status: 'pending' },
    ]);
    const { rows: log } = await db.query(
      `SELECT user_id, entity_id FROM audit_log WHERE action = 'order.expired'`,
    );
    expect(log).toEqual([{ user_id: null, entity_id: old }]);
  });
});

describe('POST /staff-orders', () => {
  function postStaffOrder(token: string, body: Record<string, unknown>) {
    return api()
      .post('/api/staff-orders')
      .set(auth(token))
      .send({ clientRequestId: randomUUID(), tableId: 1, lines: [burger()], ...body });
  }

  it('confirmée tout de suite : session au nom du principal, file caisse, journal', async () => {
    const principal = await waiterOnShift('amira');
    const backup = await waiterOnShift('karim');
    // Le renfort saisit : la table compte quand même dans la caisse du principal.
    const res = await postStaffOrder(backup.token, {
      lines: [
        { ...burger(), quantity: 2, unitPrice: 1 },
        {
          menuItemId: item('Early Bird'),
          quantity: 1,
          note: 'sans sucre',
          choices: [{ group: 'hot_drink', menuItemId: item('Capuccino') }],
        },
      ],
    });
    expect(res.status).toBe(201);
    const order = res.body as Order;
    expect(order).toMatchObject({
      table: { id: 1, number: 7 },
      tableSessionId: 1,
      source: 'waiter',
      status: 'confirmed',
      confirmedBy: { id: backup.id, name: 'Nom karim' },
      confirmedAt: MONDAY_10H.toISOString(),
      // Prix de la base, jamais celui envoyé par le téléphone.
      total: 67500,
      offer: null,
      pos: { status: 'queued', error: null },
      lines: [
        { quantity: 2, unitPrice: 28500, note: 'sans oignon' },
        {
          quantity: 1,
          unitPrice: 10500,
          note: 'sans sucre',
          choices: [{ group: 'hot_drink', menuItemId: item('Capuccino') }],
        },
      ],
    });

    const { rows: sessions } = await db.query('SELECT table_id, principal_id FROM table_sessions');
    expect(sessions).toEqual([{ table_id: 1, principal_id: principal.id }]);

    // Ni notes ni choix en caisse : seulement les codes produits et les quantités.
    const { rows: jobs } = await db.query(
      'SELECT type, status, table_id, order_id, payload FROM pos_jobs',
    );
    expect(jobs).toEqual([
      {
        type: 'enter_order',
        status: 'queued',
        table_id: 1,
        order_id: order.id,
        payload: {
          lines: [
            { orderLineId: order.lines[0]?.id, posCode: '250', quantity: 2 },
            { orderLineId: order.lines[1]?.id, posCode: '215', quantity: 1 },
          ],
        },
      },
    ]);

    const { rows: log } = await db.query(
      `SELECT user_id, action, entity_id, table_id FROM audit_log WHERE action = 'order.entered'`,
    );
    expect(log).toEqual([
      { user_id: backup.id, action: 'order.entered', entity_id: order.id, table_id: 1 },
    ]);
  });

  it('rejoint la session ouverte de la table', async () => {
    const waiter = await waiterOnShift();
    await api()
      .post(`/api/orders/${String(await pendingOrder())}/confirm`)
      .set(auth(waiter.token));
    const res = await postStaffOrder(waiter.token, {});
    expect(res.body).toMatchObject({ tableSessionId: 1 });
    const { rows } = await db.query<{ sessions: number; jobs: number }>(
      `SELECT (SELECT count(*) FROM table_sessions)::int AS sessions,
              (SELECT count(*) FROM pos_jobs)::int AS jobs`,
    );
    expect(rows).toEqual([{ sessions: 1, jobs: 2 }]);
  });

  it('même clientRequestId : même commande, rien de recréé, même en même temps', async () => {
    const waiter = await waiterOnShift();
    const clientRequestId = randomUUID();
    const results = await Promise.all([
      postStaffOrder(waiter.token, { clientRequestId }),
      postStaffOrder(waiter.token, { clientRequestId }),
    ]);
    const again = await postStaffOrder(waiter.token, { clientRequestId });
    for (const res of [...results, again]) {
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ id: 1, tableSessionId: 1 });
    }
    const { rows } = await db.query(
      `SELECT (SELECT count(*) FROM orders)::int AS orders,
              (SELECT count(*) FROM table_sessions)::int AS sessions,
              (SELECT count(*) FROM pos_jobs)::int AS jobs`,
    );
    expect(rows).toEqual([{ orders: 1, sessions: 1, jobs: 1 }]);

    // Un clientRequestId déjà pris par une commande QR ne renvoie pas cette commande.
    const qrRequestId = randomUUID();
    await postOrder([burger()], { clientRequestId: qrRequestId });
    const reused = await postStaffOrder(waiter.token, { clientRequestId: qrRequestId });
    expect(reused.status).toBe(400);
    expect(reused.body).toMatchObject({
      error: { code: 'VALIDATION_ERROR', details: { fields: [{ field: 'clientRequestId' }] } },
    });
  });

  it('possible après 22h et avant 8h ; les horaires des articles comptent toujours', async () => {
    const waiter = await waiterOnShift();
    vi.setSystemTime(MONDAY_22H);
    expect((await postStaffOrder(waiter.token, {})).status).toBe(201);
    vi.setSystemTime(MONDAY_7H30);
    expect((await postStaffOrder(waiter.token, {})).status).toBe(201);

    vi.setSystemTime(MONDAY_13H);
    const formula = await postStaffOrder(waiter.token, {
      lines: [
        {
          menuItemId: item('Early Bird'),
          quantity: 1,
          choices: [{ group: 'hot_drink', menuItemId: item('Capuccino') }],
        },
      ],
    });
    expect(formula.status).toBe(409);
    expect(formula.body).toMatchObject({
      error: { code: 'OUTSIDE_HOURS', details: { menuItemId: item('Early Bird') } },
    });
  });

  it('article en rupture : ITEM_UNAVAILABLE, rien de créé', async () => {
    const waiter = await waiterOnShift();
    await db.query('UPDATE menu_items SET sold_out = true WHERE id = $1', [item('Cheese Burger')]);
    const res = await postStaffOrder(waiter.token, {});
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      error: { code: 'ITEM_UNAVAILABLE', details: { menuItemId: item('Cheese Burger') } },
    });
    const { rows } = await db.query(
      `SELECT (SELECT count(*) FROM orders)::int AS orders,
              (SELECT count(*) FROM table_sessions)::int AS sessions`,
    );
    expect(rows).toEqual([{ orders: 0, sessions: 0 }]);
  });

  it('table inconnue : NOT_FOUND ; table fictive ou champs des tables d’offre : VALIDATION_ERROR', async () => {
    const waiter = await waiterOnShift();
    await db.query(`INSERT INTO tables (number, kind) VALUES (333, 'virtual')`);

    const unknown = await postStaffOrder(waiter.token, { tableId: 9999 });
    expect(unknown.status).toBe(404);
    expect(unknown.body).toMatchObject({ error: { code: 'NOT_FOUND' } });

    const field = (res: { body: unknown }) =>
      (res.body as { error: { details: { fields: { field: string }[] } } }).error.details.fields[0]
        ?.field;
    const virtual = await postStaffOrder(waiter.token, { tableId: 3 });
    expect(virtual.status).toBe(400);
    expect(field(virtual)).toBe('tableId');
    const requestedBy = await postStaffOrder(waiter.token, { requestedById: waiter.id });
    expect(requestedBy.status).toBe(400);
    expect(field(requestedBy)).toBe('requestedById');
    const forClient = await postStaffOrder(waiter.token, { forClient: true });
    expect(forClient.status).toBe(400);
    expect(field(forClient)).toBe('forClient');
    const noLines = await postStaffOrder(waiter.token, { lines: [] });
    expect(noLines.status).toBe(400);
    expect(field(noLines)).toBe('lines');
  });

  it('réservée aux serveurs en shift', async () => {
    await waiterOnShift();
    await createUser('nour', 'barista');
    await createUser('sami');
    const barista = await postStaffOrder(await tokenFor('nour'), {});
    expect(barista.status).toBe(403);
    expect(barista.body).toMatchObject({ error: { code: 'FORBIDDEN' } });
    const offShift = await postStaffOrder(await tokenFor('sami'), {});
    expect(offShift.status).toBe(403);
    expect(offShift.body).toMatchObject({ error: { code: 'NOT_ON_SHIFT' } });
  });
});
