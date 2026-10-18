import { useCallback, useEffect, useState } from 'react';
import { ApiError, getOrder, postOrder } from './api/client';
import {
  linesWithItem,
  newRequestId,
  orderLines,
  removeLine,
  setLineQuantity,
  type CartLine,
} from './cart';
import { loadCart, saveCart, type SavedCart, type SentOrder } from './cart-storage';

/** Intervalle de lecture de l'état d'une commande en attente (en attendant le temps réel). */
export const ORDER_POLL_MS = 10_000;

/** Pourquoi l'envoi a échoué ; le panier est toujours conservé. */
export type SendError =
  | { code: 'CAFE_CLOSED' | 'NO_WAITER_ON_SHIFT' | 'TOO_MANY_REQUESTS' | 'NETWORK' | 'OTHER' }
  | { code: 'UNAVAILABLE'; menuItemId: number };

function toSendError(err: unknown): SendError {
  if (!(err instanceof ApiError)) return { code: 'OTHER' };
  const menuItemId = err.details['menuItemId'];
  if (
    (err.code === 'OUTSIDE_HOURS' || err.code === 'ITEM_UNAVAILABLE') &&
    typeof menuItemId === 'number'
  ) {
    return { code: 'UNAVAILABLE', menuItemId };
  }
  if (
    err.code === 'CAFE_CLOSED' ||
    err.code === 'NO_WAITER_ON_SHIFT' ||
    err.code === 'TOO_MANY_REQUESTS' ||
    err.code === 'NETWORK'
  ) {
    return { code: err.code };
  }
  return { code: 'OTHER' };
}

/**
 * Panier et commande d'une table (docs/product.md § 4) :
 * - le panier est gardé sur le téléphone (rechargement de la page) et jamais vidé avant la
 *   réponse du serveur ;
 * - un envoi relancé réutilise le même `clientRequestId` tant que le panier n'a pas changé ;
 * - commande envoyée : ses lignes sortent du panier ; rejetée ou expirée, elles y reviennent ;
 * - un article refusé (`OUTSIDE_HOURS`, `ITEM_UNAVAILABLE`) est signalé jusqu'à ce que le client
 *   retire ses lignes.
 */
export function useCartOrder(tableToken: string | null) {
  const [saved, setSaved] = useState<SavedCart>(() =>
    tableToken ? loadCart(tableToken) : { lines: [], order: null },
  );
  const [requestId, setRequestId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<SendError | null>(null);
  const [blocked, setBlocked] = useState<number[]>([]);
  const { lines, order } = saved;

  useEffect(() => {
    if (tableToken) saveCart(tableToken, saved);
  }, [tableToken, saved]);

  // Tout changement du panier en fait une nouvelle commande (nouvel identifiant anti-doublon).
  const changeLines = useCallback((update: (lines: CartLine[]) => CartLine[]) => {
    setSaved((current) => ({ ...current, lines: update(current.lines) }));
    setRequestId(null);
    setError(null);
  }, []);

  const add = useCallback(
    (added: CartLine[]) => changeLines((current) => [...current, ...added]),
    [changeLines],
  );
  const setQuantity = useCallback(
    (key: string, quantity: number) =>
      changeLines((current) => setLineQuantity(current, key, quantity)),
    [changeLines],
  );
  const remove = useCallback(
    (key: string) => changeLines((current) => removeLine(current, key)),
    [changeLines],
  );

  /** Envoie le panier ; vrai si la commande est partie. */
  const send = async (): Promise<boolean> => {
    if (!tableToken || lines.length === 0 || sending) return false;
    const id = requestId ?? newRequestId();
    setRequestId(id);
    setSending(true);
    setError(null);
    try {
      const created = await postOrder({
        clientRequestId: id,
        tableToken,
        lines: orderLines(lines),
      });
      const sent: SentOrder = {
        orderId: created.orderId,
        expiresAt: created.expiresAt,
        status: 'pending',
        lines,
      };
      setSaved({ lines: [], order: sent });
      setRequestId(null);
      setBlocked([]);
      return true;
    } catch (err) {
      const sendError = toSendError(err);
      setError(sendError);
      if (sendError.code === 'UNAVAILABLE') {
        setBlocked((ids) => [...new Set([...ids, sendError.menuItemId])]);
      }
      return false;
    } finally {
      setSending(false);
    }
  };

  // Réponse du serveur : confirmée → lignes envoyées oubliées ; rejetée ou expirée → elles
  // reviennent en tête du panier.
  const settle = useCallback((status: SentOrder['status']) => {
    if (status === 'pending') return;
    setSaved((current) => {
      if (!current.order || current.order.status !== 'pending') return current;
      const back = status === 'confirmed' ? [] : current.order.lines;
      return { lines: [...back, ...current.lines], order: { ...current.order, status, lines: [] } };
    });
  }, []);

  const pendingId = order?.status === 'pending' ? order.orderId : null;
  useEffect(() => {
    if (!tableToken || pendingId === null) return;
    let stopped = false;
    const check = () => {
      getOrder(pendingId, tableToken)
        .then(({ status }) => {
          if (!stopped) settle(status);
        })
        .catch((err: unknown) => {
          // Commande introuvable : on la considère comme expirée. Réseau : on réessaie plus tard.
          if (!stopped && err instanceof ApiError && err.status === 404) settle('expired');
        });
    };
    check();
    const timer = setInterval(check, ORDER_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [tableToken, pendingId, settle]);

  const dismissOrder = useCallback(() => {
    setSaved((current) =>
      current.order?.status === 'pending' ? current : { ...current, order: null },
    );
  }, []);

  // Lignes signalées : celles d'un article refusé (l'article ou un choix de formule).
  const blockedKeys = new Set(blocked.flatMap((id) => linesWithItem(lines, id).map((l) => l.key)));

  return {
    lines,
    order,
    sending,
    error,
    blockedKeys,
    add,
    setQuantity,
    remove,
    send,
    dismissOrder,
  };
}
