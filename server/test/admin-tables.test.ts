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
let manager: { id: number; token: string };

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
  manager = await account('rania', 'manager');
});

async function account(login: string, role: Role): Promise<{ id: number; token: string }> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO users (login, name, password_hash, role, must_change_password)
     VALUES ($1, $2, $3, $4, false) RETURNING id`,
    [login, `Nom ${login}`, await hashPassword(PASSWORD), role],
  );
  const res = await api.post('/api/auth/login').send({ login, password: PASSWORD });
  expect(res.status).toBe(200);
  return { id: rows[0]?.id ?? 0, token: (res.body as { token: string }).token };
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

type AdminTable = {
  id: number;
  number: number;
  kind: string;
  layout: unknown;
  offer: { label: string; userId: number | null } | null;
  tableToken: string | null;
};

async function create(body: object, token = manager.token) {
  return api.post('/api/admin/tables').set(auth(token)).send(body);
}

async function createOk(body: object): Promise<AdminTable> {
  const res = await create(body);
  expect(res.status).toBe(201);
  return res.body as AdminTable;
}

const real = (number: number, x = 0, y = 0) => ({ number, kind: 'real', layout: { x, y } });

function fields(res: request.Response): string[] {
  return (
    res.body as { error: { details: { fields: { field: string }[] } } }
  ).error.details.fields.map((f) => f.field);
}

describe('POST /admin/tables', () => {
  it('crée une table réelle avec un jeton QR et une case carrée 1×1 par défaut', async () => {
    const table = await createOk(real(7, 7, 2));
    expect(table).toEqual({
      id: table.id,
      number: 7,
      kind: 'real',
      layout: { x: 7, y: 2, w: 1, h: 1, shape: 'square' },
      offer: null,
      tableToken: expect.any(String) as string,
    });
    // Le QR de la nouvelle table marche tout de suite.
    const qr = await api.get(`/api/tables/${String(table.tableToken)}`);
    expect(qr.body).toEqual({ id: table.id, number: 7 });
  });

  it('crée une table fictive de vente directe, et une table d’offre liée à un compte', async () => {
    expect(await createOk({ number: 333, kind: 'virtual' })).toMatchObject({
      layout: null,
      offer: null,
      tableToken: null,
    });
    expect(
      await createOk({
        number: 105,
        kind: 'virtual',
        offer: { label: 'Rania', userId: manager.id },
      }),
    ).toMatchObject({ offer: { label: 'Rania', userId: manager.id }, tableToken: null });
    expect(
      await createOk({
        number: 109,
        kind: 'virtual',
        offer: { label: 'Hedi Mansour', userId: null },
      }),
    ).toMatchObject({ offer: { label: 'Hedi Mansour', userId: null } });
  });

  it('refuse une table incohérente', async () => {
    const cases: [object, string][] = [
      [{ number: 7, kind: 'real' }, 'layout'],
      [{ number: 333, kind: 'virtual', layout: { x: 0, y: 0 } }, 'layout'],
      [{ ...real(7), offer: { label: 'Rania', userId: null } }, 'offer'],
      [{ number: 0, kind: 'virtual' }, 'number'],
      [{ number: 105, kind: 'virtual', offer: { label: ' ', userId: null } }, 'offer.label'],
      [{ number: 7, kind: 'salle' }, 'kind'],
    ];
    for (const [body, field] of cases) {
      const res = await create(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(fields(res)).toContain(field);
    }
  });

  it('refuse un numéro déjà pris', async () => {
    await createOk(real(7));
    const res = await create({ number: 7, kind: 'virtual' });
    expect(res.status).toBe(400);
    expect(fields(res)).toEqual(['number']);
  });

  it('refuse un compte qui n’est pas manager actif, ou qui a déjà sa table d’offre', async () => {
    const waiter = await account('amira', 'waiter');
    const gone = await account('ancien', 'manager');
    await db.query('UPDATE users SET disabled_at = now() WHERE id = $1', [gone.id]);

    for (const userId of [waiter.id, gone.id, 999]) {
      const res = await create({ number: 105, kind: 'virtual', offer: { label: 'X', userId } });
      expect(res.status).toBe(400);
      expect(fields(res)).toEqual(['offer.userId']);
    }

    await createOk({ number: 105, kind: 'virtual', offer: { label: 'Rania', userId: manager.id } });
    const res = await create({
      number: 107,
      kind: 'virtual',
      offer: { label: 'Rania bis', userId: manager.id },
    });
    expect(res.status).toBe(400);
    expect(fields(res)).toEqual(['offer.userId']);
  });

  it('écrit la création au journal', async () => {
    const table = await createOk(real(7));
    const { rows } = await db.query(
      `SELECT user_id, action, entity_id FROM audit_log WHERE entity_type = 'table'`,
    );
    expect(rows).toEqual([{ user_id: manager.id, action: 'table.created', entity_id: table.id }]);
  });
});

describe('GET /admin/tables', () => {
  it('liste toutes les tables, réelles et fictives, triées par numéro', async () => {
    await createOk({ number: 333, kind: 'virtual' });
    await createOk(real(12, 14, 4));
    await createOk(real(2, 12, 7));
    const res = await api.get('/api/admin/tables').set(auth(manager.token));
    expect(res.status).toBe(200);
    const tables = (res.body as { tables: AdminTable[] }).tables;
    expect(tables.map((t) => t.number)).toEqual([2, 12, 333]);
    // Ni état ni montant : la manager n'a pas accès au plan.
    expect(Object.keys(tables[0] ?? {}).sort()).toEqual(
      ['id', 'kind', 'layout', 'number', 'offer', 'tableToken'].sort(),
    );
  });

  it('refuse les autres rôles et les appels sans token', async () => {
    for (const role of ['waiter', 'barista', 'chef'] as const) {
      const { token } = await account(role, role);
      const res = await api.get('/api/admin/tables').set(auth(token));
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ error: { code: 'FORBIDDEN' } });
      expect((await create(real(50), token)).status).toBe(403);
    }
    expect((await api.get('/api/admin/tables')).status).toBe(401);
  });
});

describe('PATCH /admin/tables/:id', () => {
  const patch = (id: number, body: object) =>
    api
      .patch(`/api/admin/tables/${String(id)}`)
      .set(auth(manager.token))
      .send(body);

  it('change le numéro et la case, garde le jeton', async () => {
    const table = await createOk(real(7, 7, 2));
    const res = await patch(table.id, { number: 8, layout: { x: 4, y: 3, shape: 'round' } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      number: 8,
      layout: { x: 4, y: 3, w: 1, h: 1, shape: 'round' },
      tableToken: table.tableToken,
    });
  });

  it('fait d’une table de vente directe une table d’offre, et inversement', async () => {
    const table = await createOk({ number: 106, kind: 'virtual' });
    const offered = await patch(table.id, { offer: { label: 'Invitée', userId: null } });
    expect(offered.body).toMatchObject({ offer: { label: 'Invitée', userId: null } });
    const back = await patch(table.id, { offer: null });
    expect(back.body).toMatchObject({ offer: null });
  });

  it('refuse un changement de type, une case pour une table fictive, une offre sur une table réelle', async () => {
    const realTable = await createOk(real(7));
    const virtualTable = await createOk({ number: 333, kind: 'virtual' });
    expect((await patch(realTable.id, { kind: 'virtual' })).status).toBe(400);
    expect(fields(await patch(virtualTable.id, { layout: { x: 0, y: 0 } }))).toEqual(['layout']);
    expect(fields(await patch(realTable.id, { offer: { label: 'X', userId: null } }))).toEqual([
      'offer',
    ]);
    expect((await patch(realTable.id, {})).status).toBe(400);
  });

  it('refuse un numéro déjà pris', async () => {
    await createOk(real(7));
    const other = await createOk(real(8, 1, 0));
    const res = await patch(other.id, { number: 7 });
    expect(res.status).toBe(400);
    expect(fields(res)).toEqual(['number']);
  });

  it('refuse de modifier une table en cours d’utilisation (409 INVALID_STATUS)', async () => {
    const table = await createOk(real(7));
    const { rows } = await db.query<{ id: number }>(
      'INSERT INTO table_sessions (table_id) VALUES ($1) RETURNING id',
      [table.id],
    );
    const res = await patch(table.id, { number: 70 });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: { code: 'INVALID_STATUS' } });

    // Encaissée : de nouveau modifiable. Une commande en attente la bloque encore.
    await db.query(
      `UPDATE table_sessions SET closed_at = now(), payment_method = 'cash' WHERE id = $1`,
      [rows[0]?.id],
    );
    await db.query(
      `INSERT INTO orders (client_request_id, table_id, source, status, expires_at)
       VALUES ($1, $2, 'qr', 'pending', now() + interval '5 minutes')`,
      [randomUUID(), table.id],
    );
    expect((await patch(table.id, { number: 70 })).status).toBe(409);
    await db.query(`UPDATE orders SET expires_at = now() - interval '1 second'`);
    expect((await patch(table.id, { number: 70 })).status).toBe(200);
  });

  it('404 pour une table inconnue ; journal de la modification', async () => {
    expect((await patch(999, { number: 5 })).status).toBe(404);
    const table = await createOk(real(7));
    await patch(table.id, { number: 8 });
    const { rows } = await db.query<{
      details: { from: { number: number }; to: { number: number } };
    }>(`SELECT details FROM audit_log WHERE action = 'table.updated'`);
    expect(rows[0]?.details.from.number).toBe(7);
    expect(rows[0]?.details.to.number).toBe(8);
  });
});

describe('POST /admin/tables/:id/rotate-token', () => {
  const rotate = (id: number) =>
    api.post(`/api/admin/tables/${String(id)}/rotate-token`).set(auth(manager.token));

  it('donne un nouveau jeton : l’ancien QR ne marche plus', async () => {
    const table = await createOk(real(7));
    const res = await rotate(table.id);
    expect(res.status).toBe(200);
    const { tableToken } = res.body as { tableToken: string };
    expect(tableToken).not.toBe(table.tableToken);
    expect((await api.get(`/api/tables/${String(table.tableToken)}`)).status).toBe(404);
    expect((await api.get(`/api/tables/${tableToken}`)).status).toBe(200);

    const { rows } = await db.query(`SELECT action FROM audit_log WHERE action LIKE 'table.%'`);
    expect(rows).toContainEqual({ action: 'table.token_rotated' });
  });

  it('409 pour une table fictive, 404 pour une table inconnue', async () => {
    const table = await createOk({ number: 333, kind: 'virtual' });
    const res = await rotate(table.id);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: { code: 'INVALID_STATUS' } });
    expect((await rotate(999)).status).toBe(404);
  });
});
