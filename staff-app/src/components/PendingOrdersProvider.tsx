import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getPendingOrders } from '../api/client';
import type { Order } from '../api/types';
import { PendingOrdersContext, upsertPending, type PendingOrders } from '../pendingOrders';
import { useOnConnect, useRealtimeEvent } from '../realtime';
import { playChime } from '../sound';

// Commandes à confirmer du serveur en shift (src/pendingOrders.ts) : chargées à l'ouverture et à
// chaque (re)connexion, tenues à jour par `order:new` (avec le son) et `order:updated`.
export function PendingOrdersProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<PendingOrders['status']>('loading');
  const [orders, setOrders] = useState<Order[]>([]);

  const reload = useCallback(() => {
    getPendingOrders().then(
      ({ items }) => {
        setOrders(items);
        setStatus('ready');
      },
      () => {
        // Liste déjà affichée : on la garde, la prochaine reconnexion la rechargera.
        setStatus((current) => (current === 'loading' ? 'error' : current));
      },
    );
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);
  useOnConnect(reload);

  useRealtimeEvent('order:new', (order) => {
    setOrders((list) => upsertPending(list, order));
    playChime('new');
  });
  useRealtimeEvent('order:updated', (order) => {
    setOrders((list) => upsertPending(list, order));
  });

  const remove = useCallback((orderId: number) => {
    setOrders((list) => list.filter((order) => order.id !== orderId));
  }, []);

  const value = useMemo(
    () => ({ status, orders, reload, remove }),
    [status, orders, reload, remove],
  );
  return <PendingOrdersContext.Provider value={value}>{children}</PendingOrdersContext.Provider>;
}
