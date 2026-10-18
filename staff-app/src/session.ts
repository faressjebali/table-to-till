// Jeton de session du staff (30 jours, docs/api.md § 1) : une connexion par téléphone.
// Stockage bloqué (navigation privée) : la session vaut pour la visite en cours seulement.

const KEY = 'coffee-qr.staff.token';
let memoryToken: string | null = null;

export function loadToken(): string | null {
  try {
    // Le stockage fait foi : effacé (déconnexion, réglages du navigateur) = plus de session.
    return localStorage.getItem(KEY);
  } catch {
    return memoryToken;
  }
}

export function saveToken(token: string): void {
  memoryToken = token;
  try {
    localStorage.setItem(KEY, token);
  } catch {
    // Sans stockage : le jeton reste en mémoire.
  }
}

export function clearToken(): void {
  memoryToken = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Rien à effacer.
  }
}
