import type { Me } from '../api/types';
import { t } from '../i18n/fr';
import type { Destination } from '../navigation';
import { AccountSummary } from './AccountSummary';
import { TabIcon } from './TabIcon';

// Onglet « Moi » : le compte, les écrans sans place dans la barre, la déconnexion.
// « Terminer mon shift » arrive plus tard.
export function MeScreen({
  me,
  more,
  onOpen,
  onLogout,
}: {
  me: Me;
  more: Destination[];
  onOpen: (destination: Destination) => void;
  onLogout: () => void;
}) {
  return (
    <>
      <AccountSummary me={me} />
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
      <button type="button" className="button button--secondary" onClick={onLogout}>
        {t('session.logout')}
      </button>
    </>
  );
}
