import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth/passwords.js';
import { loadConfig, type Config } from '../src/config.js';
import { createPool, type Db } from '../src/db.js';
import { resetTestDatabase, testUrl } from './helpers/db.js';

const PASSWORD = 'bonjour123';
const config: Config = {
  ...loadConfig(),
  sessionDays: 30,
  loginLockMinutes: 5,
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

type UserBody = { id: number; login: string; role: string; active: boolean; locked: boolean };

async function createUser(login: string, role = 'waiter'): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO users (login, name, password_hash, role, must_change_password)
     VALUES ($1, $2, $3, $4, false) RETURNING id`,
    [login, `Nom ${login}`, await hashPassword(PASSWORD), role],
  );
  const row = rows[0];
  if (!row) throw new Error('aucun utilisateur créé');
  return row.id;
}

async function tokenFor(login: string, password = PASSWORD): Promise<string> {
  const res = await api.post('/api/auth/login').send({ login, password });
  expect(res.status).toBe(200);
  return (res.body as { token: string }).token;
}

async function managerToken(): Promise<{ id: number; token: string }> {
  const id = await createUser('gerante', 'manager');
  return { id, token: await tokenFor('gerante') };
}

async function auditActions(): Promise<string[]> {
  const { rows } = await db.query<{ action: string }>(
    `SELECT action FROM audit_log WHERE action LIKE 'user.%' ORDER BY id`,
  );
  return rows.map((r) => r.action);
}

describe('rôles', () => {
  it('refuse les comptes non manager et les appels sans token', async () => {
    await createUser('sami', 'waiter');
    const token = await tokenFor('sami');
    const forbidden = await api.get('/api/users').set('Authorization', `Bearer ${token}`);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body).toMatchObject({ error: { code: 'FORBIDDEN' } });

    const created = await api
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'X', login: 'x', role: 'waiter' });
    expect(created.status).toBe(403);

    expect((await api.get('/api/users')).status).toBe(401);
  });
});

describe('GET /users', () => {
  it('liste tous les comptes, sans mot de passe', async () => {
    const { id, token } = await managerToken();
    const sami = await createUser('sami', 'chef');
    const res = await api.get('/api/users').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const users = (res.body as { users: Record<string, unknown>[] }).users;
    expect(users).toHaveLength(2);
    expect(users.find((u) => u['id'] === id)).toEqual({
      id,
      name: 'Nom gerante',
      login: 'gerante',
      role: 'manager',
      title: null,
      active: true,
      mustChangePassword: false,
      locked: false,
      lastLoginAt: expect.any(String) as unknown,
      createdAt: expect.any(String) as unknown,
    });
    expect(users.find((u) => u['id'] === sami)).toMatchObject({ lastLoginAt: null });
    expect(JSON.stringify(res.body)).not.toContain('password_hash');
  });
});

describe('POST /users', () => {
  it('crée un compte avec un mot de passe temporaire à changer à la connexion', async () => {
    const { token } = await managerToken();
    const res = await api
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Amira', login: 'amira', role: 'barista' });
    expect(res.status).toBe(201);
    const body = res.body as { user: UserBody; temporaryPassword: string };
    expect(body.user).toMatchObject({
      name: 'Amira',
      login: 'amira',
      role: 'barista',
      active: true,
      mustChangePassword: true,
      lastLoginAt: null,
    });
    expect(body.temporaryPassword).toMatch(/^[a-hjkmnp-z2-9]{10}$/);

    const login = await api
      .post('/api/auth/login')
      .send({ login: 'amira', password: body.temporaryPassword });
    expect(login.body).toMatchObject({ user: { mustChangePassword: true } });
    expect(await auditActions()).toEqual(['user.created']);
  });

  it('crée un comptable avec un titre, sans espaces autour ; titre vide = aucun', async () => {
    const { token } = await managerToken();
    const res = await api
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Mounir', login: 'mounir', role: 'accountant', title: '  Comptable ' });
    expect(res.status).toBe(201);
    expect((res.body as { user: unknown }).user).toMatchObject({
      role: 'accountant',
      title: 'Comptable',
    });

    for (const [login, title] of [
      ['nour', ''],
      ['hedi', null],
      ['sami', undefined],
    ] as const) {
      const other = await api
        .post('/api/users')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: login, login, role: 'waiter', title });
      expect(other.status).toBe(201);
      expect((other.body as { user: unknown }).user).toMatchObject({ title: null });
    }
  });

  it('refuse un identifiant déjà pris, sans tenir compte des majuscules', async () => {
    const { token } = await managerToken();
    await createUser('amira');
    const res = await api
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Amira', login: 'AMIRA', role: 'waiter' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: { code: 'VALIDATION_ERROR', details: { fields: [{ field: 'login' }] } },
    });
  });

  it('refuse un corps invalide et le rôle owner', async () => {
    const { token } = await managerToken();
    const res = await api
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '', login: 'x', role: 'owner' });
    expect(res.status).toBe(400);
    const fields = (res.body as { error: { details: { fields: { field: string }[] } } }).error
      .details.fields;
    expect(fields.map((f) => f.field).sort()).toEqual(['name', 'role']);
  });
});

describe('PATCH /users/:id', () => {
  it('change le rôle', async () => {
    const { token } = await managerToken();
    const id = await createUser('sami');
    const res = await api
      .patch(`/api/users/${String(id)}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'chef' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id, role: 'chef', active: true });
    expect(await auditActions()).toEqual(['user.role_changed']);
  });

  it('change le titre seul, puis l’efface (chaîne vide ou null)', async () => {
    const { token } = await managerToken();
    const id = await createUser('rania', 'manager');
    const patch = (body: object) =>
      api
        .patch(`/api/users/${String(id)}`)
        .set('Authorization', `Bearer ${token}`)
        .send(body);

    const set = await patch({ title: ' Patronne ' });
    expect(set.status).toBe(200);
    expect(set.body).toMatchObject({ role: 'manager', title: 'Patronne' });
    expect((await patch({ title: 'Patronne' })).status).toBe(200);
    expect((await patch({ title: '' })).body).toMatchObject({ title: null });
    expect((await patch({ title: 'Patronne' })).body).toMatchObject({ title: 'Patronne' });
    expect((await patch({ title: null })).body).toMatchObject({ title: null });

    // Un titre identique n'écrit rien au journal.
    expect(await auditActions()).toEqual([
      'user.title_changed',
      'user.title_changed',
      'user.title_changed',
      'user.title_changed',
    ]);
    const { rows } = await db.query<{ details: unknown }>(
      `SELECT details FROM audit_log WHERE action = 'user.title_changed' ORDER BY id LIMIT 1`,
    );
    expect(rows[0]?.details).toEqual({ from: null, to: 'Patronne' });
  });

  it('passe un compte en comptable, et un comptable en serveur', async () => {
    const { token } = await managerToken();
    const id = await createUser('mounir', 'manager');
    const patch = (body: object) =>
      api
        .patch(`/api/users/${String(id)}`)
        .set('Authorization', `Bearer ${token}`)
        .send(body);
    expect((await patch({ role: 'accountant' })).body).toMatchObject({ role: 'accountant' });
    expect((await patch({ role: 'waiter' })).body).toMatchObject({ role: 'waiter' });
  });

  it('désactive un compte et coupe ses sessions, puis le réactive', async () => {
    const { token } = await managerToken();
    const id = await createUser('sami');
    const samiToken = await tokenFor('sami');

    const off = await api
      .patch(`/api/users/${String(id)}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ active: false });
    expect(off.body).toMatchObject({ active: false });
    const { rows } = await db.query(
      `SELECT 1 FROM sessions WHERE user_id = $1 AND revoked_at IS NULL`,
      [id],
    );
    expect(rows).toHaveLength(0);
    const me = await api.get('/api/me').set('Authorization', `Bearer ${samiToken}`);
    expect(me.status).toBe(401);

    const on = await api
      .patch(`/api/users/${String(id)}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ active: true });
    expect(on.body).toMatchObject({ active: true });
    await tokenFor('sami');
    expect(await auditActions()).toEqual(['user.disabled', 'user.enabled']);
  });

  it('refuse de se désactiver soi-même ou de retirer son propre rôle manager', async () => {
    const { id, token } = await managerToken();
    await createUser('autre', 'manager');
    for (const body of [{ active: false }, { role: 'waiter' }]) {
      const res = await api
        .patch(`/api/users/${String(id)}`)
        .set('Authorization', `Bearer ${token}`)
        .send(body);
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ error: { code: 'INVALID_STATUS' } });
    }
    expect(await auditActions()).toEqual([]);
  });

  it('refuse de changer le rôle ou de désactiver un serveur en shift, puis l’accepte après son shift', async () => {
    const { token } = await managerToken();
    const id = await createUser('sami');
    await db.query(`INSERT INTO shifts (user_id, principal) VALUES ($1, true)`, [id]);
    for (const body of [{ role: 'barista' }, { active: false }]) {
      const res = await api
        .patch(`/api/users/${String(id)}`)
        .set('Authorization', `Bearer ${token}`)
        .send(body);
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ error: { code: 'INVALID_STATUS' } });
    }
    expect(await auditActions()).toEqual([]);

    await db.query(`UPDATE shifts SET ended_at = now() WHERE user_id = $1`, [id]);
    const res = await api
      .patch(`/api/users/${String(id)}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'barista' });
    expect(res.status).toBe(200);
  });

  it('un comptable ne compte pas comme manager : le dernier manager ne peut pas passer comptable', async () => {
    const { id, token } = await managerToken();
    await createUser('mounir', 'accountant');
    const res = await api
      .patch(`/api/users/${String(id)}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'accountant' });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: { code: 'INVALID_STATUS' } });
    const { rows } = await db.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM users WHERE role = 'manager' AND disabled_at IS NULL`,
    );
    expect(rows[0]?.count).toBe(1);
  });

  it('laisse désactiver un autre manager tant qu’il en reste un actif', async () => {
    const { token } = await managerToken();
    const autre = await createUser('autre', 'manager');
    const res = await api
      .patch(`/api/users/${String(autre)}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ active: false });
    expect(res.status).toBe(200);
  });

  it('refuse un corps vide ou inconnu, et un compte inconnu', async () => {
    const { token } = await managerToken();
    const id = await createUser('sami');
    for (const body of [{}, { name: 'x' }, { active: 'non' }]) {
      const res = await api
        .patch(`/api/users/${String(id)}`)
        .set('Authorization', `Bearer ${token}`)
        .send(body);
      expect(res.status).toBe(400);
    }
    for (const path of ['/api/users/999', '/api/users/abc']) {
      const res = await api
        .patch(path)
        .set('Authorization', `Bearer ${token}`)
        .send({ active: false });
      expect(res.status).toBe(404);
    }
  });
});

