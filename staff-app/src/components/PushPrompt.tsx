import { useEffect, useState } from 'react';
import { t } from '../i18n/fr';
import { enablePush, pushState, syncSubscription, type PushState } from '../push';

// Pour tous les rôles, même hors shift (docs/api.md § 5). Déjà accepté : le téléphone est
// réabonné à chaque ouverture, pour rester lié à la session en cours.
export function PushPrompt({ initial = pushState() }: { initial?: PushState }) {
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (initial === 'on') {
      syncSubscription().catch(() => {
        // Réessayé à la prochaine ouverture ; Socket.IO prévient toujours dans l'app.
      });
    }
  }, [initial]);

  const onEnable = async () => {
    setBusy(true);
    setFailed(false);
    try {
      setState(await enablePush());
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  if (state === 'unsupported' || state === 'on') return null;
  if (state === 'denied') {
    return (
      <aside className="push-banner">
        <p className="body">{t('push.denied')}</p>
      </aside>
    );
  }
  return (
    <aside className="push-banner">
      <p className="body">{t('push.hint')}</p>
      {failed && (
        <p className="form__error" role="alert">
          {t('push.error')}
        </p>
      )}
      <button type="button" className="button" disabled={busy} onClick={() => void onEnable()}>
        {busy ? t('push.busy') : t('push.button')}
      </button>
    </aside>
  );
}
