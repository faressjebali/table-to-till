import { readFileSync } from 'node:fs';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth/passwords.js';
import type { Role } from '../src/auth/sessions.js';
import { loadConfig, type Config } from '../src/config.js';
import { createPool, type Db } from '../src/db.js';
import type { MenuItem } from '../src/menu/items.js';
import { parseMenuCsv } from '../src/seed/menu-csv.js';
import { seedMenu } from '../src/seed/seed-menu.js';
import { resetTestDatabase, testUrl } from './helpers/db.js';

const PASSWORD = 'bonjour123';
const config: Config = { ...loadConfig(), loginRateLimitPerMinute: 1000 };
const menu = parseMenuCsv(
  readFileSync(new URL('../../docs/menu/menu.csv', import.meta.url), 'utf8'),
);

// Heure de Tunis (UTC+1). Le 19/10/2026 est un lundi, le 24/10/2026 un samedi.
const MONDAY_10H = new Date('2026-10-19T10:00:00+01:00');
const MONDAY_13H = new Date('2026-10-19T13:00:00+01:00');
const SATURDAY_10H = new Date('2026-10-24T10:00:00+01:00');
const MONDAY_7H30 = new Date('2026-10-19T07:30:00+01:00');
const MONDAY_22H30 = new Date('2026-10-19T22:30:00+01:00');

type MenuResponse = {
  categories: {
    id: number;
    name: { fr: string; en: string };
    section: 'food' | 'drinks';
    display: 'list' | 'grid';
    sortOrder: number;
    items: MenuItem[];
  }[];
  choiceGroups: { key: string; name: { fr: string; en: string }; optionIds: number[] }[];
};

let db: Db;
const ids = new Map<string, number>();
const id = (nameFr: string) => {
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
  await db.query('TRUNCATE users, audit_log RESTART IDENTITY CASCADE');
  await db.query('UPDATE menu_items SET sold_out = false, archived_at = NULL');
  await db.query(`UPDATE menu_items SET price = NULL WHERE name_fr = 'Plat de la semaine'`);
});

afterEach(() => {
  vi.useRealTimers();
});

const app = () => createApp({ db, config });

async function getMenu(token?: string): Promise<MenuResponse> {
  const req = request(app()).get('/api/menu');
  const res = await (token === undefined ? req : req.set('Authorization', `Bearer ${token}`));
  expect(res.status).toBe(200);
  return res.body as MenuResponse;
}

async function findItem(nameFr: string, token?: string): Promise<MenuItem | undefined> {
  const { categories } = await getMenu(token);
  return categories.flatMap((c) => c.items).find((item) => item.name.fr === nameFr);
}

// Un serveur est mis en shift (ruptures réservées aux serveurs en shift), sauf `onShift: false`.
async function tokenFor(role: Role, { onShift = true } = {}): Promise<string> {
  await db.query(
    `INSERT INTO users (login, name, password_hash, role, must_change_password)
     VALUES ($1, $1, $2, $1, false) ON CONFLICT DO NOTHING`,
    [role, await hashPassword(PASSWORD)],
  );
  if (role !== 'manager' && onShift) {
    await db.query(
      `INSERT INTO shifts (user_id) SELECT id FROM users WHERE login = $1
       ON CONFLICT (user_id) WHERE ended_at IS NULL DO NOTHING`,
      [role],
    );
  }
  const res = await request(app())
    .post('/api/auth/login')
    .send({ login: role, password: PASSWORD });
  expect(res.status).toBe(200);
  return (res.body as { token: string }).token;
}

async function setAvailable(role: Role, nameFr: string, available: boolean) {
  return request(app())
    .patch(`/api/menu-items/${String(id(nameFr))}/availability`)
    .set('Authorization', `Bearer ${await tokenFor(role)}`)
    .send({ available });
}

