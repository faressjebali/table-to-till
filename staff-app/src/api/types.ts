// Formes de données de docs/api.md utilisées par l'app staff.

export type Role = 'waiter' | 'barista' | 'chef' | 'manager' | 'accountant';

/** Réponse de `POST /auth/login`. */
export interface LoginResponse {
  token: string;
  user: {
    id: number;
    name: string;
    role: Role;
    title?: string | null;
    mustChangePassword: boolean;
  };
}

/**
 * Réponse de `GET /me`. `title` et `currentPrincipal` sont au contrat mais pas encore renvoyés
 * par le serveur : optionnels ici.
 */
export interface Me {
  id: number;
  name: string;
  role: Role;
  title?: string | null;
  onShift: boolean;
  principal: boolean;
  currentPrincipal?: boolean;
}
