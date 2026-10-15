import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureFirstManager } from '../src/auth/bootstrap.js';
import { hashPassword } from '../src/auth/passwords.js';
import { loadConfig, type Config } from '../src/config.js';
import { createPool, type Db } from '../src/db.js';
import { resetTestDatabase, testUrl } from './helpers/db.js';

const PASSWORD = 'bonjour123';
const baseConfig: Config = {
  ...loadConfig(),
  sessionDays: 30,
  loginLockMinutes: 5,
  loginRateLimitPerMinute: 1000,
  firstManagerLogin: '',
  firstManagerTempPassword: '',
};

let db: Db;

beforeAll(async () => {
  await resetTestDatabase();
  db = createPool(testUrl);
});

afterAll(async () => {
  await db.end();
});

beforeEach(async () => {
  await db.query('TRUNCATE users, audit_log RESTART IDENTITY CASCADE');
});

// Une app neuve par appel : la limite par IP repart de zéro.
function app(config: Partial<Config> = {}) {
  return createApp({ db, config: { ...baseConfig, ...config } });
}

async function createUser(
  login: string,
  { role = 'waiter', mustChangePassword = false, password = PASSWORD } = {},
): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO users (login, name, password_hash, role, must_change_password)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [login, `Nom ${login}`, await hashPassword(password), role, mustChangePassword],
  );
  const row = rows[0];
  if (!row) throw new Error('aucun utilisateur créé');
  return row.id;
}

async function login(loginName: string, password = PASSWORD) {
  return request(app()).post('/api/auth/login').send({ login: loginName, password });
}

async function tokenFor(loginName: string): Promise<string> {
  const res = await login(loginName);
  expect(res.status).toBe(200);
  return (res.body as { token: string }).token;
}

async function auditActions(): Promise<string[]> {
  const { rows } = await db.query<{ action: string }>('SELECT action FROM audit_log ORDER BY id');
  return rows.map((r) => r.action);
}

describe('POST /auth/login', () => {
  it('renvoie un token et l’utilisateur, sans tenir compte des majuscules de l’identifiant', async () => {
    const id = await createUser('sami');
    const res = await login('SAMI');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      token: expect.any(String) as unknown,
      user: { id, name: 'Nom sami', role: 'waiter', mustChangePassword: false },
    });
    expect(await auditActions()).toEqual(['auth.login']);
  });

  it('crée une session de 30 jours', async () => {
    await createUser('sami');
    await tokenFor('sami');
    const { rows } = await db.query<{ days: number }>(
      `SELECT round(extract(epoch FROM expires_at - now()) / 86400)::int AS days FROM sessions`,
    );
    expect(rows[0]?.days).toBe(30);
  });

  it('répond pareil à un mauvais mot de passe et à un identifiant inconnu', async () => {
    await createUser('sami');
    const wrong = await login('sami', 'mauvais-mdp');
    const unknown = await login('inconnu');
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.body).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
  });

  it('refuse un corps invalide avec la liste des champs', async () => {
    const res = await request(app()).post('/api/auth/login').send({ login: '' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    const fields = (res.body as { error: { details: { fields: { field: string }[] } } }).error
      .details.fields;
    expect(fields.map((f) => f.field).sort()).toEqual(['login', 'password']);
  });

  it('bloque le compte au 5ᵉ échec, même avec le bon mot de passe, puis le débloque', async () => {
    const id = await createUser('sami');
    for (let i = 0; i < 4; i++) expect((await login('sami', 'mauvais-mdp')).status).toBe(401);
    const fifth = await login('sami', 'mauvais-mdp');
    expect(fifth.status).toBe(423);
    expect(fifth.body).toMatchObject({ error: { code: 'ACCOUNT_LOCKED' } });
    expect((await login('sami')).status).toBe(423);

    const { rows } = await db.query<{ minutes: number }>(
      `SELECT round(extract(epoch FROM locked_until - now()) / 60)::int AS minutes FROM users`,
    );
    expect(rows[0]?.minutes).toBe(5);
    expect(await auditActions()).toEqual(['auth.locked']);

    // Fin du blocage
    await db.query(`UPDATE users SET locked_until = now() - interval '1 second' WHERE id = $1`, [
      id,
    ]);
    expect((await login('sami')).status).toBe(200);
  });

  it('remet le compteur d’échecs à zéro après une connexion réussie', async () => {
    await createUser('sami');
    for (let i = 0; i < 4; i++) await login('sami', 'mauvais-mdp');
    expect((await login('sami')).status).toBe(200);
    for (let i = 0; i < 4; i++) expect((await login('sami', 'mauvais-mdp')).status).toBe(401);
  });

  it('refuse un compte désactivé seulement si le mot de passe est bon', async () => {
    await createUser('sami');
    await db.query(`UPDATE users SET disabled_at = now()`);
    expect((await login('sami', 'mauvais-mdp')).status).toBe(401);
    const res = await login('sami');
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: { code: 'ACCOUNT_DISABLED' } });
  });

  it('limite les essais par adresse IP', async () => {
    const limited = app({ loginRateLimitPerMinute: 3 });
    for (let i = 0; i < 3; i++) {
      const res = await request(limited)
        .post('/api/auth/login')
        .send({ login: 'x', password: 'y' });
      expect(res.status).toBe(401);
    }
    const res = await request(limited).post('/api/auth/login').send({ login: 'x', password: 'y' });
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({
      error: {
        code: 'TOO_MANY_REQUESTS',
        details: { retryAfterSeconds: expect.any(Number) as unknown },
      },
    });
  });
});

