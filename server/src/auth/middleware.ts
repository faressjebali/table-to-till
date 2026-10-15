import type { RequestHandler, Response } from 'express';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { HttpError } from '../errors.js';
import { findSession, type AuthContext, type Role } from './sessions.js';

type Options = {
  // Rôles autorisés ; absent = tout le staff.
  roles?: readonly Role[];
  // Seuls change-password et logout restent accessibles avant le premier changement de mot de passe.
  allowMustChangePassword?: boolean;
};

// Vérifie `Authorization: Bearer <token>` (docs/api.md § Authentification).
export function requireStaff(db: Db, config: Config, options: Options = {}): RequestHandler {
  return async (req, res, next) => {
    const match = /^Bearer (\S+)$/.exec(req.get('Authorization') ?? '');
    const token = match?.[1];
    if (!token) throw new HttpError(401, 'UNAUTHORIZED', 'Missing token');

    const found = await findSession(db, token, config.sessionDays);
    if (found.status === 'invalid') throw new HttpError(401, 'UNAUTHORIZED', 'Invalid token');
    if (found.status === 'disabled') {
      throw new HttpError(403, 'ACCOUNT_DISABLED', 'Account disabled');
    }

    const { user } = found.auth;
    if (user.mustChangePassword && !options.allowMustChangePassword) {
      throw new HttpError(401, 'PASSWORD_CHANGE_REQUIRED', 'Password change required');
    }
    if (options.roles && !options.roles.includes(user.role)) {
      throw new HttpError(403, 'FORBIDDEN', 'Forbidden');
    }
    res.locals['auth'] = found.auth;
    next();
  };
}

// À appeler seulement derrière requireStaff.
export function getAuth(res: Response): AuthContext {
  return res.locals['auth'] as AuthContext;
}
