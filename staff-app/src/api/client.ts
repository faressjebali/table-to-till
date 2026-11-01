// Appels à l'API du serveur (docs/api.md § 4), avec le jeton de session du staff.
// En développement, Vite renvoie /api vers le serveur (vite.config.ts).
import { loadToken } from '../session';
import type {
  CurrentShifts,
  LoginResponse,
  Me,
  MenuResponse,
  Order,
  Role,
  Table,
  TableSessionDetail,
  User,
} from './types';

/**
 * Erreur au format du contrat (`{ error: { code, message, details? } }`), ou `NETWORK` sans
 * réponse.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Session perdue (jeton expiré ou révoqué, compte désactivé) : l'app revient à la connexion. */
type SessionLostListener = (code: 'UNAUTHORIZED' | 'ACCOUNT_DISABLED') => void;
let onSessionLost: SessionLostListener | null = null;
export function setSessionLostListener(listener: SessionLostListener | null) {
  onSessionLost = listener;
}

async function request<T>(
  path: string,
  { method = 'GET', body, auth = true }: { method?: string; body?: unknown; auth?: boolean } = {},
): Promise<T> {
  const token = auth ? loadToken() : null;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? null : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Network error');
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as {
      error?: { code?: string; message?: string; details?: Record<string, unknown> };
    } | null;
    const error = new ApiError(
      res.status,
      data?.error?.code ?? 'INTERNAL_ERROR',
      data?.error?.message ?? res.statusText,
      data?.error?.details,
    );
    if (auth && (error.code === 'UNAUTHORIZED' || error.code === 'ACCOUNT_DISABLED')) {
      onSessionLost?.(error.code);
    }
    throw error;
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const login = (body: { login: string; password: string }) =>
  request<LoginResponse>('/auth/login', { method: 'POST', body, auth: false });

export const changePassword = (body: { currentPassword: string; newPassword: string }) =>
  request<undefined>('/auth/change-password', { method: 'POST', body });

export const logout = () => request<undefined>('/auth/logout', { method: 'POST' });

export const getMe = () => request<Me>('/me');

/** Écran bar / cuisine (docs/api.md § 5 ter), barista et cuisinier en shift. */
export const getStationOrders = () => request<{ items: Order[] }>('/station-orders');

export const markReady = (orderId: number) =>
  request<Order>(`/orders/${String(orderId)}/ready`, { method: 'POST' });

/** Carte vue par le staff : disponibilité selon les horaires propres des articles. */
export const getMenu = () => request<MenuResponse>('/menu');

/** Ligne de `POST /staff-orders` : `choices` seulement pour un article à choix. */
export interface StaffOrderLine {
  menuItemId: number;
  quantity: number;
  note: string | null;
  choices?: { group: string; menuItemId: number }[];
}

/**
 * Commande saisie par un serveur en shift sur une table réelle : confirmée tout de suite.
 * 409 `ITEM_UNAVAILABLE` ou `OUTSIDE_HOURS` avec `details.menuItemId` ; `clientRequestId` évite
 * un doublon si la requête est renvoyée.
 */
export const createStaffOrder = (body: {
  clientRequestId: string;
  tableId: number;
  lines: StaffOrderLine[];
}) => request<Order>('/staff-orders', { method: 'POST', body });

/** Plan de la salle (serveur en shift). */
export const getTables = () => request<{ tables: Table[] }>('/tables');

/** Commandes d'une table occupée ; 404 `NOT_FOUND` si elle est libre. */
export const getTableSession = (tableId: number) =>
  request<TableSessionDetail>(`/tables/${String(tableId)}/session`);

export const getCurrentShifts = () => request<CurrentShifts>('/shifts/current');

/**
 * Commandes QR et commandes offertes à confirmer, les plus anciennes d'abord (serveur en shift).
 * Une seule page de 100 : il n'y en a jamais autant en attente en même temps.
 */
export const getPendingOrders = () =>
  request<{ items: Order[]; nextCursor: string | null }>('/orders?status=pending&limit=100');

/** 409 `INVALID_STATUS` : déjà traitée ou expirée ; 409 `ITEM_UNAVAILABLE` : article en rupture. */
export const confirmOrder = (orderId: number) =>
  request<Order>(`/orders/${String(orderId)}/confirm`, { method: 'POST' });

export const rejectOrder = (orderId: number) =>
  request<Order>(`/orders/${String(orderId)}/reject`, { method: 'POST', body: {} });

/** Serveur, barista, cuisinier ; relançable (double toucher : le shift ouvert est renvoyé). */
export const startShift = () =>
  request<{ shiftId: number; startedAt: string; principal: boolean }>('/shifts/start', {
    method: 'POST',
    body: {},
  });

/** Renfort, barista, cuisinier (le principal clôture). */
export const endShift = () => request<undefined>('/shifts/end', { method: 'POST' });

/** Abonnement Web Push du téléphone (`PushSubscription.toJSON()`), lié à cette session. */
export const subscribePush = (body: PushSubscriptionJSON) =>
  request<undefined>('/push/subscribe', { method: 'POST', body });

/** Comptes (docs/api.md § 6), manager seulement. */
export const getUsers = () => request<{ users: User[] }>('/users');

/** 400 `VALIDATION_ERROR` sur `login` : identifiant déjà pris. Mot de passe renvoyé une fois. */
export const createUser = (body: { name: string; login: string; role: Role; title?: string }) =>
  request<{ user: User; temporaryPassword: string }>('/users', { method: 'POST', body });

/** 409 `INVALID_STATUS` : soi-même, dernier manager actif, ou serveur en shift. */
export const updateUser = (
  userId: number,
  body: { role?: Role; title?: string | null; active?: boolean },
) => request<User>(`/users/${String(userId)}`, { method: 'PATCH', body });

/** Débloque le compte et coupe ses sessions ; nouveau mot de passe renvoyé une fois. */
export const resetUserPassword = (userId: number) =>
  request<{ user: User; temporaryPassword: string }>(`/users/${String(userId)}/reset-password`, {
    method: 'POST',
  });
