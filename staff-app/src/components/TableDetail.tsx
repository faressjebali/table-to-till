import { useCallback, useEffect, useState } from 'react';
import { ApiError, getTableSession } from '../api/client';
import type { Order, OrderLine, Table, TableSessionDetail } from '../api/types';
import { formatPrice } from '../format';
import { t } from '../i18n/fr';
import { useOnConnect, useRealtimeEvent } from '../realtime';
import { timeLabel } from '../stationOrders';
import { ofName, pendingText } from '../tablePlan';
import { StateIcon, type State as IconState } from './StateIcon';

type State =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'free' }
  | { status: 'open'; detail: TableSessionDetail };

const clock = new Intl.DateTimeFormat('fr-FR', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Africa/Tunis',
});

// Commandes d'une table (docs/api.md § 5, `GET /tables/:id/session` ; apparence : docs/design.md) :
// chaque commande confirmée avec ses lignes, notes et choix, son état en caisse, ce qui est prêt,
// et le total. Rien n'est modifiable ici pour l'instant : les actions (saisir, encaisser,
// remise…) arrivent chacune avec son issue.
export function TableDetail({ table, onBack }: { table: Table; onBack: () => void }) {
  const [state, setState] = useState<State>({ status: 'loading' });

  const load = useCallback(() => {
    getTableSession(table.id).then(
      (detail) => setState({ status: 'open', detail }),
      (err: unknown) => {
        // Libre (jamais ouverte, ou encaissée entre-temps).
        if (err instanceof ApiError && err.code === 'NOT_FOUND') setState({ status: 'free' });
        else setState((current) => (current.status === 'loading' ? { status: 'error' } : current));
      },
    );
  }, [table.id]);

  useEffect(() => {
    load();
  }, [load]);
  useOnConnect(load);
  // La table a changé (nouvelle commande, encaissement…) : on relit ses commandes.
  useRealtimeEvent('table:updated', (updated) => {
    if (updated.id === table.id) load();
  });

  const title = `${t('table.label')} ${String(table.number)}`;

  return (
    <>
      <button type="button" className="back" onClick={onBack}>
        ‹ {t('table.back')}
      </button>
      <header className="table-head">
        <h1 className="title">{title}</h1>
        {state.status === 'open' && (
          <p className="table-head__total">
            <span className="table-head__total-label">{t('table.total')}</span>
            {formatPrice(state.detail.session.total)}
          </p>
        )}
      </header>

      {state.status === 'open' && (
        <p className="table-head__meta">
          {openedText(state.detail.session.principal?.name ?? null, state.detail.session.openedAt)}
        </p>
      )}

      {table.pendingOrders > 0 && (
        <div className="alert">
          <span className="table-tile__badge table-tile__badge--inline" aria-hidden="true">
            {table.pendingOrders}
          </span>
          <p className="alert__text">{pendingText(table.pendingOrders)}</p>
        </div>
      )}
      {state.status === 'open' &&
        state.detail.orders
          .filter((order) => order.pos?.status === 'failed')
          .map((order) => (
            <div key={order.id} className="alert alert--danger">
              <span className="alert__icon">
                <StateIcon state="failed" />
              </span>
              <p className="alert__text">
                {t('table.failedAlert')} {timeLabel(order)}
              </p>
            </div>
          ))}

      {state.status === 'loading' && (
        <p className="body" role="status">
          {t('table.loading')}
        </p>
      )}
      {state.status === 'error' && (
        <div className="notice" role="alert">
          <p className="body">{t('table.error')}</p>
          <button type="button" className="button" onClick={load}>
            {t('session.retry')}
          </button>
        </div>
      )}
      {state.status === 'free' && <p className="body">{t('table.freeBody')}</p>}

      {state.status === 'open' &&
        state.detail.orders.map((order) => <OrderCard key={order.id} order={order} />)}
    </>
  );
}

// « Caisse d'Amira, ouverte à 09:05 », ou « Ouverte à 09:05 » sans principal.
function openedText(principal: string | null, openedAt: string): string {
  const time = clock.format(new Date(openedAt));
  if (!principal) return `${t('table.openedAt')} ${time}`;
  return `${t('table.cash')} ${ofName(principal)}, ${t('table.openedAt').toLowerCase()} ${time}`;
}

// État en caisse : une icône par état, la couleur danger seulement pour l'échec.
const POS_ICON: Record<NonNullable<Order['pos']>['status'], IconState> = {
  not_sent: 'waiting',
  queued: 'waiting',
  entered: 'done',
  failed: 'failed',
  manual: 'manual',
};

function OrderCard({ order }: { order: Order }) {
  const pos = order.pos?.status;
  return (
    <article
      className="ticket ticket--receipt"
      aria-label={`${t(`table.source.${order.source}`)} ${timeLabel(order)}`}
    >
      <header className="ticket__head">
        <h2 className="ticket__place">
          {t(`table.source.${order.source}`)}, {timeLabel(order)}
        </h2>
        {pos && (
          <span className={pos === 'failed' ? 'status-chip status-chip--danger' : 'status-chip'}>
            <StateIcon state={POS_ICON[pos]} size={16} />
            {t(`table.pos.${pos}`)}
          </span>
        )}
      </header>
      <ul className="ticket__lines">
        {order.lines.map((line) => (
          <OrderLineRow key={line.id} line={line} />
        ))}
      </ul>
      {(order.ready.bar || order.ready.kitchen) && (
        <p className="ticket__ready">
          {order.ready.bar && (
            <span className="status-chip status-chip--ready">
              <StateIcon state="bar" size={16} />
              {t('table.ordersReadyBar')}
            </span>
          )}
          {order.ready.kitchen && (
            <span className="status-chip status-chip--ready">
              <StateIcon state="kitchen" size={16} />
              {t('table.ordersReadyKitchen')}
            </span>
          )}
        </p>
      )}
      <p className="ticket__total">
        <span className="ticket__total-label">{t('table.total')}</span>
        {formatPrice(order.total)}
      </p>
    </article>
  );
}

/** Une ligne de commande : quantité, nom, choix, note, prix (ou ANNULÉ / TRANSFÉRÉ). */
export function OrderLineRow({ line }: { line: OrderLine }) {
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
      {off ? (
        <span className="ticket__flag">
          {t(line.status === 'cancelled' ? 'station.cancelled' : 'station.transferred')}
        </span>
      ) : (
        <span className="ticket__price">{formatPrice(line.lineTotal)}</span>
      )}
    </li>
  );
}