describe('GET /menu', () => {
  it('renvoie les catégories dans l’ordre du menu papier, sans connexion', async () => {
    const { categories } = await getMenu();
    expect(categories.map((c) => c.name.fr)).toEqual(menu.categories.map((c) => c.nameFr));
    expect(categories[0]?.name).toEqual({ fr: 'Formules petit-déjeuner', en: 'Breakfast sets' });
    // 86 articles, moins le Plat de la semaine tant qu'il n'a pas de prix.
    expect(categories.flatMap((c) => c.items)).toHaveLength(85);
  });

  it('range chaque catégorie dans Food ou Drinks', async () => {
    const { categories } = await getMenu();
    const section = (nameFr: string) => categories.find((c) => c.name.fr === nameFr)?.section;
    expect(section('Formules petit-déjeuner')).toBe('food');
    expect(section('Plat de la semaine')).toBe('food');
    expect(section('Jus')).toBe('drinks');
    expect(section('Eau')).toBe('drinks');
    // Food d'abord, puis Drinks, comme le menu papier.
    const sections = categories.map((c) => c.section);
    expect(sections.indexOf('drinks')).toBe(sections.lastIndexOf('food') + 1);
  });

  it('affiche seulement les Extras en tableau, comme le menu papier', async () => {
    const { categories } = await getMenu();
    expect(categories.filter((c) => c.display === 'grid').map((c) => c.name.fr)).toEqual([
      'Extras',
    ]);
  });

  it('renvoie un MenuItem au format du contrat, sans posCode', async () => {
    await db.query(`UPDATE menu_items SET pos_code = '1234' WHERE name_fr = 'Cheese Burger'`);
    const item = await findItem('Cheese Burger');
    expect(item).toEqual({
      id: id('Cheese Burger'),
      categoryId: expect.any(Number) as number,
      name: { fr: 'Cheese Burger', en: 'Cheese Burger' },
      description: {
        fr: 'Steak haché de bœuf, sauce maison, cheddar, frites et salade classique',
        en: 'Beef patty, house sauce, cheddar, fries and classic salad',
      },
      price: 28500,
      photoUrl: null,
      available: true,
      unavailableReason: null,
      availability: { days: [1, 2, 3, 4, 5, 6, 7], from: null, until: null },
      suggestedExtraIds: ['Bacon de bœuf', 'Œuf', 'Gouda', 'Cheddar', 'Steak'].map(id),
      choiceGroups: [],
      noteHint: null,
      station: 'kitchen',
    });
    expect(item).not.toHaveProperty('posCode');
  });

  it('renvoie les groupes de choix et leurs options', async () => {
    const { choiceGroups } = await getMenu();
    expect(choiceGroups.find((g) => g.key === 'seasonal_juice')).toEqual({
      key: 'seasonal_juice',
      name: { fr: 'Jus de saison', en: 'Seasonal juice' },
      optionIds: [id('Grenade')],
    });
    expect(choiceGroups.find((g) => g.key === 'eggs')?.optionIds).toEqual([
      id('Omelette nature'),
      id('Œufs brouillés'),
    ]);
    const savory = await findItem('Sunrise Plate');
    expect(savory?.choiceGroups).toEqual(['hot_drink', 'eggs']);
    expect(savory?.availability).toEqual({
      days: [1, 2, 3, 4, 5, 6, 7],
      from: '08:00',
      until: '12:00',
    });
  });

  it('calcule la disponibilité selon l’heure de Tunis', async () => {
    expect(await findItem('Early Bird')).toMatchObject({
      available: true,
      unavailableReason: null,
    });
    vi.setSystemTime(MONDAY_13H);
    expect(await findItem('Early Bird')).toMatchObject({
      available: false,
      unavailableReason: 'outside_hours',
    });
    expect(await findItem('Espresso')).toMatchObject({ available: true });
  });

  it('masque le Plat de la semaine sans prix, puis le montre du lundi au vendredi', async () => {
    expect(await findItem('Plat de la semaine')).toBeUndefined();
    await db.query(`UPDATE menu_items SET price = 32000 WHERE name_fr = 'Plat de la semaine'`);
    expect(await findItem('Plat de la semaine')).toMatchObject({
      price: 32000,
      available: true,
      availability: { days: [1, 2, 3, 4, 5], from: '08:00', until: '15:00' },
    });
    vi.setSystemTime(SATURDAY_10H);
    expect(await findItem('Plat de la semaine')).toMatchObject({
      available: false,
      unavailableReason: 'outside_hours',
    });
  });

  it('exclut un article archivé, y compris des extras suggérés', async () => {
    await db.query(`UPDATE menu_items SET archived_at = now() WHERE name_fr = 'Gouda'`);
    expect(await findItem('Gouda')).toBeUndefined();
    expect((await findItem('Cheese Burger'))?.suggestedExtraIds).not.toContain(id('Gouda'));
  });

  it('renvoie le français quand l’anglais manque', async () => {
    await db.query(`UPDATE menu_items SET name_en = NULL WHERE name_fr = 'Espresso'`);
    expect((await findItem('Espresso'))?.name).toEqual({ fr: 'Espresso', en: 'Espresso' });
    await db.query(`UPDATE menu_items SET name_en = 'Espresso' WHERE name_fr = 'Espresso'`);
  });
});

