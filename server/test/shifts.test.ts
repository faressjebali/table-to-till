import express, { type ErrorRequestHandler } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth/passwords.js';
import type { Role } from '../src/auth/sessions.js';
import { loadConfig, type Config } from '../src/config.js';
import { createPool, type Db } from '../src/db.js';
import { errorBody, HttpError } from '../src/errors.js';
import { requireWaiterOnShift, waitersOnShift } from '../src/shifts/on-shift.js';
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
  const res = await api.post('/api/auth/login').send({ login, password: PASSWORD });
  expect(res.status).toBe(200);
  return (res.body as { token: string }).token;
}

async function startShift(token: string) {
  return api.post('/api/shifts/start').set('Authorization', `Bearer ${token}`);
}

type ShiftBody = { shiftId: number; startedAt: string };
type CurrentBody = { waiters: { id: number; name: string; startedAt: string }[] };

describe('POST /shifts/start', () => {
  it('ouvre un shift pour un serveur, une seule fois', async () => {
    const id = await createUser('sami');
    const token = await tokenFor('sami');

    const first = await startShift(token);
    expect(first.status).toBe(201);
    const shift = first.body as ShiftBody;
    expect(shift).toEqual({
      shiftId: expect.any(Number) as number,
      startedAt: expect.any(String) as string,
    });

    // Double tap : le shift déjà ouvert est renvoyé, rien n'est recréé.
    const again = await startShift(token);
    expect(again.status).toBe(200);
    expect(again.body).toEqual(shift);

    const { rows } = await db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM shifts WHERE user_id = $1',
      [id],
    );
    expect(rows[0]?.n).toBe(1);

    const audit = await db.query<{ action: string; entity_id: number }>(
      `SELECT action, entity_id FROM audit_log WHERE action LIKE 'shift.%'`,
    );
    expect(audit.rows).toEqual([{ action: 'shift.started', entity_id: shift.shiftId }]);

    const me = await api.get('/api/me').set('Authorization', `Bearer ${token}`);
    expect(me.body).toMatchObject({ onShift: true });
  });

  it('refuse les autres rôles et les appels sans token', async () => {
    for (const role of ['manager', 'barista', 'chef'] as const) {
      await createUser(role, role);
      const res = await startShift(await tokenFor(role));
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ error: { code: 'FORBIDDEN' } });
    }
    const anonymous = await api.post('/api/shifts/start');
    expect(anonymous.status).toBe(401);
    expect(anonymous.body).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
  });
});

describe('GET /shifts/current', () => {
  it('liste les serveurs en shift, du plus ancien au plus récent, pour tout le staff', async () => {
    const amira = await createUser('amira');
    const sami = await createUser('sami');
    await createUser('nour');
    await createUser('chef', 'chef');
    await startShift(await tokenFor('amira'));
    await startShift(await tokenFor('sami'));
    await db.query(`UPDATE shifts SET started_at = now() - interval '1 hour' WHERE user_id = $1`, [
      sami,
    ]);

    const chefToken = await tokenFor('chef');
    const res = await api.get('/api/shifts/current').set('Authorization', `Bearer ${chefToken}`);
    expect(res.status).toBe(200);
    const body = res.body as CurrentBody;
    expect(body.waiters.map((w) => w.id)).toEqual([sami, amira]);
    expect(body.waiters[0]).toEqual({
      id: sami,
      name: 'Nom sami',
      startedAt: expect.any(String) as string,
    });
  });

  it('ignore les shifts terminés, les comptes désactivés et ceux qui ne sont plus serveurs', async () => {
    const ended = await createUser('ended');
    const disabled = await createUser('disabled');
    const promoted = await createUser('promoted');
    const active = await createUser('active');
    for (const login of ['ended', 'disabled', 'promoted', 'active']) {
      await startShift(await tokenFor(login));
    }
    await db.query('UPDATE shifts SET ended_at = now() WHERE user_id = $1', [ended]);
    await db.query('UPDATE users SET disabled_at = now() WHERE id = $1', [disabled]);
    await db.query(`UPDATE users SET role = 'barista' WHERE id = $1`, [promoted]);

    expect((await waitersOnShift(db)).map((w) => w.id)).toEqual([active]);
    await expect(api.get('/api/shifts/current')).resolves.toMatchObject({ status: 401 });
  });
});

describe('requireWaiterOnShift', () => {
  // Petite app de test : aucune vraie route ne l'utilise encore.
  const onError: ErrorRequestHandler = (err: unknown, _req, res, _next) => {
    if (!(err instanceof HttpError)) throw err;
    res.status(err.status).json(errorBody(err.code, err.message));
  };
  const guarded = () => {
    const app = express();
    app.get('/guarded', ...requireWaiterOnShift(db, config), (_req, res) => {
      res.json({ ok: true });
    });
    app.use(onError);
    return request(app);
  };
  const get = (token: string) => guarded().get('/guarded').set('Authorization', `Bearer ${token}`);

  it('laisse passer un serveur en shift', async () => {
    await createUser('sami');
    const token = await tokenFor('sami');
    await startShift(token);
    const res = await get(token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('refuse un serveur hors shift (NOT_ON_SHIFT) et les autres rôles (FORBIDDEN)', async () => {
    await createUser('sami');
    const offShift = await get(await tokenFor('sami'));
    expect(offShift.status).toBe(403);
    expect(offShift.body).toMatchObject({ error: { code: 'NOT_ON_SHIFT' } });

    await createUser('gerante', 'manager');
    const manager = await get(await tokenFor('gerante'));
    expect(manager.status).toBe(403);
    expect(manager.body).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });
});
