import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, confirmOrder, getCurrentShifts, rejectOrder } from '../api/client';
import type { CurrentShifts, Order, StationName } from '../api/types';
import { formatPrice } from '../format';
import { t } from '../i18n/fr';
import { unstaffedStations, usePendingOrders } from '../pendingOrders';
import { useOnConnect, useRealtimeEvent } from '../realtime';
import { placeLabel, timeLabel } from '../stationOrders';
import { StateIcon } from './StateIcon';
import { OrderLineRow } from './TableDetail';

type CardError = { orderId: number; text: string };

let nextNoticeId = 1;

// Commandes entrantes (docs/product.md § 5 et § 6) : commandes QR et commandes offertes à
// confirmer, les plus anciennes en haut. Le serveur vérifie avec la table, puis Confirme (la
// commande part en caisse et sur l'écran bar / cuisine) ou Rejette. `focusId` : commande ouverte
// depuis une notification.
export function OrdersScreen({ focusId }: { focusId: number | null }) {
  const pending = usePendingOrders();
  const [shifts, setShifts] = useState<CurrentShifts | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [rejecting, setRejecting] = useState<number | null>(null);
  const [error, setError] = useState<CardError | null>(null);
  const [notices, setNotices] = useState<{ id: number; text: string }[]>([]);

  // Qui est au bar et en cuisine : à l'ouverture, à la reconnexion et à chaque nouvelle commande.
  const loadShifts = useCallback(() => {
    getCurrentShifts().then(setShifts, () => undefined);
  }, []);
  useEffect(() => {
    loadShifts();
  }, [loadShifts]);
  useOnConnect(loadShifts);
  useRealtimeEvent('order:new', loadShifts);

  const orders = pending?.orders ?? [];
  const status = pending?.status ?? 'loading';
  const missingFocus =
    focusId !== null && status === 'ready' && !orders.some((order) => order.id === focusId);

  const notify = (text: string) => {
    setNotices((list) => [...list, { id: nextNoticeId++, text }]);
  };

  const confirm = (order: Order) => {
    setBusy(order.id);
    setError(null);
    confirmOrder(order.id).then(
      () => {
        setBusy(null);
        pending?.remove(order.id);
        const missing = shifts ? unstaffedStations(order, shifts) : [];
        if (missing.length > 0) {
          notify(`${placeLabel(order)} ${t('orders.confirmed')} ${nobodyText(missing)}`);
        }
      },
      (err: unknown) => {
        setBusy(null);
        handleError(order, err);
      },
    );
  };

  const reject = (order: Order) => {
    setBusy(order.id);
    setError(null);
    rejectOrder(order.id).then(
      () => {
        setBusy(null);
        setRejecting(null);
        pending?.remove(order.id);
      },
      (err: unknown) => {
        setBusy(null);
        setRejecting(null);
        handleError(order, err);
      },
    );
  };

  const handleError = (order: Order, err: unknown) => {
    // Un autre serveur l'a traitée, ou elle a expiré : la liste du serveur fait foi.
    if (err instanceof ApiError && (err.code === 'INVALID_STATUS' || err.code === 'NOT_FOUND')) {
      pending?.remove(order.id);
      pending?.reload();
      notify(`${placeLabel(order)} : ${t('orders.alreadyHandled')}`);
      return;
    }
    if (err instanceof ApiError && err.code === 'ITEM_UNAVAILABLE') {
      const name = itemName(order, err.details['menuItemId']);
      setError({
        orderId: order.id,
        text: name ? `« ${name} » ${t('orders.soldOut')}` : t('orders.soldOutUnknown'),
      });
      return;
    }
    setError({ orderId: order.id, text: t('orders.sendError') });
  };

  return (
    <>
      <h1 className="title">{t('screen.orders')}</h1>

      {notices.map((notice) => (
        <div key={notice.id} className="alert" role="alert">
          <p className="alert__text">{notice.text}</p>
          <button
            type="button"
            className="button button--secondary"
            onClick={() => setNotices((list) => list.filter((n) => n.id !== notice.id))}
          >
            {t('orders.dismiss')}
          </button>
        </div>
      ))}

      {missingFocus && <p className="body">{t('orders.focusGone')}</p>}

      {status === 'loading' && (
        <p className="body" role="status">
          {t('orders.loading')}
        </p>
      )}
      {status === 'error' && (
        <div className="notice" role="alert">
          <p className="body">{t('orders.error')}</p>
          <button type="button" className="button" onClick={() => pending?.reload()}>
            {t('session.retry')}
          </button>
        </div>
      )}
      {status === 'ready' && orders.length === 0 && <p className="body">{t('orders.empty')}</p>}

      {orders.map((order) => (
        <PendingCard
          key={order.id}
          order={order}
          focused={order.id === focusId}
          missing={shifts ? unstaffedStations(order, shifts) : []}
          busy={busy === order.id}
          rejecting={rejecting === order.id}
          error={error?.orderId === order.id ? error.text : null}
          onConfirm={() => confirm(order)}
          onReject={() => setRejecting(order.id)}
          onRejectYes={() => reject(order)}
          onRejectNo={() => setRejecting(null)}
        />
      ))}
    </>
  );
}

