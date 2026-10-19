import { createContext, useContext, useEffect, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import type { Order, OrderReady } from './api/types';

// Temps réel (docs/api.md § 8) : une connexion Socket.IO par téléphone connecté. Le serveur range
// la connexion selon le rôle et le shift au moment où elle s'ouvre : elle est refaite quand le
// shift change (clé de RealtimeProvider, dans components/).

/** Événements reçus du serveur, utilisés par l'app. */
export interface ServerEvents {
  'station:order': (order: Order) => void;
  /** `alert` : une ligne vient d'être annulée. */
  'station:updated': (order: Order & { alert?: boolean }) => void;
  'order:ready': (data: OrderReady) => void;
}

// Socket sans types d'événements : useRealtimeEvent les type à l'écoute, depuis ServerEvents.
export const RealtimeContext = createContext<Socket | null>(null);

/** Écoute un événement du serveur tant que le composant est affiché. */
export function useRealtimeEvent<E extends keyof ServerEvents>(
  event: E,
  handler: (data: Parameters<ServerEvents[E]>[0]) => void,
) {
  const socket = useContext(RealtimeContext);
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });

  useEffect(() => {
    if (!socket) return;
    const listener = (data: Parameters<ServerEvents[E]>[0]) => {
      latest.current(data);
    };
    const name: string = event;
    socket.on(name, listener);
    return () => {
      socket.off(name, listener);
    };
  }, [socket, event]);
}

/**
 * Appelé à chaque connexion, reconnexion comprise : les événements envoyés pendant la coupure
 * sont perdus, l'écran recharge sa liste par l'API.
 */
export function useOnConnect(handler: () => void) {
  const socket = useContext(RealtimeContext);
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });

  useEffect(() => {
    if (!socket) return;
    const listener = () => {
      latest.current();
    };
    socket.on('connect', listener);
    return () => {
      socket.off('connect', listener);
    };
  }, [socket]);
}
