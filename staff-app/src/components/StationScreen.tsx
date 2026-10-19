import { useCallback, useEffect, useState } from 'react';
import { ApiError, getStationOrders, markReady } from '../api/client';
import type { Order, OrderLine, StationName } from '../api/types';
import { t } from '../i18n/fr';
import { useOnConnect, useRealtimeEvent } from '../realtime';
import { playChime } from '../sound';
import {
  hasActiveLines,
  newlyCancelled,
  placeLabel,
  removeOrder,
  timeLabel,
  upsertOrder,
} from '../stationOrders';

type Status = 'loading' | 'error' | 'ready';

let nextAlertId = 1;

// Écran bar / cuisine (docs/product.md § 5, docs/api.md § 5 ter) : les commandes confirmées dont
// la partie de mon poste n'est pas prête, les plus anciennes en haut, avec notes et choix.
export function StationScreen({ station }: { station: StationName }) {
  const [status, setStatus] = useState<Status>('loading');
  const [orders, setOrders] = useState<Order[]>([]);
  const [alerts, setAlerts] = useState<{ id: number; text: string }[]>([]);
  const [sending, setSending] = useState<number | null>(null);
  const [failed, setFailed] = useState<number | null>(null);

  // Liste complète : à l'ouverture, à chaque (re)connexion et quand Prêt arrive trop tard.
  const load = useCallback(
    () =>
      getStationOrders().then(
        ({ items }) => {
          setOrders(items);
          setStatus('ready');
        },
        () => {
          // Liste déjà affichée : on la garde, la prochaine reconnexion la rechargera.
          setStatus((current) => (current === 'loading' ? 'error' : current));
        },
      ),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);
  useOnConnect(() => void load());

  useRealtimeEvent('station:order', (order) => {
    setOrders((list) => upsertOrder(list, order, station));
    playChime('new');
  });

  useRealtimeEvent('station:updated', (order) => {
    if (order.alert) {
      const lines = newlyCancelled(
        orders.find((o) => o.id === order.id),
        order,
      );
      if (lines.length > 0) {
        const what = lines.map((line) => `${String(line.quantity)} × ${line.name.fr}`).join(', ');
        setAlerts((list) => [
          ...list,
          { id: nextAlertId++, text: `${placeLabel(order)} : ${what} ${t('station.alert')}` },
        ]);
        playChime('alert');
      }
    }
    setOrders((list) => upsertOrder(list, order, station));
  });

  const ready = (order: Order) => {
    setSending(order.id);
    setFailed(null);
    markReady(order.id).then(
      () => {
        setOrders((list) => removeOrder(list, order.id));
        setSending(null);
      },
      (err: unknown) => {
        setSending(null);
        // Déjà prête (autre téléphone) ou plus rien à préparer : la liste du serveur fait foi.
        if (
          err instanceof ApiError &&
          (err.code === 'INVALID_STATUS' || err.code === 'NOT_FOUND')
        ) {
          void load();
        } else {
          setFailed(order.id);
        }
      },
    );
  };

  return (
    <>
      <h1 className="title">{t(station === 'bar' ? 'screen.bar' : 'screen.kitchen')}</h1>

      {alerts.map((alert) => (
        <div key={alert.id} className="alert" role="alert">
          <p className="alert__text">{alert.text}</p>
          <button
            type="button"
            className="button button--secondary"
            onClick={() => setAlerts((list) => list.filter((a) => a.id !== alert.id))}
          >
            {t('station.alertDismiss')}
          </button>
        </div>
      ))}

      {status === 'loading' && (
        <p className="body" role="status">
          {t('station.loading')}
        </p>
      )}
      {status === 'error' && (
        <div className="notice" role="alert">
          <p className="body">{t('station.error')}</p>
          <button type="button" className="button" onClick={() => void load()}>
            {t('session.retry')}
          </button>
        </div>
      )}
      {status === 'ready' && orders.length === 0 && <p className="body">{t('station.empty')}</p>}

      {orders.map((order) => {
        const active = hasActiveLines(order);
        return (
          <article key={order.id} className="ticket" aria-label={placeLabel(order)}>
            <header className="ticket__head">
              <h2 className="ticket__place">{placeLabel(order)}</h2>
              <time className="ticket__time" dateTime={order.confirmedAt ?? order.createdAt}>
                {timeLabel(order)}
              </time>
            </header>
            {order.offer?.forClient && (
              <p className="badge badge--accent">{t('station.forClient')}</p>
            )}
            <ul className="ticket__lines">
              {order.lines.map((line) => (
                <TicketLine key={line.id} line={line} />
              ))}
            </ul>
            {failed === order.id && (
              <p className="form__error" role="alert">
                {t('station.readyError')}
              </p>
            )}
            {active ? (
              <button
                type="button"
                className="button button--block"
                disabled={sending === order.id}
                onClick={() => ready(order)}
              >
                {sending === order.id ? t('station.readyBusy') : t('station.ready')}
              </button>
            ) : (
              <button
                type="button"
                className="button button--secondary button--block"
                onClick={() => setOrders((list) => removeOrder(list, order.id))}
              >
                {t('station.seen')}
              </button>
            )}
          </article>
        );
      })}
    </>
  );
}

function TicketLine({ line }: { line: OrderLine }) {
  const off = line.status !== 'active';
  const name = line.name.fr;
  return (
    <li className={off ? 'ticket__line ticket__line--off' : 'ticket__line'}>
      <span className="ticket__qty">{line.quantity} ×</span>
      <div className="ticket__what">
        <p className="ticket__name">{off ? <s>{name}</s> : name}</p>
        {line.choices && line.choices.length > 0 && (
          <p className="ticket__choices">{line.choices.map((c) => c.name.fr).join(' · ')}</p>
        )}
        {line.note && <p className="ticket__note">« {line.note} »</p>}
      </div>
      {off && (
        <span className="ticket__flag">
          {t(line.status === 'cancelled' ? 'station.cancelled' : 'station.transferred')}
        </span>
      )}
    </li>
  );
}
