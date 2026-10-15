import type { Config } from '../config.js';
import { audit, type Db } from '../db.js';
import { hashPassword } from './passwords.js';

// Premier compte manager, créé depuis .env tant qu'il n'existe ni manager ni patron.
// Mot de passe temporaire : changement obligatoire à la première connexion.
export async function ensureFirstManager(db: Db, config: Config): Promise<'created' | 'skipped'> {
  const { firstManagerLogin: login, firstManagerTempPassword: password } = config;
  if (!login || !password) return 'skipped';

  const { rowCount } = await db.query(
    `SELECT 1 FROM users WHERE role IN ('manager', 'owner') LIMIT 1`,
  );
  if (rowCount) return 'skipped';

  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO users (login, name, password_hash, role, must_change_password)
     VALUES ($1, $1, $2, 'manager', true)
     ON CONFLICT (lower(login)) DO NOTHING
     RETURNING id`,
    [login, await hashPassword(password)],
  );
  const created = rows[0];
  if (!created) return 'skipped';
  await audit(db, {
    userId: null,
    action: 'user.created',
    entityType: 'user',
    entityId: created.id,
  });
  return 'created';
}