describe('GET /menu avec un jeton staff', () => {
  it('renvoie le posCode de chaque article', async () => {
    const token = await tokenFor('barista');
    expect(await findItem('Fondant au chocolat', token)).toMatchObject({ posCode: '253' });
    expect(await findItem('Grenade', token)).toMatchObject({ posCode: '334' });
  });

  it.each([
    ['22h30', MONDAY_22H30],
    ['7h30', MONDAY_7H30],
  ])('à %s : le staff commande hors ouverture, sauf les horaires propres', async (_label, time) => {
    const token = await tokenFor('waiter', { onShift: false });
    vi.setSystemTime(time);
    expect(await findItem('Espresso', token)).toMatchObject({
      available: true,
      unavailableReason: null,
    });
    for (const nameFr of ['Early Bird', 'Œufs brouillés']) {
      expect(await findItem(nameFr, token)).toMatchObject({
        available: false,
        unavailableReason: 'outside_hours',
      });
    }
    // Sans jeton (menu QR) : tout est masqué hors ouverture.
    const { categories } = await getMenu();
    const items = categories.flatMap((c) => c.items);
    expect(items.every((item) => item.unavailableReason === 'outside_hours')).toBe(true);
    expect(items.some((item) => 'posCode' in item)).toBe(false);
  });

  it('applique les ruptures et les jours du Plat de la semaine', async () => {
    const token = await tokenFor('manager');
    await db.query(`UPDATE menu_items SET price = 32000 WHERE name_fr = 'Plat de la semaine'`);
    await db.query(`UPDATE menu_items SET sold_out = true WHERE name_fr = 'Espresso'`);
    vi.setSystemTime(MONDAY_22H30);
    expect(await findItem('Espresso', token)).toMatchObject({ unavailableReason: 'sold_out' });
    expect(await findItem('Plat de la semaine', token)).toMatchObject({
      unavailableReason: 'outside_hours',
    });
    vi.setSystemTime(SATURDAY_10H);
    expect(await findItem('Plat de la semaine', token)).toMatchObject({
      unavailableReason: 'outside_hours',
    });
  });

  it('refuse un jeton invalide au lieu de servir le menu client', async () => {
    const res = await request(app()).get('/api/menu').set('Authorization', 'Bearer inconnu');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
  });

  it('refuse un compte désactivé', async () => {
    const token = await tokenFor('chef');
    await db.query(`UPDATE users SET disabled_at = now() WHERE login = 'chef'`);
    const res = await request(app()).get('/api/menu').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: { code: 'ACCOUNT_DISABLED' } });
  });
});

