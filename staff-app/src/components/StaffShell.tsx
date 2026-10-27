import { useEffect, useState } from 'react';
import type { Me } from '../api/types';
import { t } from '../i18n/fr';
import { navigationFor, type Destination } from '../navigation';
import { orderFromUrl, usePendingOrders } from '../pendingOrders';
import { MeScreen } from './MeScreen';
import { OffShiftScreen } from './OffShiftScreen';
import { OrdersScreen } from './OrdersScreen';
import { PendingOrdersProvider } from './PendingOrdersProvider';
import { PlaceholderScreen } from './PlaceholderScreen';
import { PushPrompt } from './PushPrompt';
import { ReadyBanner } from './ReadyBanner';
import { RealtimeProvider } from './RealtimeProvider';
import { StationScreen } from './StationScreen';
import { TabIcon } from './TabIcon';
import { TablesScreen } from './TablesScreen';

// Écrans du compte connecté, selon son rôle et son shift (src/navigation.ts) : barre d'onglets en
// bas, utilisable d'une main ; « Moi » ouvre aussi les écrans qui n'ont pas de place dans la barre.
// La connexion temps réel est refaite quand le shift change : le serveur range chaque connexion
// selon le shift au moment où elle s'ouvre.
// `onShiftChange` : relit /me après « Démarrer » ou « Terminer mon shift ».
// Toucher la notification d'une nouvelle commande ouvre l'onglet Commandes sur elle : adresse
// `/?order=154` à l'ouverture de l'app, ou message du service worker (public/sw.js) si elle l'était.
type ShellProps = { me: Me; onLogout: () => void; onShiftChange: () => Promise<void> };

export function StaffShell(props: ShellProps) {
  const { me } = props;
  return (
    <RealtimeProvider key={`${String(me.id)}-${String(me.onShift)}`}>
      {me.role === 'waiter' && me.onShift ? (
        <PendingOrdersProvider>
          <Screens {...props} />
        </PendingOrdersProvider>
      ) : (
        <Screens {...props} />
      )}
    </RealtimeProvider>
  );
}

function Screens({ me, onLogout, onShiftChange }: ShellProps) {
  const navigation = navigationFor(me);
  const [selected, setSelected] = useState<Destination | null>(null);
  // Écran ouvert depuis « Moi » (ex. la Carte d'un serveur), avec un bouton Retour.
  const [opened, setOpened] = useState<Destination | null>(null);
  const [focusId, setFocusId] = useState<number | null>(() => orderFromUrl(location.href));

  useEffect(() => {
    // L'adresse de la notification ne doit pas rouvrir la commande au prochain rechargement.
    if (orderFromUrl(location.href) !== null)
      history.replaceState(null, '', import.meta.env.BASE_URL);
  }, []);
  useEffect(() => {
    const worker = 'serviceWorker' in navigator ? navigator.serviceWorker : null;
    if (!worker) return;
    const listener = (event: MessageEvent<{ type?: string; url?: string }>) => {
      if (event.data.type !== 'open' || !event.data.url) return;
      const id = orderFromUrl(event.data.url);
      if (id === null) return;
      setFocusId(id);
      setSelected('orders');
      setOpened(null);
    };
    worker.addEventListener('message', listener);
    return () => {
      worker.removeEventListener('message', listener);
    };
  }, []);

  // « Activer les notifications » : tous les rôles, même hors shift (docs/api.md § 5).
  if (!navigation) {
    return (
      <>
        <PushPrompt />
        <OffShiftScreen me={me} onLogout={onLogout} onStarted={onShiftChange} />
      </>
    );
  }

  // Les onglets changent (renfort devenu principal à 15h00…) : un onglet disparu ramène au premier.
  const first = navigation.tabs[0] ?? 'me';
  const wanted = selected ?? (focusId !== null ? 'orders' : null);
  const active = wanted && navigation.tabs.includes(wanted) ? wanted : first;
  const sub = opened && active === 'me' && navigation.more.includes(opened) ? opened : null;

  const select = (destination: Destination) => {
    setSelected(destination);
    setOpened(null);
    setFocusId(null);
  };

  return (
    <>
      <div className="shell">
        {me.role === 'waiter' && <ReadyBanner />}
        <PushPrompt />
        {sub ? (
          <PlaceholderScreen destination={sub} onBack={() => setOpened(null)} />
        ) : active === 'me' ? (
          <MeScreen
            me={me}
            more={navigation.more}
            onOpen={setOpened}
            onLogout={onLogout}
            onEnded={onShiftChange}
          />
        ) : active === 'bar' || active === 'kitchen' ? (
          <StationScreen key={active} station={active} />
        ) : active === 'tables' ? (
          <TablesScreen me={me} />
        ) : active === 'orders' ? (
          <OrdersScreen focusId={focusId} />
        ) : (
          <PlaceholderScreen destination={active} />
        )}
      </div>
      <nav className="tabbar" aria-label={t('nav.label')}>
        {navigation.tabs.map((destination) => (
          <button
            key={destination}
            type="button"
            className="tabbar__tab"
            aria-current={destination === active ? 'page' : undefined}
            onClick={() => select(destination)}
          >
            {destination === 'orders' ? (
              <OrdersTab />
            ) : (
              <>
                <TabIcon destination={destination} />
                <span className="tabbar__label">{t(`screen.${destination}`)}</span>
              </>
            )}
          </button>
        ))}
      </nav>
    </>
  );
}

// Onglet Commandes : pastille orange avec le nombre de commandes à confirmer, lue aussi par le
// lecteur d'écran (« Commandes, 2 à confirmer »).
function OrdersTab() {
  const count = usePendingOrders()?.orders.length ?? 0;
  return (
    <>
      <span className="tabbar__icon">
        <TabIcon destination="orders" />
        {count > 0 && (
          <span className="tabbar__badge" aria-hidden="true">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </span>
      <span className="tabbar__label">{t('screen.orders')}</span>
      {count > 0 && (
        <span className="visually-hidden">{`, ${String(count)} ${t('orders.waiting')}`}</span>
      )}
    </>
  );
}
