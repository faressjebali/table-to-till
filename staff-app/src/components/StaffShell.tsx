import { useState } from 'react';
import type { Me } from '../api/types';
import { t } from '../i18n/fr';
import { navigationFor, type Destination } from '../navigation';
import { MeScreen } from './MeScreen';
import { OffShiftScreen } from './OffShiftScreen';
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
type ShellProps = { me: Me; onLogout: () => void; onShiftChange: () => Promise<void> };

export function StaffShell(props: ShellProps) {
  const { me } = props;
  return (
    <RealtimeProvider key={`${String(me.id)}-${String(me.onShift)}`}>
      <Screens {...props} />
    </RealtimeProvider>
  );
}

function Screens({ me, onLogout, onShiftChange }: ShellProps) {
  const navigation = navigationFor(me);
  const [selected, setSelected] = useState<Destination | null>(null);
  // Écran ouvert depuis « Moi » (ex. la Carte d'un serveur), avec un bouton Retour.
  const [opened, setOpened] = useState<Destination | null>(null);

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
  const active = selected && navigation.tabs.includes(selected) ? selected : first;
  const sub = opened && active === 'me' && navigation.more.includes(opened) ? opened : null;

  const select = (destination: Destination) => {
    setSelected(destination);
    setOpened(null);
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
            <TabIcon destination={destination} />
            <span className="tabbar__label">{t(`screen.${destination}`)}</span>
          </button>
        ))}
      </nav>
    </>
  );
}
