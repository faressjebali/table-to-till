import type { OrderStatus } from './api/client';
import type { CartLine } from './cart';

/** Commande envoyée, en attente de réponse : ses lignes reviennent au panier si elle expire. */
export interface SentOrder {
  orderId: number;
  expiresAt: string;
  status: OrderStatus;
  lines: CartLine[];
}

export interface SavedCart {
  lines: CartLine[];
  order: SentOrder | null;
}

const EMPTY: SavedCart = { lines: [], order: null };
const key = (tableToken: string) => `coffee-qr.cart.${tableToken}`;

// Le panier survit à un rechargement de la page, par table. Stockage bloqué (navigation
// privée) : il vaut pour la visite en cours seulement.
export function loadCart(tableToken: string): SavedCart {
  try {
    const raw = localStorage.getItem(key(tableToken));
    if (!raw) return EMPTY;
    const saved = JSON.parse(raw) as Partial<SavedCart>;
    return {
      lines: Array.isArray(saved.lines) ? saved.lines : [],
      order: saved.order ?? null,
    };
  } catch {
    return EMPTY;
  }
}

export function saveCart(tableToken: string, cart: SavedCart): void {
  try {
    if (cart.lines.length === 0 && cart.order === null) localStorage.removeItem(key(tableToken));
    else localStorage.setItem(key(tableToken), JSON.stringify(cart));
  } catch {
    // Sans stockage : rien à faire.
  }
}
