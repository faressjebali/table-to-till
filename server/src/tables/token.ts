import { randomBytes } from 'node:crypto';

// Jeton aléatoire du QR (docs/api.md § 3) : jamais le numéro de la table.
export function newTableToken(): string {
  return randomBytes(16).toString('base64url');
}
