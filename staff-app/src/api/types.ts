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

/** Texte en français et en anglais (le staff lit le français). */
export interface Localized {
  fr: string;
  en: string;
}

/** Poste qui prépare une ligne : `both` s'affiche au bar et en cuisine. */
export type Station = 'bar' | 'kitchen' | 'both';
export type StationName = 'bar' | 'kitchen';

/** Ligne d'une commande (Order `lines`). */
export interface OrderLine {
  id: number;
  menuItemId: number;
  name: Localized;
  quantity: number;
  note: string | null;
  unitPrice: number;
  discountPercent: number;
  lineTotal: number;
  status: 'active' | 'cancelled' | 'transferred';
  station: Station;
  choices?: { group: string; menuItemId: number; name: Localized }[];
}

type Ready = { at: string; by: { id: number; name: string } } | null;

/** Order de docs/api.md § 2. */
export interface Order {
  id: number;
  table: { id: number; number: number };
  tableSessionId: number | null;
  source: 'qr' | 'waiter' | 'direct' | 'offer';
  status: 'pending' | 'confirmed' | 'rejected' | 'expired';
  lines: OrderLine[];
  total: number;
  createdAt: string;
  confirmedAt: string | null;
  confirmedBy: { id: number; name: string } | null;
  /** Commande sur une table d'offre : `label` est la table d'offre (ex. « Hedi Mansour »). */
  offer: {
    label: string;
    forClient: boolean;
    requestedBy: { id: number; name: string; title?: string | null };
  } | null;
  ready: Record<StationName, Ready>;
  pos: {
    status: 'not_sent' | 'queued' | 'entered' | 'failed' | 'manual';
    error: string | null;
  } | null;
}

/** Données de `order:ready` (serveurs en shift). */
export interface OrderReady {
  orderId: number;
  table: { id: number; number: number };
  station: StationName;
}

/** Réponse de `GET /shifts/current`. */
export interface CurrentShifts {
  waiters: {
    id: number;
    name: string;
    startedAt: string;
    principal: boolean;
    currentPrincipal: boolean;
    shift2: boolean;
  }[];
  /** Baristas et cuisiniers en shift : pour avertir « personne au bar » / « personne en cuisine ». */
  stations: { id: number; name: string; role: 'barista' | 'chef'; startedAt: string }[];
}
