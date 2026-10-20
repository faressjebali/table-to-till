import { useSyncExternalStore } from 'react';
import type { OrderReady } from './api/types';

// Commandes prêtes au bar ou en cuisine, pas encore acquittées par le serveur (`order:ready`) :
// le bandeau « Table 7 : boissons prêtes » et la bande bleue du plan des tables. Gardées sur le
// téléphone pour survivre à une reconnexion ou à un redémarrage de l'app : l'API ne permet pas de
// les relire. Une prête s'en va au OK du bandeau, ou quand sa table est libérée.

export interface ReadyItem {
  key: string;
  orderId: number;
  tableId: number;
  tableNumber: number;
  station: 'bar' | 'kitchen';
}

const KEY = 'coffee-qr.staff.ready';
const listeners = new Set<() => void>();
let memory: ReadyItem[] = [];
// Dernière lecture : la même liste tant que le stockage n'a pas changé (useSyncExternalStore).
let cached: { raw: string | null; items: ReadyItem[] } = { raw: null, items: [] };

function read(): ReadyItem[] {
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return memory;
  }
  if (raw === cached.raw) return cached.items;
  let items: ReadyItem[] = [];
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) items = parsed as ReadyItem[];
  } catch {
    // Valeur abîmée : on repart de zéro.
  }
  cached = { raw, items };
  return items;
}

function write(items: ReadyItem[]) {
  memory = items;
  try {
    if (items.length === 0) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // Sans stockage : la liste reste en mémoire pour la visite.
  }
  listeners.forEach((listener) => {
    listener();
  });
}

export function addReady({ orderId, table, station }: OrderReady) {
  const key = `${String(orderId)}-${station}`;
  const item: ReadyItem = { key, orderId, tableId: table.id, tableNumber: table.number, station };
  write([...read().filter((current) => current.key !== key), item]);
}

export function dismissReady(key: string) {
  write(read().filter((item) => item.key !== key));
}

/** Table libérée (encaissée) : plus rien n'y attend d'être apporté. */
export function clearReadyTables(tableIds: number[]) {
  const items = read();
  const kept = items.filter((item) => !tableIds.includes(item.tableId));
  if (kept.length !== items.length) write(kept);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useReadyItems(): ReadyItem[] {
  return useSyncExternalStore(subscribe, read);
}
