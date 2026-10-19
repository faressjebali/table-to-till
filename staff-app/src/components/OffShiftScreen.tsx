import { useState } from 'react';
import { ApiError, startShift } from '../api/client';
import type { Me } from '../api/types';
import { t } from '../i18n/fr';
import { AccountSummary } from './AccountSummary';

// Serveur, barista ou cuisinier hors shift : rien d'autre que « Démarrer mon shift ». Le premier
// serveur arrivé est principal, les suivants renforts (le choix « Shift 2 » arrive plus tard).
export function OffShiftScreen({
  me,
  onLogout,
  onStarted,
}: {
  me: Me;
  onLogout: () => void;
  onStarted: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      await startShift();
      await onStarted();
    } catch (err) {
      setError(
        t(
          err instanceof ApiError && err.code === 'NETWORK'
            ? 'shift.error.network'
            : 'shift.error.other',
        ),
      );
      setBusy(false);
    }
  };

  return (
    <>
      <AccountSummary me={me} />
      <p className="body">{t('offShift.body')}</p>
      {error && (
        <p className="form__error" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        className="button button--block"
        disabled={busy}
        onClick={() => void start()}
      >
        {busy ? t('shift.starting') : t('shift.start')}
      </button>
      <button type="button" className="button button--secondary" onClick={onLogout}>
        {t('session.logout')}
      </button>
    </>
  );
}