describe('GET /me et vérification du token', () => {
  it('renvoie l’utilisateur et son état de shift', async () => {
    const id = await createUser('sami');
    const token = await tokenFor('sami');
    const me = () => request(app()).get('/api/me').set('Authorization', `Bearer ${token}`);

    expect((await me()).body).toEqual({
      id,
      name: 'Nom sami',
      role: 'waiter',
      onShift: false,
      principal: false,
    });
    await db.query(`INSERT INTO shifts (user_id) VALUES ($1)`, [id]);
    expect((await me()).body).toMatchObject({ onShift: true });
  });

  it('refuse un token absent, inconnu, expiré ou révoqué', async () => {
    await createUser('sami');
    const token = await tokenFor('sami');
    const me = (header?: string) => {
      const req = request(app()).get('/api/me');
      return header ? req.set('Authorization', header) : req;
    };

    for (const header of [undefined, 'Bearer inconnu', token]) {
      if (header === token) await db.query(`UPDATE sessions SET expires_at = now()`);
      const res = await me(header);
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
    }

    await db.query(`UPDATE sessions SET expires_at = now() + interval '1 day', revoked_at = now()`);
    expect((await me(`Bearer ${token}`)).status).toBe(401);
  });

  it('refuse un compte désactivé après connexion', async () => {
    await createUser('sami');
    const token = await tokenFor('sami');
    await db.query(`UPDATE users SET disabled_at = now()`);
    const res = await request(app()).get('/api/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: { code: 'ACCOUNT_DISABLED' } });
  });

  it('exige le changement de mot de passe avant toute autre route', async () => {
    await createUser('sami', { mustChangePassword: true });
    const token = await tokenFor('sami');
    const res = await request(app()).get('/api/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: { code: 'PASSWORD_CHANGE_REQUIRED' } });
  });

  it('prolonge la session à l’utilisation, au plus une fois par jour', async () => {
    await createUser('sami');
    const token = await tokenFor('sami');
    const me = () => request(app()).get('/api/me').set('Authorization', `Bearer ${token}`);
    const daysLeft = async () => {
      const { rows } = await db.query<{ days: number }>(
        `SELECT round(extract(epoch FROM expires_at - now()) / 86400)::int AS days FROM sessions`,
      );
      return rows[0]?.days;
    };

    // Vue il y a moins d'un jour : pas d'écriture.
    await db.query(
      `UPDATE sessions SET expires_at = now() + interval '10 days', last_seen_at = now() - interval '1 hour'`,
    );
    await me();
    expect(await daysLeft()).toBe(10);

    // Vue il y a plus d'un jour : 30 jours à partir de maintenant.
    await db.query(`UPDATE sessions SET last_seen_at = now() - interval '25 hours'`);
    await me();
    expect(await daysLeft()).toBe(30);
  });
});

describe('POST /auth/change-password', () => {
  async function changePassword(token: string, body: object) {
    return request(app())
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  it('change le mot de passe à la première connexion et coupe les autres sessions', async () => {
    await createUser('sami', { mustChangePassword: true });
    const other = await tokenFor('sami');
    const token = await tokenFor('sami');

    const res = await changePassword(token, {
      currentPassword: PASSWORD,
      newPassword: 'nouveau-mdp',
    });
    expect(res.status).toBe(204);

    const me = (t: string) => request(app()).get('/api/me').set('Authorization', `Bearer ${t}`);
    expect((await me(token)).status).toBe(200);
    expect((await me(other)).status).toBe(401);
    expect((await login('sami')).status).toBe(401);
    const relogin = await login('sami', 'nouveau-mdp');
    expect(relogin.body).toMatchObject({ user: { mustChangePassword: false } });
    expect(await auditActions()).toContain('auth.password_changed');
  });

  it('refuse un mot de passe actuel faux, sans couper la session', async () => {
    await createUser('sami');
    const token = await tokenFor('sami');
    const res = await changePassword(token, {
      currentPassword: 'faux-mdp',
      newPassword: 'nouveau-mdp',
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: { code: 'VALIDATION_ERROR', details: { fields: [{ field: 'currentPassword' }] } },
    });
  });

  it('refuse un nouveau mot de passe trop court, identique à l’actuel ou à l’identifiant', async () => {
    await createUser('samirebah');
    const token = await tokenFor('samirebah');
    for (const newPassword of ['court', PASSWORD, 'SamiRebah']) {
      const res = await changePassword(token, { currentPassword: PASSWORD, newPassword });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        error: { code: 'VALIDATION_ERROR', details: { fields: [{ field: 'newPassword' }] } },
      });
    }
  });

  it('refuse sans token', async () => {
    const res = await request(app())
      .post('/api/auth/change-password')
      .send({ currentPassword: PASSWORD, newPassword: 'nouveau-mdp' });
    expect(res.status).toBe(401);
  });
});

describe('POST /auth/logout', () => {
  it('coupe la session, même avant le changement de mot de passe', async () => {
    await createUser('sami', { mustChangePassword: true });
    const token = await tokenFor('sami');
    const logout = () =>
      request(app()).post('/api/auth/logout').set('Authorization', `Bearer ${token}`);
    expect((await logout()).status).toBe(204);
    expect((await logout()).status).toBe(401);
    expect(await auditActions()).toEqual(['auth.login', 'auth.logout']);
  });
});

describe('premier compte manager', () => {
  const config = {
    ...baseConfig,
    firstManagerLogin: 'manager',
    firstManagerTempPassword: 'temporaire',
  };

  it('est créé depuis .env, avec changement de mot de passe obligatoire', async () => {
    expect(await ensureFirstManager(db, config)).toBe('created');
    const res = await login('manager', 'temporaire');
    expect(res.body).toMatchObject({ user: { role: 'manager', mustChangePassword: true } });
    expect(await ensureFirstManager(db, config)).toBe('skipped');
  });

  it('n’est pas créé s’il existe déjà un manager, ou sans réglage', async () => {
    expect(await ensureFirstManager(db, baseConfig)).toBe('skipped');
    await createUser('gerante', { role: 'manager' });
    expect(await ensureFirstManager(db, config)).toBe('skipped');
    const { rowCount } = await db.query(`SELECT 1 FROM users`);
    expect(rowCount).toBe(1);
  });
});
