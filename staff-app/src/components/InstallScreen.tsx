import { useState } from 'react';
import { t, type MessageKey } from '../i18n/fr';

// iPhone pas encore installé : l'app bloque et montre comment l'ajouter à l'écran d'accueil.
// Les étapes dépendent du navigateur ; un navigateur intégré (Facebook, Instagram…) ne sait pas
// installer : il faut d'abord ouvrir le lien dans Safari, d'où « Copier le lien ».
export function InstallScreen({ browser }: { browser: 'safari' | 'other' | 'in-app' }) {
  const steps: MessageKey[] =
    browser === 'in-app'
      ? ['install.openSafari', 'install.step1.safari', 'install.step2', 'install.step3']
      : [
          browser === 'other' ? 'install.step1.other' : 'install.step1.safari',
          'install.step2',
          'install.step3',
        ];

  return (
    <main className="install">
      <img
        className="install__icon"
        src="/icons/apple-touch-icon.png"
        alt=""
        width={96}
        height={96}
      />
      <h1 className="install__title">{t('install.title')}</h1>
      <p className="install__why">{t('install.why')}</p>
      <ol className="install__steps">
        {steps.map((step) => (
          <li key={step}>
            <span className="install__step-text">{t(step)}</span>
            {step.startsWith('install.step1') && <ShareIcon />}
          </li>
        ))}
      </ol>
      {browser !== 'in-app' && <p className="install__why">{t('install.noOption')}</p>}
      <CopyLink />
    </main>
  );
}

// Copier l'adresse de l'app, pour la coller dans Safari.
function CopyLink() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      // Presse-papiers refusé : l'adresse reste affichée en dessous, à recopier.
    }
  };

  return (
    <div className="install__copy">
      <button type="button" className="button button--secondary" onClick={() => void copy()}>
        {t('install.copy')}
      </button>
      <p className="install__url" role="status">
        {copied ? t('install.copied') : window.location.host}
      </p>
    </div>
  );
}

// Icône « Partager » d'iOS (carré et flèche vers le haut), pour la reconnaître dans le navigateur.
function ShareIcon() {
  return (
    <svg
      className="install__share"
      viewBox="0 0 24 24"
      width="28"
      height="28"
      role="img"
      aria-label={t('install.shareIcon')}
    >
      <path
        d="M12 3v12M8 7l4-4 4 4M6 11H5v10h14V11h-1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
