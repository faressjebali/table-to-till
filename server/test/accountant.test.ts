import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth/passwords.js';
import { loadConfig, type Config } from '../src/config.js';
import { createPool, type Db } from '../src/db.js';
import { resetTestDatabase, testUrl } from './helpers/db.js';

// Rôle comptable (docs/api.md v1.9) : rapports, clôtures et commandes sur sa table d'offre
// (endpoints à venir) ; refusé partout ailleurs.

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
  await db.query('TRUNCATE users, audit_log RESTART IDENTITY CASCADE');
});

async function accountant(): Promise<{ id: number; token: string; login: unknown }> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO users (login, name, password_hash, role, title, must_change_password)
     VALUES ('mounir', 'Mounir', $1, 'accountant', 'Comptable', false) RETURNING id`,
    [await hashPassword(PASSWORD)],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('aucun utilisateur créé');
  const res = await api.post('/api/auth/login').send({ login: 'mounir', password: PASSWORD });
  expect(res.status).toBe(200);
  return { id, token: (res.body as { token: string }).token, login: res.body };
}

describe('comptable', () => {
  it('se connecte : rôle et titre dans la connexion et dans /me', async () => {
    const { id, token, login } = await accountant();
    expect(login).toMatchObject({
      user: { id, name: 'Mounir', role: 'accountant', title: 'Comptable' },
    });

    const me = await api.get('/api/me').set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(me.body).toEqual({
      id,
      name: 'Mounir',
      role: 'accountant',
      title: 'Comptable',
      onShift: false,
      principal: false,
    });
  });

  it('voit qui est en shift (tout le staff)', async () => {
    const { token } = await accountant();
    const res = await api.get('/api/shifts/current').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it.each([
    ['GET', '/api/users'],
    ['POST', '/api/users'],
    ['PATCH', '/api/users/1'],
    ['POST', '/api/users/1/reset-password'],
    ['PATCH', '/api/menu-items/1/availability'],
    ['GET', '/api/tables'],
    ['GET', '/api/tables/1/session'],
    ['GET', '/api/admin/tables'],
    ['POST', '/api/admin/tables'],
    ['POST', '/api/shifts/start'],
    ['GET', '/api/orders?status=pending'],
    ['POST', '/api/staff-orders'],
    ['GET', '/api/station-orders'],
    ['GET', '/api/pos/jobs?status=failed'],
  ])('est refusé (FORBIDDEN) : %s %s', async (method, path) => {
    const { token } = await accountant();
    const call =
      method === 'GET' ? api.get(path) : method === 'POST' ? api.post(path) : api.patch(path);
    const res = await call.set('Authorization', `Bearer ${token}`).send({});
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });
});
