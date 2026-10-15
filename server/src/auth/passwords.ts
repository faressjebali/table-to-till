import argon2 from 'argon2';

export const PASSWORD_MIN_LENGTH = 8;
// Borne haute pour limiter le coût du hachage.
export const PASSWORD_MAX_LENGTH = 200;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    // Empreinte illisible en base : refus, comme un mauvais mot de passe.
    return false;
  }
}

// Identifiant inconnu : on vérifie quand même une empreinte factice pour que la réponse
// prenne le même temps (on ne révèle pas quels identifiants existent).
let dummyHash: Promise<string> | undefined;
export async function verifyDummyPassword(password: string): Promise<void> {
  dummyHash ??= hashPassword('dummy-password-never-valid');
  await verifyPassword(await dummyHash, password);
}