describe('PATCH /menu-items/:id/availability', () => {
  it('marque une rupture puis la retire, visible tout de suite dans le menu', async () => {
    await db.query(`UPDATE menu_items SET pos_code = '1234' WHERE name_fr = 'Cheese Burger'`);
    const res = await setAvailable('waiter', 'Cheese Burger', false);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: id('Cheese Burger'),
      available: false,
      unavailableReason: 'sold_out',
      // Le staff reçoit le code caisse, jamais le client.
      posCode: '1234',
    });
    expect(await findItem('Cheese Burger')).toMatchObject({ unavailableReason: 'sold_out' });

    const back = await setAvailable('waiter', 'Cheese Burger', true);
    expect(back.body).toMatchObject({ available: true, unavailableReason: null });
  });

  it('écrit chaque changement au journal, une seule fois', async () => {
    await setAvailable('waiter', 'Espresso', false);
    await setAvailable('waiter', 'Espresso', false);
    await setAvailable('waiter', 'Espresso', true);
    const { rows } = await db.query<{ action: string; entity_id: number }>(
      `SELECT action, entity_id FROM audit_log WHERE entity_type = 'menu_item' ORDER BY id`,
    );
    expect(rows).toEqual([
      { action: 'menu_item.sold_out', entity_id: id('Espresso') },
      { action: 'menu_item.back_in_stock', entity_id: id('Espresso') },
    ]);
  });

  it('répond avec la disponibilité du staff après la fermeture', async () => {
    vi.setSystemTime(MONDAY_22H30);
    const res = await setAvailable('manager', 'Espresso', true);
    expect(res.body).toMatchObject({ available: true, posCode: '210' });
  });

  it('reste hors horaire même sans rupture', async () => {
    vi.setSystemTime(MONDAY_13H);
    const res = await setAvailable('waiter', 'Early Bird', true);
    expect(res.body).toMatchObject({ available: false, unavailableReason: 'outside_hours' });
  });

  it.each([
    ['waiter', 'Espresso', 200],
    ['waiter', 'Cheese Burger', 200],
    ['manager', 'Cheese Burger', 200],
    ['manager', 'Espresso', 200],
    ['barista', 'Espresso', 200],
    ['barista', 'Carrot cake', 200],
    ['barista', 'Cheese Burger', 403],
    ['chef', 'Cheese Burger', 200],
    ['chef', 'Early Bird', 200],
    ['chef', 'Espresso', 403],
  ] as const)('%s sur %s → %i', async (role, nameFr, status) => {
    const res = await setAvailable(role, nameFr, false);
    expect(res.status).toBe(status);
    if (status === 403) {
      expect(res.body).toEqual({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
      expect(await findItem(nameFr)).toMatchObject({ available: true });
    }
  });

  it.each([
    ['waiter', 'Espresso'],
    ['barista', 'Espresso'],
    ['chef', 'Cheese Burger'],
  ] as const)('refuse %s hors shift (NOT_ON_SHIFT)', async (role, nameFr) => {
    const token = await tokenFor(role, { onShift: false });
    const res = await request(app())
      .patch(`/api/menu-items/${String(id(nameFr))}/availability`)
      .set('Authorization', `Bearer ${token}`)
      .send({ available: false });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: { code: 'NOT_ON_SHIFT' } });
    expect(await findItem(nameFr)).toMatchObject({ available: true });
  });

  it('refuse sans connexion', async () => {
    const res = await request(app())
      .patch(`/api/menu-items/${String(id('Espresso'))}/availability`)
      .send({ available: false });
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
  });

  it('404 pour un article inconnu, archivé ou un id invalide', async () => {
    const token = await tokenFor('manager');
    await db.query(`UPDATE menu_items SET archived_at = now() WHERE name_fr = 'Gouda'`);
    for (const path of ['999999', 'abc', String(id('Gouda'))]) {
      const res = await request(app())
        .patch(`/api/menu-items/${path}/availability`)
        .set('Authorization', `Bearer ${token}`)
        .send({ available: false });
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
    }
  });

  it('400 pour un corps invalide', async () => {
    const res = await request(app())
      .patch(`/api/menu-items/${String(id('Espresso'))}/availability`)
      .set('Authorization', `Bearer ${await tokenFor('manager')}`)
      .send({ available: 'no' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: { code: 'VALIDATION_ERROR', details: { fields: [{ field: 'available' }] } },
    });
  });
});
