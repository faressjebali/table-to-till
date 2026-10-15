import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '../db.js';

export type Role = 'manager' | 'waiter' | 'barista' | 'chef';

export type AuthContext = {
  sessionId: number;
  user: { id: number; login: string; name: string; role: Role; mustChangePassword: boolean };
};

// Le token n'est jamais stocké en clair : seulement son empreinte SHA-256.
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(db: Db, userId: number, days: number): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.query(
    `INSERT INTO sessions (user_id, token_hash, expires_at, last_seen_at)
     VALUES ($1, $2, now() + make_interval(days => $3), now())`,
    [userId, hashToken(token), days],
  );
  return token;
}

type SessionRow = {
  session_id: number;
  extend: boolean;
  user_id: number;
  login: string;
  name: string;
  role: Role;
  must_change_password: boolean;
  disabled: boolean;
};

export type SessionLookup =
  { status: 'ok'; auth: AuthContext } | { status: 'invalid' } | { status: 'disabled' };

// Session prolongée à chaque utilisation, mais au plus une fois par jour en base.
export async function findSession(db: Db, token: string, days: number): Promise<SessionLookup> {
  const { rows } = await db.query<SessionRow>(
    `SELECT s.id AS session_id,
            s.last_seen_at IS NULL OR s.last_seen_at < now() - interval '1 day' AS extend,
            u.id AS user_id, u.login, u.name, u.role, u.must_change_password,
            u.disabled_at IS NOT NULL AS disabled
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
    [hashToken(token)],
  );
  const row = rows[0];
  if (!row) return { status: 'invalid' };
  if (row.disabled) return { status: 'disabled' };
  if (row.extend) {
    await db.query(
      `UPDATE sessions SET last_seen_at = now(), expires_at = now() + make_interval(days => $2)
        WHERE id = $1`,
      [row.session_id, days],
    );
  }
  return {
    status: 'ok',
    auth: {
      sessionId: row.session_id,
      user: {
        id: row.user_id,
        login: row.login,
        name: row.name,
        role: row.role,
        mustChangePassword: row.must_change_password,
      },
    },
  };
}

export async function revokeSession(db: Db, sessionId: number): Promise<void> {
  await db.query(`UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`, [
    sessionId,
  ]);
}
