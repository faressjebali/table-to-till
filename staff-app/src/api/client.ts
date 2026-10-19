// Appels à l'API du serveur (docs/api.md § 4), avec le jeton de session du staff.
// En développement, Vite renvoie /api vers le serveur (vite.config.ts).
import { loadToken } from '../session';
import type { CurrentShifts, LoginResponse, Me, Order } from './types';

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

export const getCurrentShifts = () => request<CurrentShifts>('/shifts/current');

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