function PendingCard({
  order,
  focused,
  missing,
  busy,
  rejecting,
  error,
  onConfirm,
  onReject,
  onRejectYes,
  onRejectNo,
}: {
  order: Order;
  focused: boolean;
  missing: StationName[];
  busy: boolean;
  rejecting: boolean;
  error: string | null;
  onConfirm: () => void;
  onReject: () => void;
  onRejectYes: () => void;
  onRejectNo: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  // Ouverte depuis une notification : la carte vient à l'écran et prend le focus.
  useEffect(() => {
    if (!focused) return;
    ref.current?.scrollIntoView?.({ block: 'start' });
    ref.current?.focus();
  }, [focused]);

  const place = placeLabel(order);
  return (
    <article
      ref={ref}
      tabIndex={-1}
      className="ticket ticket--receipt"
      aria-label={`${place}, ${timeLabel(order)}`}
    >
      <header className="ticket__head">
        <h2 className="ticket__place">{place}</h2>
        <time className="ticket__time" dateTime={order.createdAt}>
          {timeLabel(order)}
        </time>
      </header>
      {order.offer && <p className="badge badge--accent">{offerText(order.offer)}</p>}
      <ul className="ticket__lines">
        {order.lines.map((line) => (
          <OrderLineRow key={line.id} line={line} />
        ))}
      </ul>
      <p className="ticket__total">
        <span className="ticket__total-label">{t('table.total')}</span>
        {formatPrice(order.total)}
      </p>
      {missing.length > 0 && (
        <div className="alert">
          <span className="alert__icon">
            <StateIcon state={missing[0] === 'kitchen' ? 'kitchen' : 'bar'} />
          </span>
          <p className="alert__text">{nobodyText(missing)}</p>
        </div>
      )}
      {error && (
        <p className="form__error" role="alert">
          {error}
        </p>
      )}
      {rejecting ? (
        <div className="confirm" role="group" aria-label={t('orders.reject')}>
          <p className="confirm__text">{t('orders.rejectConfirm')}</p>
          <button
            type="button"
            className="button button--danger"
            disabled={busy}
            onClick={onRejectYes}
          >
            {busy ? t('orders.busy') : t('orders.rejectYes')}
          </button>
          <button
            type="button"
            className="button button--secondary"
            disabled={busy}
            onClick={onRejectNo}
          >
            {t('orders.rejectNo')}
          </button>
        </div>
      ) : (
        <>
          <button
            type="button"
            className="button button--block"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? t('orders.busy') : t('orders.confirm')}
          </button>
          <button
            type="button"
            className="button button--secondary button--block"
            disabled={busy}
            onClick={onReject}
          >
            {t('orders.reject')}
          </button>
        </>
      )}
    </article>
  );
}

// « Commande de Rania (Manager) » ou « Offert à un client par Rania (Manager) ».
function offerText(offer: NonNullable<Order['offer']>): string {
  const who = offer.requestedBy.title
    ? `${offer.requestedBy.name} (${offer.requestedBy.title})`
    : offer.requestedBy.name;
  return `${t(offer.forClient ? 'orders.offerForClient' : 'orders.offerFor')} ${who}`;
}

// « Personne au bar : prévenez à l'oral. »
function nobodyText(missing: StationName[]): string {
  const where =
    missing.length === 2
      ? t('orders.nobodyBoth')
      : t(missing[0] === 'bar' ? 'orders.nobodyBar' : 'orders.nobodyKitchen');
  return `${where} ${t('orders.tellThem')}`;
}

// Nom de l'article (ou de l'option de formule) en rupture.
function itemName(order: Order, menuItemId: unknown): string | null {
  for (const line of order.lines) {
    if (line.menuItemId === menuItemId) return line.name.fr;
    const choice = line.choices?.find((c) => c.menuItemId === menuItemId);
    if (choice) return choice.name.fr;
  }
  return null;
}
