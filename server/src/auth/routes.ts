import { Router } from 'express';
import { z } from 'zod';
import type { Config } from '../config.js';
import { audit, type Db } from '../db.js';
import { HttpError, validationError } from '../errors.js';
import { getAuth, requireStaff } from './middleware.js';
import {
  hashPassword,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  verifyDummyPassword,
  verifyPassword,
} from './passwords.js';
import { rateLimitByIp } from './rate-limit.js';
import { createSession, revokeSession, type Role } from './sessions.js';

const loginBody = z.object({
  login: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

const changePasswordBody = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  newPassword: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
});

type UserRow = {
  id: number;
  name: string;
  role: Role;
  password_hash: string;
  must_change_password: boolean;
  disabled: boolean;
  locked: boolean;
};

const lockedError = () =>
  new HttpError(423, 'ACCOUNT_LOCKED', 'Too many failed attempts, try again later');

// Routes de docs/api.md § 4 (Authentification staff).
export function authRoutes(db: Db, config: Config): Router {
  const router = Router();

  router.post(
    '/auth/login',
    rateLimitByIp(config.loginRateLimitPerMinute, 60_000),
    async (req, res) => {
      const parsed = loginBody.safeParse(req.body);
      if (!parsed.success) throw validationError(parsed.error);
      const { login, password } = parsed.data;

      const { rows } = await db.query<UserRow>(
        `SELECT id, name, role, password_hash, must_change_password,
                disabled_at IS NOT NULL AS disabled,
                coalesce(locked_until > now(), false) AS locked
           FROM users WHERE lower(login) = lower($1)`,
        [login],
      );
      const user = rows[0];
      // Identifiant inconnu et mauvais mot de passe : même réponse.
      const badCredentials = new HttpError(401, 'UNAUTHORIZED', 'Invalid login or password');
      if (!user) {
        await verifyDummyPassword(password);
        throw badCredentials;
      }
      if (user.locked) throw lockedError();

      if (!(await verifyPassword(user.password_hash, password))) {
        // Au 5ᵉ échec : blocage temporaire, et le compteur repart de zéro.
        const { rows: updated } = await db.query<{ locked: boolean }>(
          `UPDATE users SET
              locked_until = CASE WHEN failed_logins + 1 >= $2
                                  THEN now() + make_interval(mins => $3) ELSE locked_until END,
              failed_logins = CASE WHEN failed_logins + 1 >= $2 THEN 0 ELSE failed_logins + 1 END
            WHERE id = $1
            RETURNING coalesce(locked_until > now(), false) AS locked`,
          [user.id, config.loginMaxFailures, config.loginLockMinutes],
        );
        if (updated[0]?.locked) {
          await audit(db, {
            userId: null,
            action: 'auth.locked',
            entityType: 'user',
            entityId: user.id,
          });
          throw lockedError();
        }
        throw badCredentials;
      }

      // Bon mot de passe : on peut dire que le compte est désactivé.
      if (user.disabled) throw new HttpError(403, 'ACCOUNT_DISABLED', 'Account disabled');

      await db.query(
        `UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = now()
          WHERE id = $1`,
        [user.id],
      );
      const token = await createSession(db, user.id, config.sessionDays);
      await audit(db, {
        userId: user.id,
        action: 'auth.login',
        entityType: 'user',
        entityId: user.id,
      });
      res.json({
        token,
        user: {
          id: user.id,
          name: user.name,
          role: user.role,
          mustChangePassword: user.must_change_password,
        },
      });
    },
  );

  router.post(
    '/auth/change-password',
    requireStaff(db, config, { allowMustChangePassword: true }),
    async (req, res) => {
      const parsed = changePasswordBody.safeParse(req.body);
      if (!parsed.success) throw validationError(parsed.error);
      const { currentPassword, newPassword } = parsed.data;
      const { user, sessionId } = getAuth(res);

      const fieldError = (field: string, message: string) =>
        new HttpError(400, 'VALIDATION_ERROR', message, { fields: [{ field, message }] });
      // 400 et non 401 : l'app ne doit pas croire que la session est perdue.
      const { rows } = await db.query<{ password_hash: string }>(
        `SELECT password_hash FROM users WHERE id = $1`,
        [user.id],
      );
      const row = rows[0];
      if (!row || !(await verifyPassword(row.password_hash, currentPassword))) {
        throw fieldError('currentPassword', 'Current password is incorrect');
      }
      if (newPassword === currentPassword) {
        throw fieldError('newPassword', 'New password must differ from the current one');
      }
      if (newPassword.toLowerCase() === user.login.toLowerCase()) {
        throw fieldError('newPassword', 'New password must differ from the login');
      }

      await db.query(
        `UPDATE users SET password_hash = $2, must_change_password = false, updated_at = now()
          WHERE id = $1`,
        [user.id, await hashPassword(newPassword)],
      );
      // Les autres téléphones connectés avec l'ancien mot de passe sont déconnectés.
      await db.query(
        `UPDATE sessions SET revoked_at = now()
          WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL`,
        [user.id, sessionId],
      );
      await audit(db, {
        userId: user.id,
        action: 'auth.password_changed',
        entityType: 'user',
        entityId: user.id,
      });
      res.status(204).end();
    },
  );

  router.post(
    '/auth/logout',
    requireStaff(db, config, { allowMustChangePassword: true }),
    async (_req, res) => {
      const { user, sessionId } = getAuth(res);
      await revokeSession(db, sessionId);
      await audit(db, {
        userId: user.id,
        action: 'auth.logout',
        entityType: 'user',
        entityId: user.id,
      });
      res.status(204).end();
    },
  );

  router.get('/me', requireStaff(db, config), async (_req, res) => {
    const { user } = getAuth(res);
    const { rows } = await db.query<{ principal: boolean }>(
      `SELECT principal FROM shifts WHERE user_id = $1 AND ended_at IS NULL`,
      [user.id],
    );
    const shift = rows[0];
    res.json({
      id: user.id,
      name: user.name,
      role: user.role,
      onShift: shift !== undefined,
      // Serveur principal en shift (docs/api.md v1.8) : c'est lui qui gère l'argent.
      principal: shift?.principal ?? false,
    });
  });

  return router;
}
