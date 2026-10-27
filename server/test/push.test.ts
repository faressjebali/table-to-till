import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { settleBackground } from '../src/background.js';
import { hashPassword } from '../src/auth/passwords.js';
import type { Role } from '../src/auth/sessions.js';
import { loadConfig, type Config } from '../src/config.js';
import { createPool, type Db } from '../src/db.js';
import {
  managerIds,
  orderReadyMessage,
  stationOnShiftIds,
  waitersOnShiftIds,
} from '../src/push/recipients.js';
import {
  PushGone,
  pushTopic,
  sendPush,
  type PushMessage,
  type PushSender,
  type PushSubscription,
} from '../src/push/send.js';
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

let db: Db;
const ids = new Map<string, number>();
const item = (nameFr: string) => {
  const value = ids.get(nameFr);
  if (value === undefined) throw new Error(`article inconnu : ${nameFr}`);
  return value;
};

// Messages « envoyés » par le faux service push.
type Sent = { endpoint: string; message: PushMessage };
let sent: Sent[];
let failures: Map<string, Error>;
const fakeSender: PushSender = (subscription, message) => {
  const failure = failures.get(subscription.endpoint);
  if (failure) return Promise.reject(failure);
  sent.push({ endpoint: subscription.endpoint, message });
  return Promise.resolve();
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
  sent = [];
  failures = new Map();
  await db.query('TRUNCATE users, tables, audit_log RESTART IDENTITY CASCADE');
  await db.query(
    `INSERT INTO tables (number, kind, qr_token, layout_x, layout_y, layout_w, layout_h, layout_shape)
     VALUES (7, 'real', 'jeton-7', 0, 0, 1, 1, 'square')`,
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const api = () => request(createApp({ db, config, push: fakeSender }));
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

const subscription = (name: string): PushSubscription => ({
  endpoint: `https://push.example.com/${name}`,
  keys: { p256dh: `cle-${name}`, auth: `auth-${name}` },
});

async function subscribe(token: string, name: string): Promise<void> {
  const res = await api()
    .post('/api/push/subscribe')
    .set(auth(token))
    .send({ ...subscription(name), expirationTime: null });
  expect(res.status).toBe(204);
}

// Shift ouvert directement en base (barista et cuisinier).
async function openShift(userId: number): Promise<void> {
  await db.query(`INSERT INTO shifts (user_id) VALUES ($1)`, [userId]);
}

async function postQrOrder(): Promise<number> {
  const res = await api()
    .post('/api/orders')
    .send({
      clientRequestId: randomUUID(),
      tableToken: 'jeton-7',
      lines: [
        { menuItemId: item('Cheese Burger'), quantity: 2, note: 'sans oignon' },
        { menuItemId: item('Bacon de bœuf'), quantity: 1, note: null },
      ],
    });
  expect(res.status).toBe(201);
  return (res.body as { orderId: number }).orderId;
}

describe('POST /push/subscribe', () => {
  it('enregistre le téléphone avec la session, pour tout le staff même hors shift', async () => {
    for (const [login, role] of [
      ['amira', 'waiter'],
      ['sami', 'barista'],
      ['nour', 'chef'],
      ['neila', 'manager'],
    ] as const) {
      await createUser(login, role);
      await subscribe(await tokenFor(login), login);
    }
    const { rows } = await db.query(
      `SELECT p.endpoint, p.p256dh, p.auth, u.login, p.session_id IS NOT NULL AS has_session
         FROM push_subscriptions p JOIN users u ON u.id = p.user_id ORDER BY p.id`,
    );
    expect(rows).toEqual(
      ['amira', 'sami', 'nour', 'neila'].map((login) => ({
        endpoint: `https://push.example.com/${login}`,
        p256dh: `cle-${login}`,
        auth: `auth-${login}`,
        login,
        has_session: true,
      })),
    );
  });

  it('relançable : le même téléphone passe au compte connecté, avec ses nouvelles clés', async () => {
    await createUser('amira');
    await createUser('sami', 'barista');
    await subscribe(await tokenFor('amira'), 'telephone');
    const res = await api()
      .post('/api/push/subscribe')
      .set(auth(await tokenFor('sami')))
      .send({ ...subscription('telephone'), keys: { p256dh: 'nouvelle', auth: 'nouveau' } });
    expect(res.status).toBe(204);
    const { rows } = await db.query(
      `SELECT u.login, p.p256dh, p.auth FROM push_subscriptions p JOIN users u ON u.id = p.user_id`,
    );
    expect(rows).toEqual([{ login: 'sami', p256dh: 'nouvelle', auth: 'nouveau' }]);
  });

  it('refuse sans connexion', async () => {
    const res = await api().post('/api/push/subscribe').send(subscription('x'));
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
  });

  it.each([
    ['endpoint http', { ...subscription('x'), endpoint: 'http://push.example.com/x' }],
    ['clés absentes', { endpoint: 'https://push.example.com/x' }],
    ['clé vide', { ...subscription('x'), keys: { p256dh: '', auth: 'a' } }],
  ])('VALIDATION_ERROR : %s', async (_case, body) => {
    await createUser('amira');
    const res = await api()
      .post('/api/push/subscribe')
      .set(auth(await tokenFor('amira')))
      .send(body);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });
});

describe('push order:new', () => {
  it('nouvelle commande QR : seulement les serveurs en shift, contenu minimal', async () => {
    await createUser('amira');
    await createUser('karim');
    const barista = await createUser('sami', 'barista');
    await openShift(barista);
    const amira = await tokenFor('amira');
    await api().post('/api/shifts/start').set(auth(amira)).expect(201);
    await subscribe(amira, 'amira');
    await subscribe(await tokenFor('karim'), 'karim');
    await subscribe(await tokenFor('sami'), 'sami');

    const orderId = await postQrOrder();
    await vi.waitFor(() => {
      expect(sent).toHaveLength(1);
    });
    expect(sent).toEqual([
      {
        endpoint: 'https://push.example.com/amira',
        message: {
          type: 'order:new',
          tag: `order-${String(orderId)}`,
          title: 'Nouvelle commande',
          body: 'Table 7 · 3 articles',
          url: `./?order=${String(orderId)}`,
        },
      },
    ]);
    expect(JSON.stringify(sent)).not.toContain('oignon');
  });

  it("n'envoie plus au téléphone déconnecté", async () => {
    await createUser('amira');
    const amira = await tokenFor('amira');
    await api().post('/api/shifts/start').set(auth(amira)).expect(201);
    const other = await tokenFor('amira');
    await subscribe(amira, 'ancien');
    await subscribe(other, 'nouveau');
    await api().post('/api/auth/logout').set(auth(amira)).expect(204);

    await postQrOrder();
    await vi.waitFor(() => {
      expect(sent).toHaveLength(1);
    });
    expect(sent.map((s) => s.endpoint)).toEqual(['https://push.example.com/nouveau']);
  });

  it('envoyée après la réponse, attendue par settleBackground avant le test suivant', async () => {
    await createUser('amira');
    const amira = await tokenFor('amira');
    await api().post('/api/shifts/start').set(auth(amira)).expect(201);
    await subscribe(amira, 'amira');
    // L'envoi reste bloqué jusqu'à ce que le test le libère, après avoir vérifié la réponse.
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slowSender: PushSender = async (subscription, message) => {
      await released;
      sent.push({ endpoint: subscription.endpoint, message });
    };

    const res = await request(createApp({ db, config, push: slowSender }))
      .post('/api/orders')
      .send({
        clientRequestId: randomUUID(),
        tableToken: 'jeton-7',
        lines: [{ menuItemId: item('Cheese Burger'), quantity: 1, note: null }],
      });
    expect(res.status).toBe(201);
    expect(sent).toEqual([]);
    setTimeout(release, 20);
    await settleBackground();
    expect(sent.map((s) => s.endpoint)).toEqual(['https://push.example.com/amira']);
  });
});

// Commande saisie par un serveur en shift sur la table 7 : confirmée tout de suite.
async function postStaffOrder(
  token: string,
  lines: { menuItemId: number; quantity: number; note?: string | null }[],
): Promise<number> {
  const { rows } = await db.query<{ id: number }>('SELECT id FROM tables WHERE number = 7');
  const res = await api()
    .post('/api/staff-orders')
    .set(auth(token))
    .send({ clientRequestId: randomUUID(), tableId: rows[0]?.id, lines });
  expect(res.status).toBe(201);
  return (res.body as { id: number }).id;
}

// Serveur en shift, barista et cuisinier en shift, un barista hors shift : chacun abonné.
async function stationStaff(): Promise<string> {
  await createUser('amira');
  const amira = await tokenFor('amira');
  await api().post('/api/shifts/start').set(auth(amira)).expect(201);
  await subscribe(amira, 'amira');
  for (const [login, role] of [
    ['sami', 'barista'],
    ['hedi', 'chef'],
    ['rim', 'barista'],
  ] as const) {
    const id = await createUser(login, role);
    if (login !== 'rim') await openShift(id);
    await subscribe(await tokenFor(login), login);
  }
  return amira;
}

const stationMessage = (orderId: number, station: 'bar' | 'kitchen', body: string) => ({
  type: 'station:order',
  tag: `station-${String(orderId)}-${station}`,
  title: 'Nouvelle commande',
  body,
  url: './',
});

describe('push station:order', () => {
  it('commande saisie : chaque poste en shift reçoit ses articles seulement, sans note', async () => {
    const amira = await stationStaff();
    const orderId = await postStaffOrder(amira, [
      { menuItemId: item('Espresso'), quantity: 2, note: 'bien serré' },
      { menuItemId: item('Cheese Burger'), quantity: 1 },
      { menuItemId: item('Fondant au chocolat'), quantity: 1 },
    ]);
    await vi.waitFor(() => {
      expect(sent).toHaveLength(2);
    });
    expect(sent).toEqual([
      {
        endpoint: 'https://push.example.com/sami',
        message: stationMessage(orderId, 'bar', 'Table 7 · 3 articles'),
      },
      {
        endpoint: 'https://push.example.com/hedi',
        message: stationMessage(orderId, 'kitchen', 'Table 7 · 2 articles'),
      },
    ]);
    expect(JSON.stringify(sent)).not.toContain('serré');
  });

  it('commande du bar seulement : rien en cuisine', async () => {
    const amira = await stationStaff();
    const orderId = await postStaffOrder(amira, [{ menuItemId: item('Espresso'), quantity: 1 }]);
    await vi.waitFor(() => {
      expect(sent).toHaveLength(1);
    });
    expect(sent).toEqual([
      {
        endpoint: 'https://push.example.com/sami',
        message: stationMessage(orderId, 'bar', 'Table 7 · 1 article'),
      },
    ]);
  });

  it('commande QR : seulement à la confirmation', async () => {
    const amira = await stationStaff();
    const orderId = await postQrOrder();
    await vi.waitFor(() => {
      expect(sent).toHaveLength(1);
    });
    expect(sent.map((s) => s.message.type)).toEqual(['order:new']);

    await api()
      .post(`/api/orders/${String(orderId)}/confirm`)
      .set(auth(amira))
      .expect(200);
    await vi.waitFor(() => {
      expect(sent).toHaveLength(2);
    });
    expect(sent[1]).toEqual({
      endpoint: 'https://push.example.com/hedi',
      message: stationMessage(orderId, 'kitchen', 'Table 7 · 3 articles'),
    });
  });
});

describe('push order:ready', () => {
  it('Prêt : les serveurs en shift reçoivent « Table 7 : boissons prêtes »', async () => {
    const amira = await stationStaff();
    await createUser('karim');
    await subscribe(await tokenFor('karim'), 'karim');
    const orderId = await postStaffOrder(amira, [
      { menuItemId: item('Espresso'), quantity: 1 },
      { menuItemId: item('Cheese Burger'), quantity: 1 },
    ]);
    await vi.waitFor(() => {
      expect(sent).toHaveLength(2);
    });
    sent = [];

    await api()
      .post(`/api/orders/${String(orderId)}/ready`)
      .set(auth(await tokenFor('sami')))
      .expect(200);
    await vi.waitFor(() => {
      expect(sent).toHaveLength(1);
    });
    expect(sent).toEqual([
      {
        endpoint: 'https://push.example.com/amira',
        message: {
          type: 'order:ready',
          tag: `ready-${String(orderId)}-bar`,
          title: 'Commande prête',
          body: 'Table 7 : boissons prêtes',
          url: './',
        },
      },
    ]);
  });
});

describe('pushTopic', () => {
  it('toujours 32 caractères base64url, accepté par Apple quelle que soit la longueur du tag', () => {
    for (const tag of ['order-8', 'order-123', 'station-8-bar', 'station-1234-kitchen']) {
      expect(pushTopic(tag)).toMatch(/^[A-Za-z0-9_-]{32}$/);
    }
    expect(pushTopic('order-123')).toBe(pushTopic('order-123'));
    expect(pushTopic('order-123')).not.toBe(pushTopic('order-124'));
  });
});

describe('sendPush', () => {
  it('oublie un abonnement disparu (404, 410), garde les autres en cas d’erreur', async () => {
    const amira = await createUser('amira');
    const token = await tokenFor('amira');
    await subscribe(token, 'disparu');
    await subscribe(token, 'en-panne');
    await subscribe(token, 'ok');
    failures.set('https://push.example.com/disparu', new PushGone('410'));
    failures.set('https://push.example.com/en-panne', new Error('timeout'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await sendPush(
      db,
      fakeSender,
      [amira],
      orderReadyMessage({
        orderId: 12,
        table: { number: 7 },
        station: 'bar',
      }),
    );

    expect(sent).toEqual([
      {
        endpoint: 'https://push.example.com/ok',
        message: {
          type: 'order:ready',
          tag: 'ready-12-bar',
          title: 'Commande prête',
          body: 'Table 7 : boissons prêtes',
          url: './',
        },
      },
    ]);
    const { rows } = await db.query(`SELECT endpoint FROM push_subscriptions ORDER BY id`);
    expect(rows).toEqual([
      { endpoint: 'https://push.example.com/en-panne' },
      { endpoint: 'https://push.example.com/ok' },
    ]);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("n'envoie pas à un compte désactivé", async () => {
    const amira = await createUser('amira');
    await subscribe(await tokenFor('amira'), 'amira');
    await db.query(`UPDATE users SET disabled_at = now() WHERE id = $1`, [amira]);
    await sendPush(
      db,
      fakeSender,
      [amira],
      orderReadyMessage({
        orderId: 1,
        table: { number: 7 },
        station: 'kitchen',
      }),
    );
    expect(sent).toEqual([]);
  });
});

describe('destinataires', () => {
  it('serveurs en shift, baristas ou cuisiniers en shift, managers actifs', async () => {
    const waiter = await createUser('amira');
    await createUser('karim');
    const barista = await createUser('sami', 'barista');
    await createUser('lina', 'barista');
    const chef = await createUser('nour', 'chef');
    const manager = await createUser('neila', 'manager');
    const disabled = await createUser('moncef', 'manager');
    await db.query(`UPDATE users SET disabled_at = now() WHERE id = $1`, [disabled]);
    for (const id of [waiter, barista, chef]) await openShift(id);

    expect(await waitersOnShiftIds(db)).toEqual([waiter]);
    expect(await stationOnShiftIds(db, 'bar')).toEqual([barista]);
    expect(await stationOnShiftIds(db, 'kitchen')).toEqual([chef]);
    expect(await managerIds(db)).toEqual([manager]);
  });
});
