// Appels à l'API du serveur (docs/api.md § 3), sans connexion.
// En développement, Vite renvoie /api vers le serveur (vite.config.ts).
import type { MenuResponse } from './types';

/** Erreur au format du contrat (`{ error: { code, message } }`), ou `NETWORK` sans réponse. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function getJson<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { headers: { Accept: 'application/json' } });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Network error');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    throw new ApiError(
      res.status,
      body?.error?.code ?? 'INTERNAL_ERROR',
      body?.error?.message ?? res.statusText,
    );
  }
  return (await res.json()) as T;
}

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
