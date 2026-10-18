import { useState } from 'react';
import { InstallBanner } from './components/InstallBanner';
import { InstallScreen } from './components/InstallScreen';
import { t } from './i18n/fr';
import { currentDevice, installGate, iosBrowser } from './install';
import { useInstallPrompt } from './useInstallPrompt';

// Squelette de l'app staff : installation d'abord ; la connexion arrive plus tard.
// `requireInstall` : vrai dans la version construite (build, preview, déploiement), faux avec
// `npm run dev` (pas d'installation possible en http).
export function App({ requireInstall = import.meta.env.PROD }: { requireInstall?: boolean }) {
  const [device] = useState(currentDevice);
  const gate = installGate(device, requireInstall);
  const install = useInstallPrompt();

  if (gate === 'install-ios') return <InstallScreen browser={iosBrowser(device)} />;

  return (
    <>
      <header className="header">
        {/* Icône de 180 px affichée à 32 : nette sur les écrans d'iPhone (3x) */}
        <img src="/icons/apple-touch-icon.png" alt="" width={32} height={32} />
        <p className="header__name">{t('app.name')}</p>
      </header>
      <main className="main">
        <h1 className="title">{t('home.title')}</h1>
        <p className="body">{t('home.body')}</p>
        {install && <InstallBanner onInstall={install} />}
      </main>
    </>
  );
}
