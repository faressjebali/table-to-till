import { t } from '../i18n/fr';
import type { Destination } from '../navigation';

// Écran pas encore construit : son titre, et « bientôt ». `onBack` : ouvert depuis « Moi ».
export function PlaceholderScreen({
  destination,
  onBack,
}: {
  destination: Destination;
  onBack?: () => void;
}) {
  return (
    <>
      {onBack && (
        <button type="button" className="back" onClick={onBack}>
          ‹ {t('nav.back')}
        </button>
      )}
      <h1 className="title">{t(`screen.${destination}`)}</h1>
      <p className="body">{t('screen.soon')}</p>
    </>
  );
}
