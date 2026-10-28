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
 * Réponse de `GET /me`. `currentPrincipal` est au contrat mais pas encore renvoyé par le serveur
 * : optionnel ici, comme `title` (renvoyé, `null` si aucun).
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

/** User de docs/api.md § 2 : un compte staff, vu par la manager (`/users`). */
export interface User {
  id: number;
  name: string;
  login: string;
  role: Role;
  /** Titre affiché, `null` si aucun. */
  title?: string | null;
  active: boolean;
  mustChangePassword: boolean;
  locked: boolean;
  lastLoginAt: string | null;
  createdAt: string;
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

/** Table de docs/api.md § 2 (plan de la salle : tables `real` seulement). */
/** Salle du plan des tables : intérieur ou terrasse. */
export type Room = 'inside' | 'terrace';

export interface Table {
  id: number;
  number: number;
  kind: 'real' | 'virtual';
  state: 'free' | 'occupied';
  openSessionId: number | null;
  /** Commandes confirmées seulement, en millimes. */
  openTotal: number;
  /** Commandes QR en attente : la table n'est pas occupée pour autant. */
  pendingOrders: number;
  /** Place sur le plan de sa salle (contrat v2.4) ; une table longue est carrée avec `w` > 1. */
  layout: {
    room: Room;
    x: number;
    y: number;
    w: number;
    h: number;
    shape: 'square' | 'round';
  } | null;
  offer: { label: string; userId: number | null } | null;
  /** Principal de la session ouverte ; `null` si la table est libre. */
  principalId: number | null;
}

/** TableSession de docs/api.md § 2 : une « ouverture » de table, jusqu'à l'encaissement. */
export interface TableSession {
  id: number;
  tableId: number;
  openedAt: string;
  closedAt: string | null;
  status: 'open' | 'paid' | 'unpaid';
  total: number;
  orderIds: number[];
  principal: { id: number; name: string } | null;
}

/** Réponse de `GET /tables/:id/session`. Les offerts (`gifts`) arrive plus tard. */
export interface TableSessionDetail {
  session: TableSession;
  orders: Order[];
  gifts: unknown[];
}

/** Données de `order:ready` (serveurs en shift). */
export interface OrderReady {
  orderId: number;
  table: { id: number; number: number };
  station: StationName;
}

/**
 * Réponse de `GET /shifts/current`. `currentPrincipal` et `shift2` sont au contrat mais pas encore
 * renvoyés par le serveur : optionnels ici.
 */
export interface CurrentShifts {
  waiters: {
    id: number;
    name: string;
    startedAt: string;
    principal: boolean;
    currentPrincipal?: boolean;
    shift2?: boolean;
  }[];
  /** Baristas et cuisiniers en shift : pour avertir « personne au bar » / « personne en cuisine ». */
  stations: { id: number; name: string; role: 'barista' | 'chef'; startedAt: string }[];
}
