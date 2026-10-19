import express, { type ErrorRequestHandler } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth/passwords.js';
import type { Role } from '../src/auth/sessions.js';
import { loadConfig, type Config } from '../src/config.js';
import { createPool, type Db } from '../src/db.js';
import { errorBody, HttpError } from '../src/errors.js';
import { noopRealtime as realtime } from '../src/realtime.js';
import { endForgottenShifts } from '../src/shifts/auto-end.js';
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

async function endShift(token: string) {
  return api.post('/api/shifts/end').set('Authorization', `Bearer ${token}`);
}

type ShiftBody = { shiftId: number; startedAt: string; principal: boolean };
type CurrentBody = {
  waiters: { id: number; name: string; startedAt: string; principal: boolean }[];
  stations: { id: number; name: string; role: string; startedAt: string }[];
};

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
      principal: true,
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
    expect(me.body).toMatchObject({ onShift: true, principal: true });
  });

  it('le premier arrivé est principal, les suivants renforts ; un nouveau principal après son départ', async () => {
    await createUser('ali');
    await createUser('sami');
    await createUser('mehdi');
    const ali = await tokenFor('ali');
    const sami = await tokenFor('sami');

    expect((await startShift(ali)).body).toMatchObject({ principal: true });
    expect((await startShift(sami)).body).toMatchObject({ principal: false });
    const me = await api.get('/api/me').set('Authorization', `Bearer ${sami}`);
    expect(me.body).toMatchObject({ onShift: true, principal: false });

    // Double tap du renfort : il reste renfort.
    expect((await startShift(sami)).body).toMatchObject({ principal: false });

    // Shift d'Ali terminé (la passation arrive plus tard) : le prochain arrivé est principal.
    await db.query(`UPDATE shifts SET ended_at = now() WHERE principal`);
    expect((await startShift(await tokenFor('mehdi'))).body).toMatchObject({ principal: true });
  });

  it('un seul principal quand deux serveurs démarrent en même temps', async () => {
    await createUser('ali');
    await createUser('sami');
    const tokens = [await tokenFor('ali'), await tokenFor('sami')];
    const results = await Promise.all(tokens.map((t) => startShift(t)));
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    const principals = results.filter((r) => (r.body as ShiftBody).principal);
    expect(principals).toHaveLength(1);
  });

  it('/me : un compte hors shift n’est pas principal', async () => {
    await createUser('sami');
    const token = await tokenFor('sami');
    const me = await api.get('/api/me').set('Authorization', `Bearer ${token}`);
    expect(me.body).toMatchObject({ onShift: false, principal: false });
  });

  it('ouvre un shift pour le barista et le cuisinier, jamais principal', async () => {
    for (const role of ['barista', 'chef'] as const) {
      await createUser(role, role);
      const token = await tokenFor(role);
      const res = await startShift(token);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ principal: false });
      expect((await startShift(token)).status).toBe(200);
      const me = await api.get('/api/me').set('Authorization', `Bearer ${token}`);
      expect(me.body).toMatchObject({ onShift: true, principal: false });
    }

    // Arrivés avant le serveur : le premier serveur reste principal.
    await createUser('sami');
    expect((await startShift(await tokenFor('sami'))).body).toMatchObject({ principal: true });
  });

  it('refuse la manager et les appels sans token', async () => {
    await createUser('gerante', 'manager');
    const res = await startShift(await tokenFor('gerante'));
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: { code: 'FORBIDDEN' } });
    const anonymous = await api.post('/api/shifts/start');
    expect(anonymous.status).toBe(401);
    expect(anonymous.body).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
  });
});

