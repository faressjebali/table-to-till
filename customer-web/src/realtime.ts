import { io, type Socket } from 'socket.io-client';
import type { MenuUpdate } from './menu-view';

// Temps réel (docs/api.md § 8) : le client se connecte avec le jeton de sa table et reçoit
// seulement les événements de sa table, plus `menu:updated`.

/** Événements reçus du serveur, utilisés par le menu QR. */
export interface ServerEvents {
  'menu:updated': (update: MenuUpdate) => void;
}

export type TableSocket = Socket<ServerEvents>;

export function connectTable(tableToken: string): TableSocket {
  return io({ auth: { tableToken } });
}
