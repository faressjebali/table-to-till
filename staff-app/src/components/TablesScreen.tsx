import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { getCurrentShifts, getTables } from '../api/client';
import type { Me, Room, Table } from '../api/types';
import { formatAmount } from '../format';
import { t } from '../i18n/fr';
import { clearReadyTables, useReadyItems } from '../readyTables';
import { useOnConnect, useRealtimeEvent } from '../realtime';
import { drawRoom, tableDescription, upsertTable } from '../tablePlan';
import { loadRoom, ROOMS, saveRoom } from '../roomChoice';
import { RoomSwitch } from './RoomSwitch';
import { StateIcon } from './StateIcon';
import { TableDetail } from './TableDetail';
import { TableTile } from './TableTile';
import { TablesLegend } from './TablesLegend';

type Status = 'loading' | 'error' | 'ready';
/** Tables mises en évidence par une puce du résumé. */
type Filter = 'occupied' | 'free' | 'pending' | 'ready' | `other-${string}`;
type Station = 'bar' | 'kitchen';

// Plan des tables (docs/product.md § 5, écrans du serveur ; apparence : docs/design.md) : deux salles,
// intérieur et terrasse, chacune entière sur l'écran, l'état de chaque table et son montant, à jour
// en temps réel. Au-dessus, un résumé des deux salles dont chaque puce met ses tables en évidence
// (et va dans la bonne salle), la légende, puis le choix de la salle. Un tap ouvre les commandes.
export function TablesScreen({ me }: { me: Me }) {
  const [status, setStatus] = useState<Status>('loading');
  const [tables, setTables] = useState<Table[]>([]);
  // Noms des principaux en shift : pendant la passation, la caisse de chaque table.
  const [principals, setPrincipals] = useState<Map<number, string>>(new Map());
  const [openId, setOpenId] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);
  const [room, setRoom] = useState<Room>(loadRoom);
  const readyItems = useReadyItems();

  // Plan complet : à l'ouverture et à chaque (re)connexion (les événements de la coupure sont perdus).
  const load = useCallback(() => {
    getTables().then(
      ({ tables: list }) => {
        setTables(list);
        setStatus('ready');
        // Une table libre n'a plus rien à apporter (encaissée pendant que l'app était fermée).
        clearReadyTables(list.filter((table) => table.state === 'free').map((table) => table.id));
      },
      () => {
        // Plan déjà affiché : on le garde, la prochaine reconnexion le rechargera.
        setStatus((current) => (current === 'loading' ? 'error' : current));
      },
    );
    getCurrentShifts().then(
      ({ waiters }) => {
        setPrincipals(new Map(waiters.filter((w) => w.principal).map((w) => [w.id, w.name])));
      },
      () => undefined,
    );
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  useOnConnect(load);
  useRealtimeEvent('table:updated', (table) => {
    setTables((list) => upsertTable(list, table));
  });

  const opened = openId === null ? undefined : tables.find((table) => table.id === openId);
  if (opened) return <TableDetail table={opened} onBack={() => setOpenId(null)} />;

  // Pendant une passation, il y a des tables de deux principaux : on montre celles qui ne sont pas
  // dans ma caisse (un renfort en voit donc deux).
  const owners = new Set(tables.flatMap((table) => (table.principalId ? [table.principalId] : [])));
  const otherIds = owners.size > 1 ? [...owners].filter((id) => id !== me.id) : [];
  const nameOf = (id: number) => principals.get(id) ?? '?';
  const isOther = (table: Table) =>
    table.principalId !== null && otherIds.includes(table.principalId);
  const readyOf = (table: Table): Station[] => {
    const stations = new Set(
      readyItems.filter((item) => item.tableId === table.id).map((item) => item.station),
    );
    return (['bar', 'kitchen'] as const).filter((station) => stations.has(station));
  };
  const matches = (key: Filter, table: Table): boolean => {
    switch (key) {
      case 'occupied':
        return table.state === 'occupied';
      case 'free':
        return table.state === 'free';
      case 'pending':
        return table.pendingOrders > 0;
      case 'ready':
        return readyOf(table).length > 0;
      default:
        return table.principalId === Number(key.slice('other-'.length));
    }
  };

  const onPlan = tables.filter((table) => table.layout);
  const inRoom = (r: Room) => onPlan.filter((table) => table.layout?.room === r);
  const count = (key: Filter) => onPlan.filter((table) => matches(key, table)).length;
  const occupied = count('occupied');
  const pending = onPlan.reduce((sum, table) => sum + table.pendingOrders, 0);
  const ready = count('ready');
  // Ce qui attend une action dans une salle : à confirmer ou prêt (l'échec caisse plus tard).
  const waitingIn = (r: Room) =>
    inRoom(r).filter((table) => table.pendingOrders > 0 || readyOf(table).length > 0).length;
  const plan = drawRoom(inRoom(room));

  const chooseRoom = (next: Room) => {
    setRoom(next);
    saveRoom(next);
  };
  // Une puce met ses tables en évidence ; s'il n'y en a que dans l'autre salle, on y va.
  const choose = (key: Filter) => {
    const next = filter === key ? null : key;
    setFilter(next);
    if (next === null) return;
    const here = inRoom(room).some((table) => matches(next, table));
    const other = ROOMS.find((r) => r !== room);
    if (!here && other && inRoom(other).some((table) => matches(next, table))) chooseRoom(other);
  };

  const chip = (key: Filter, icon: ReactNode, text: string) => (
    <li key={key}>
      <button
        type="button"
        className="chip"
        aria-pressed={filter === key}
        onClick={() => choose(key)}
      >
        {icon}
        {text}
      </button>
    </li>
  );

  return (
    <>
      <h1 className="visually-hidden">{t('screen.tables')}</h1>

      {status === 'loading' && (
        <p className="body" role="status">
          {t('tables.loading')}
        </p>
      )}
      {status === 'error' && (
        <div className="notice" role="alert">
          <p className="body">{t('tables.error')}</p>
          <button type="button" className="button" onClick={load}>
            {t('session.retry')}
          </button>
        </div>
      )}

      {status === 'ready' && (
        <>
          <ul className="chips" aria-label={t('tables.summary')}>
            {chip(
              'occupied',
              <span className="chip__swatch chip__swatch--occupied" aria-hidden="true" />,
              `${String(occupied)} ${t('tables.occupied')}`,
            )}
            {chip(
              'free',
              <span className="chip__swatch" aria-hidden="true" />,
              `${String(onPlan.length - occupied)} ${t('tables.free')}`,
            )}
            {pending > 0 &&
              chip(
                'pending',
                <span className="chip__swatch chip__swatch--pending" aria-hidden="true" />,
                `${String(pending)} ${t('tables.pending')}`,
              )}
            {ready > 0 &&
              chip(
                'ready',
                <span className="chip__icon chip__icon--ready" aria-hidden="true">
                  <StateIcon state="bar" size={14} />
                </span>,
                `${String(ready)} ${t('tables.ready')}`,
              )}
            {otherIds.map((id) => {
              const n = count(`other-${String(id)}`);
              return chip(
                `other-${String(id)}`,
                <span className="chip__icon chip__icon--other" aria-hidden="true">
                  <StateIcon state="person" size={14} />
                </span>,
                `${nameOf(id)} : ${String(n)} ${t(n > 1 ? 'tables.tablesOf' : 'tables.tableOf')}`,
              );
            })}
            <li>
              <button
                type="button"
                className="icon-button"
                aria-label={t('tables.legend')}
                aria-expanded={legendOpen}
                onClick={() => setLegendOpen((open) => !open)}
              >
                ?
              </button>
            </li>
          </ul>

          {legendOpen && <TablesLegend onClose={() => setLegendOpen(false)} />}

          <RoomSwitch
            room={room}
            counts={{ inside: inRoom('inside').length, terrace: inRoom('terrace').length }}
            waiting={{ inside: waitingIn('inside'), terrace: waitingIn('terrace') }}
            onChange={chooseRoom}
          />

          <div
            className="room"
            role="group"
            aria-label={t('tables.plan')}
            style={{ width: plan.width, height: plan.height }}
          >
            {plan.tables.map(({ table, left, top, width, height, round, long }) => {
              const other = isOther(table);
              const stations = readyOf(table);
              const dim = filter !== null && !matches(filter, table);
              return (
                <div
                  key={table.id}
                  className={dim ? 'room__cell room__cell--dim' : 'room__cell'}
                  style={{ left, top, width, height } as CSSProperties}
                >
                  <TableTile
                    number={table.number}
                    {...(table.state === 'occupied' && { amount: formatAmount(table.openTotal) })}
                    pending={table.pendingOrders}
                    ready={stations}
                    other={other}
                    round={round}
                    long={long}
                    label={tableDescription(
                      table,
                      other && table.principalId !== null ? nameOf(table.principalId) : null,
                      stations,
                    )}
                    onClick={() => setOpenId(table.id)}
                  />
                </div>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
