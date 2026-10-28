import { Router } from 'express';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { getAuth, requireStaff } from '../auth/middleware.js';
import { hashPassword } from '../auth/passwords.js';
import { revokeAllSessions, ROLES, type Role } from '../auth/sessions.js';
import type { Config } from '../config.js';
import { audit, type Db } from '../db.js';
import { HttpError, validationError } from '../errors.js';
import type { Realtime } from '../realtime.js';
import { generateTemporaryPassword } from './temporary-password.js';

// Titre affiché (docs/api.md § 2 User) : texte libre ; vide ou absent = aucun (null).
const titleField = z
  .string()
  .trim()
  .nullable()
  .transform((title) => (title === '' ? null : title));

const createBody = z.object({
  name: z.string().trim().min(1).max(100),
  login: z.string().trim().min(1).max(100),
  role: z.enum(ROLES),
  title: titleField.optional(),
});

const patchBody = z
  .object({
    role: z.enum(ROLES).optional(),
    title: titleField.optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine(
    (body) => body.role !== undefined || body.title !== undefined || body.active !== undefined,
    { message: 'Nothing to change' },
  );

type UserRow = {
  id: number;
  name: string;
  login: string;
  role: Role;
  title: string | null;
  active: boolean;
  must_change_password: boolean;
  locked: boolean;
  last_login_at: Date | null;
  created_at: Date;
};

const USER_COLUMNS = `id, name, login, role, title, disabled_at IS NULL AS active, must_change_password,
  coalesce(locked_until > now(), false) AS locked, last_login_at, created_at`;

// Forme User de docs/api.md § 2.
function toUser(row: UserRow) {
  return {
    id: row.id,
    name: row.name,
    login: row.login,
    role: row.role,
    title: row.title,
    active: row.active,
    mustChangePassword: row.must_change_password,
    locked: row.locked,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
  };
}

const loginTaken = () =>
  new HttpError(400, 'VALIDATION_ERROR', 'Login already taken', {
    fields: [{ field: 'login', message: 'Login already taken' }],
  });

const notFound = () => new HttpError(404, 'NOT_FOUND', 'User not found');

function parseId(raw: string | undefined): number {
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) throw notFound();
  return id;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === '23505';
}

async function inTransaction<T>(db: Db, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Routes de docs/api.md § 6 (comptes), réservées à la manager.
export function userRoutes(db: Db, config: Config, realtime: Realtime): Router {
  const router = Router();
  router.use('/users', requireStaff(db, config, { roles: ['manager'] }));

  router.get('/users', async (_req, res) => {
    const { rows } = await db.query<UserRow>(
      `SELECT ${USER_COLUMNS} FROM users ORDER BY lower(name), id`,
    );
    res.json({ users: rows.map(toUser) });
  });

  router.post('/users', async (req, res) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) throw validationError(parsed.error);
    const { name, login, role } = parsed.data;
    const title = parsed.data.title ?? null;
    const { user: me } = getAuth(res);

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    let rows: UserRow[];
    try {
      ({ rows } = await db.query<UserRow>(
        `INSERT INTO users (name, login, role, title, password_hash, must_change_password)
         VALUES ($1, $2, $3, $4, $5, true)
         RETURNING ${USER_COLUMNS}`,
        [name, login, role, title, passwordHash],
      ));
    } catch (err) {
      if (isUniqueViolation(err)) throw loginTaken();
      throw err;
    }
    const created = rows[0];
    if (!created) throw new Error('aucun utilisateur créé');
    await audit(db, {
      userId: me.id,
      action: 'user.created',
      entityType: 'user',
      entityId: created.id,
      details: { role, title },
    });
    res.status(201).json({ user: toUser(created), temporaryPassword });
  });

  router.patch('/users/:id', async (req, res) => {
    const id = parseId(req.params['id']);
    const parsed = patchBody.safeParse(req.body);
    if (!parsed.success) throw validationError(parsed.error);
    const { role, title, active } = parsed.data;
    const { user: me } = getAuth(res);

    const { user: updated, before } = await inTransaction(db, async (client) => {
      // Verrou sur les managers actifs : deux désactivations en même temps
      // ne peuvent pas retirer le dernier manager.
      await client.query(
        `SELECT id FROM users WHERE role = 'manager' AND disabled_at IS NULL FOR UPDATE`,
      );
      const { rows } = await client.query<UserRow>(
        `SELECT ${USER_COLUMNS} FROM users WHERE id = $1 FOR UPDATE`,
        [id],
      );
      const before = rows[0];
      if (!before) throw notFound();

      const newRole = role ?? before.role;
      const newActive = active ?? before.active;
      const newTitle = title === undefined ? before.title : title;
      // Un serveur en shift garde son rôle et son compte jusqu'à la fin de son shift :
      // le principal ne doit pas perdre sa caisse sans clôture.
      if (newRole !== before.role || newActive !== before.active) {
        const { rowCount } = await client.query(
          `SELECT 1 FROM shifts WHERE user_id = $1 AND ended_at IS NULL`,
          [id],
        );
        if (rowCount) {
          throw new HttpError(409, 'INVALID_STATUS', 'This waiter is on shift');
        }
      }
      if (id === me.id && !newActive) {
        throw new HttpError(409, 'INVALID_STATUS', 'You cannot disable your own account');
      }
      if (id === me.id && newRole !== 'manager') {
        throw new HttpError(409, 'INVALID_STATUS', 'You cannot remove your own manager role');
      }
      const losesManager =
        before.role === 'manager' && before.active && (newRole !== 'manager' || !newActive);
      if (losesManager) {
        const { rows: others } = await client.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM users
            WHERE role = 'manager' AND disabled_at IS NULL AND id <> $1`,
          [id],
        );
        if ((others[0]?.count ?? 0) === 0) {
          throw new HttpError(409, 'INVALID_STATUS', 'At least one active manager must remain');
        }
      }

      const { rows: after } = await client.query<UserRow>(
        `UPDATE users SET
            role = $2,
            title = $4,
            disabled_at = CASE WHEN $3 THEN NULL ELSE coalesce(disabled_at, now()) END,
            updated_at = now()
          WHERE id = $1
          RETURNING ${USER_COLUMNS}`,
        [id, newRole, newActive, newTitle],
      );
      const user = after[0];
      if (!user) throw notFound();

      if (newRole !== before.role) {
        await audit(client, {
          userId: me.id,
          action: 'user.role_changed',
          entityType: 'user',
          entityId: id,
          details: { from: before.role, to: newRole },
        });
      }
      if (newTitle !== before.title) {
        await audit(client, {
          userId: me.id,
          action: 'user.title_changed',
          entityType: 'user',
          entityId: id,
          details: { from: before.title, to: newTitle },
        });
      }
      if (newActive !== before.active) {
        // Désactivé : tous ses téléphones sont déconnectés tout de suite.
        if (!newActive) await revokeAllSessions(client, id);
        await audit(client, {
          userId: me.id,
          action: newActive ? 'user.enabled' : 'user.disabled',
          entityType: 'user',
          entityId: id,
        });
      }
      return { user, before };
    });
    // Désactivé : session:revoked puis connexions coupées. Rôle changé : connexions coupées sans
    // événement, la reconnexion donne les événements du nouveau rôle.
    if (before.active && !updated.active) realtime.disconnectUser(id, 'ACCOUNT_DISABLED');
    else if (before.role !== updated.role) realtime.disconnectUser(id);
    res.json(toUser(updated));
  });

  router.post('/users/:id/reset-password', async (req, res) => {
    const id = parseId(req.params['id']);
    const { user: me } = getAuth(res);

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    const user = await inTransaction(db, async (client) => {
      // Débloque aussi le compte (blocage après trop d'essais ratés).
      const { rows } = await client.query<UserRow>(
        `UPDATE users SET password_hash = $2, must_change_password = true,
                failed_logins = 0, locked_until = NULL, updated_at = now()
          WHERE id = $1
          RETURNING ${USER_COLUMNS}`,
        [id, passwordHash],
      );
      const row = rows[0];
      if (!row) throw notFound();
      await revokeAllSessions(client, id);
      await audit(client, {
        userId: me.id,
        action: 'user.password_reset',
        entityType: 'user',
        entityId: id,
      });
      return row;
    });
    // Sans événement : le contrat n'a pas encore de raison pour ce cas.
    realtime.disconnectUser(id);
    res.json({ user: toUser(user), temporaryPassword });
  });

  return router;
}
