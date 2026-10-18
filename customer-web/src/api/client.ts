// Appels à l'API du serveur (docs/api.md § 3), sans connexion.
// En développement, Vite renvoie /api vers le serveur (vite.config.ts).
import type { MenuResponse, Millimes } from './types';

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

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      headers: { Accept: 'application/json', ...init.headers },
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Network error');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: { code?: string; message?: string; details?: Record<string, unknown> };
    } | null;
    throw new ApiError(
      res.status,
      body?.error?.code ?? 'INTERNAL_ERROR',
      body?.error?.message ?? res.statusText,
      body?.error?.details,
    );
  }
  return (await res.json()) as T;
}

const getJson = <T>(path: string) => requestJson<T>(path);

export interface TableInfo {
  id: number;
  number: number;
}

/** Table du QR ; jeton inconnu → ApiError 404 `TABLE_NOT_FOUND`. */
export function getTable(tableToken: string): Promise<TableInfo> {
  return getJson<TableInfo>(`/tables/${encodeURIComponent(tableToken)}`);
}

export function getMenu(): Promise<MenuResponse> {
  return getJson<MenuResponse>('/menu');
}

/** Ligne de `POST /orders`. */
export interface OrderLineInput {
  menuItemId: number;
  quantity: number;
  note: string | null;
  choices?: { group: string; menuItemId: number }[];
}

export interface CreatedOrder {
  orderId: number;
  status: 'pending';
  total: Millimes;
  expiresAt: string;
}

export type OrderStatus = 'pending' | 'confirmed' | 'rejected' | 'expired';

/** Commande QR (docs/api.md § 3). Même `clientRequestId` renvoyé → même commande, rien de recréé. */
export function postOrder(body: {
  clientRequestId: string;
  tableToken: string;
  lines: OrderLineInput[];
}): Promise<CreatedOrder> {
  return requestJson<CreatedOrder>('/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** État d'une commande de cette table (en attendant le temps réel). */
export function getOrder(
  orderId: number,
  tableToken: string,
): Promise<{ orderId: number; status: OrderStatus }> {
  return getJson(`/orders/${String(orderId)}?tableToken=${encodeURIComponent(tableToken)}`);
}
