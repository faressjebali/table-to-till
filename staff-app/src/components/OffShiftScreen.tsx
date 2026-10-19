import type { Me } from '../api/types';
import { t } from '../i18n/fr';
import { AccountSummary } from './AccountSummary';

// Serveur, barista ou cuisinier hors shift : rien d'autre que « Démarrer mon shift » (bouton).
export function OffShiftScreen({ me, onLogout }: { me: Me; onLogout: () => void }) {
  return (
    <>
      <AccountSummary me={me} />
      <p className="body">{t('offShift.body')}</p>
      <button type="button" className="button button--secondary" onClick={onLogout}>
        {t('session.logout')}
      </button>
    </>
  );
}
