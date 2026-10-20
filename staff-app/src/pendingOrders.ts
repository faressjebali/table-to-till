import { createContext, useContext } from 'react';
import type { CurrentShifts, Order, StationName } from './api/types';

// Commandes à confirmer (docs/product.md § 5, « Commandes entrantes ») : commandes QR et commandes
// offertes des managers et du comptable. La liste vit au niveau des écrans du serveur en shift
// (components/PendingOrdersProvider.tsx) : le son joue et la pastille de l'onglet Commandes se met
// à jour quel que soit l'écran ouvert.

export interface PendingOrders {
  status: 'loading' | 'error' | 'ready';
  orders: Order[];
  reload: () => void;
  /** Commande traitée ici : elle sort de la liste sans attendre `order:updated`. */
  remove: (orderId: number) => void;
}

export const PendingOrdersContext = createContext<PendingOrders | null>(null);

/** `null` hors des écrans d'un serveur en shift. */
export const usePendingOrders = () => useContext(PendingOrdersContext);

const byCreation = (a: Order, b: Order) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id;

/** Ajoute ou remplace une commande reçue ; confirmée, rejetée ou expirée, elle sort. */
export function upsertPending(list: Order[], order: Order): Order[] {
  const others = list.filter((o) => o.id !== order.id);
  if (order.status !== 'pending') return others;
  return [...others, order].sort(byCreation);
}

/**
 * Postes sans personne en shift pour les lignes de la commande : le serveur prévient à l'oral, la
 * commande passe quand même. Une ligne `both` n'attend personne si l'un des deux postes est là.
 */
export function unstaffedStations(order: Order, shifts: CurrentShifts): StationName[] {
  const has = (role: 'barista' | 'chef') => shifts.stations.some((s) => s.role === role);
  const lines = order.lines.filter((line) => line.status === 'active');
  const needs = (station: 'bar' | 'kitchen') => lines.some((line) => line.station === station);
  const both = lines.some((line) => line.station === 'both') && !has('barista') && !has('chef');
  const missing: StationName[] = [];
  if (!has('barista') && (needs('bar') || both)) missing.push('bar');
  if (!has('chef') && (needs('kitchen') || both)) missing.push('kitchen');
  return missing;
}

/** Numéro de commande d'une adresse de notification (`/?order=154`), sinon `null`. */
export function orderFromUrl(url: string): number | null {
  let value: string | null;
  try {
    value = new URL(url, 'http://app').searchParams.get('order');
  } catch {
    return null;
  }
  const id = Number(value);
  return value !== null && Number.isInteger(id) && id > 0 ? id : null;
}
