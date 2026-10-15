import { randomInt } from 'node:crypto';

// Minuscules et chiffres, sans les caractères qu'on confond (0 o 1 l i) : facile à dicter et à taper.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const TEMPORARY_PASSWORD_LENGTH = 10;

export function generateTemporaryPassword(): string {
  return Array.from({ length: TEMPORARY_PASSWORD_LENGTH }, () =>
    ALPHABET.charAt(randomInt(ALPHABET.length)),
  ).join('');
}