describe('POST /users/:id/reset-password', () => {
  it('donne un nouveau mot de passe temporaire, débloque le compte et coupe ses sessions', async () => {
    const { token } = await managerToken();
    const id = await createUser('sami');
    const samiToken = await tokenFor('sami');
    await db.query(
      `UPDATE users SET failed_logins = 3, locked_until = now() + interval '5 minutes'
        WHERE id = $1`,
      [id],
    );

    const res = await api
      .post(`/api/users/${String(id)}/reset-password`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const body = res.body as { user: UserBody; temporaryPassword: string };
    expect(body.user).toMatchObject({ id, locked: false, mustChangePassword: true });

    expect((await api.get('/api/me').set('Authorization', `Bearer ${samiToken}`)).status).toBe(401);
    const old = await api.post('/api/auth/login').send({ login: 'sami', password: PASSWORD });
    expect(old.status).toBe(401);
    await tokenFor('sami', body.temporaryPassword);

    const { rows } = await db.query<{ failed_logins: number }>(
      `SELECT failed_logins FROM users WHERE id = $1`,
      [id],
    );
    expect(rows[0]?.failed_logins).toBe(0);
    expect(await auditActions()).toEqual(['user.password_reset']);
  });

  it('renvoie NOT_FOUND pour un compte inconnu', async () => {
    const { token } = await managerToken();
    const res = await api
      .post('/api/users/999/reset-password')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
