import type { Me } from '../api/types';
import { t } from '../i18n/fr';
import type { Destination } from '../navigation';
import { AccountSummary } from './AccountSummary';
import { EndShift } from './EndShift';
import { OnShiftList } from './OnShiftList';
import { TabIcon } from './TabIcon';

// Onglet « Moi » : le compte, qui est en shift, les écrans sans place dans la barre, la fin de
// shift et la déconnexion.
export function MeScreen({
  me,
  more,
  onOpen,
  onLogout,
  onEnded,
}: {
  me: Me;
  more: Destination[];
  onOpen: (destination: Destination) => void;
  onLogout: () => void;
  onEnded: () => Promise<void>;
}) {
  // La manager et le comptable n'ont pas de shift ; le principal finit par la clôture.
  const shiftRole = me.role === 'waiter' || me.role === 'barista' || me.role === 'chef';
  return (
    <>
      <AccountSummary me={me} />
      {shiftRole && me.onShift && <OnShiftList />}
      {more.length > 0 && (
        <ul className="rows">
          {more.map((destination) => (
            <li key={destination}>
              <button type="button" className="row" onClick={() => onOpen(destination)}>
                <TabIcon destination={destination} />
                <span className="row__label">{t(`screen.${destination}`)}</span>
                <span className="row__chevron" aria-hidden="true">
                  ›
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {shiftRole && me.onShift && !me.principal && <EndShift onEnded={onEnded} />}
      <button type="button" className="button button--secondary" onClick={onLogout}>
        {t('session.logout')}
      </button>
    </>
  );
}