describe('POST /shifts/end', () => {
  it('termine le shift du barista et du cuisinier, sans clôture', async () => {
    for (const role of ['barista', 'chef'] as const) {
      const id = await createUser(role, role);
      const token = await tokenFor(role);
      const { shiftId } = (await startShift(token)).body as ShiftBody;

      const res = await endShift(token);
      expect(res.status).toBe(204);
      const me = await api.get('/api/me').set('Authorization', `Bearer ${token}`);
      expect(me.body).toMatchObject({ onShift: false });
      const audit = await db.query<{ action: string; user_id: number }>(
        `SELECT action, user_id FROM audit_log WHERE action = 'shift.ended' AND entity_id = $1`,
        [shiftId],
      );
      expect(audit.rows).toEqual([{ action: 'shift.ended', user_id: id }]);

      // Déjà terminé : hors shift.
      const again = await endShift(token);
      expect(again.status).toBe(403);
      expect(again.body).toMatchObject({ error: { code: 'NOT_ON_SHIFT' } });

      // Il peut redémarrer : un nouveau shift.
      expect((await startShift(token)).status).toBe(201);
    }
  });

  it('termine le shift d’un renfort ; le principal, lui, clôture', async () => {
    await createUser('amira');
    const sami = await createUser('sami');
    const amira = await tokenFor('amira');
    const samiToken = await tokenFor('sami');
    expect(((await startShift(amira)).body as ShiftBody).principal).toBe(true);
    const { shiftId, principal } = (await startShift(samiToken)).body as ShiftBody;
    expect(principal).toBe(false);

    expect((await endShift(samiToken)).status).toBe(204);
    const me = await api.get('/api/me').set('Authorization', `Bearer ${samiToken}`);
    expect(me.body).toMatchObject({ onShift: false });
    const audit = await db.query<{ user_id: number }>(
      `SELECT user_id FROM audit_log WHERE action = 'shift.ended' AND entity_id = $1`,
      [shiftId],
    );
    expect(audit.rows).toEqual([{ user_id: sami }]);

    // Le principal reste en shift : sa fin de shift passe par la clôture.
    const res = await endShift(amira);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: { code: 'INVALID_STATUS' } });
    const current = await api.get('/api/shifts/current').set('Authorization', `Bearer ${amira}`);
    expect((current.body as CurrentBody).waiters).toHaveLength(1);
  });

  it('refuse la manager', async () => {
    await createUser('gerante', 'manager');
    const res = await endShift(await tokenFor('gerante'));
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: { code: 'FORBIDDEN' } });
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
      principal: false,
    });
    // Amira est arrivée la première : c'est elle la principale.
    expect(body.waiters[1]).toMatchObject({ id: amira, principal: true });
    // Le cuisinier n'est pas en shift : personne en cuisine.
    expect(body.stations).toEqual([]);
  });

  it('liste les baristas et cuisiniers en shift dans stations, pas dans waiters', async () => {
    const barista = await createUser('nour', 'barista');
    const chef = await createUser('hedi', 'chef');
    await createUser('absent', 'chef');
    await createUser('sami');
    await startShift(await tokenFor('nour'));
    await startShift(await tokenFor('hedi'));
    const sami = await tokenFor('sami');
    await startShift(sami);

    const res = await api.get('/api/shifts/current').set('Authorization', `Bearer ${sami}`);
    const body = res.body as CurrentBody;
    expect(body.waiters).toHaveLength(1);
    expect(body.stations).toEqual([
      { id: barista, name: 'Nom nour', role: 'barista', startedAt: expect.any(String) as string },
      { id: chef, name: 'Nom hedi', role: 'chef', startedAt: expect.any(String) as string },
    ]);
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

describe('fin automatique des shifts oubliés', () => {
  // Heure de Tunis (UTC+1).
  const at = (local: string) => new Date(`${local}+01:00`);

  async function shiftStartedAt(login: string, role: Role, startedAt: Date): Promise<number> {
    const userId = await createUser(login, role);
    const { rows } = await db.query<{ id: number }>(
      `INSERT INTO shifts (user_id, started_at) VALUES ($1, $2) RETURNING id`,
      [userId, startedAt],
    );
    const row = rows[0];
    if (!row) throw new Error('aucun shift créé');
    return row.id;
  }

  const endedAt = async (id: number) =>
    (await db.query<{ ended_at: Date | null }>('SELECT ended_at FROM shifts WHERE id = $1', [id]))
      .rows[0]?.ended_at ?? null;

  it('termine à 4h00 les shifts du barista et du cuisinier démarrés avant', async () => {
    const barista = await shiftStartedAt('nour', 'barista', at('2026-10-19T08:00:00'));
    const chef = await shiftStartedAt('hedi', 'chef', at('2026-10-19T23:30:00'));
    // Serveur : avec la clôture automatique.
    const waiter = await shiftStartedAt('sami', 'waiter', at('2026-10-19T08:00:00'));

    // 3h59 : pas encore.
    expect(await endForgottenShifts(db, realtime, at('2026-10-20T03:59:00'), '04:00')).toEqual([]);

    const ended = await endForgottenShifts(db, realtime, at('2026-10-20T04:00:00'), '04:00');
    expect(ended.sort()).toEqual([barista, chef].sort());
    expect(await endedAt(barista)).toEqual(at('2026-10-20T04:00:00'));
    expect(await endedAt(chef)).toEqual(at('2026-10-20T04:00:00'));
    expect(await endedAt(waiter)).toBeNull();

    const audit = await db.query<{ user_id: number | null }>(
      `SELECT user_id FROM audit_log WHERE action = 'shift.auto_ended'`,
    );
    expect(audit.rows).toEqual([{ user_id: null }, { user_id: null }]);
  });

  it('ne touche pas un shift démarré après 4h00, rattrape un passage manqué', async () => {
    const morning = await shiftStartedAt('nour', 'barista', at('2026-10-20T07:50:00'));
    const forgotten = await shiftStartedAt('hedi', 'chef', at('2026-10-19T09:00:00'));

    // Serveur redémarré à 9h : le shift oublié se termine quand même à 4h00.
    const ended = await endForgottenShifts(db, realtime, at('2026-10-20T09:00:00'), '04:00');
    expect(ended).toEqual([forgotten]);
    expect(await endedAt(forgotten)).toEqual(at('2026-10-20T04:00:00'));
    expect(await endedAt(morning)).toBeNull();

    // Deuxième passage : plus rien.
    expect(await endForgottenShifts(db, realtime, at('2026-10-20T09:01:00'), '04:00')).toEqual([]);
  });
});
