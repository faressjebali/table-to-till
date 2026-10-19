import { useState } from 'react';
import { ApiError, endShift } from '../api/client';
import { t } from '../i18n/fr';

// « Terminer mon shift » : renfort, barista, cuisinier. Confirmation d'abord : un toucher par
// erreur couperait les commandes du téléphone. Le principal, lui, clôture.
export function EndShift({ onEnded }: { onEnded: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const end = async () => {
    setBusy(true);
    setError(null);
    try {
      await endShift();
      await onEnded();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : null;
      // Devenu principal entre-temps, ou shift déjà terminé (4h00) : /me remet l'écran à jour.
      if (code === 'INVALID_STATUS' || code === 'NOT_ON_SHIFT') {
        await onEnded();
        return;
      }
      setError(t(code === 'NETWORK' ? 'shift.error.network' : 'shift.error.other'));
      setBusy(false);
    }
  };

  if (!confirming) {
    return (
      <button
        type="button"
        className="button button--secondary"
        onClick={() => setConfirming(true)}
      >
        {t('shift.end')}
      </button>
    );
  }
  return (
    <div className="confirm" role="group" aria-label={t('shift.end')}>
      <p className="confirm__text">{t('shift.endConfirm')}</p>
      {error && (
        <p className="form__error" role="alert">
          {error}
        </p>
      )}
      <button type="button" className="button" disabled={busy} onClick={() => void end()}>
        {busy ? t('shift.ending') : t('shift.endYes')}
      </button>
      <button
        type="button"
        className="button button--secondary"
        disabled={busy}
        onClick={() => {
          setConfirming(false);
          setError(null);
        }}
      >
        {t('shift.endNo')}
      </button>
    </div>
  );
}
