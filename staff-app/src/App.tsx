import { useState } from 'react';
import { ChangePasswordScreen } from './components/ChangePasswordScreen';
import { InstallBanner } from './components/InstallBanner';
import { InstallScreen, UpdateIosScreen } from './components/InstallScreen';
import { LoginScreen } from './components/LoginScreen';
import { StaffShell } from './components/StaffShell';
import { t } from './i18n/fr';
import { currentDevice, installGate, iosBrowser } from './install';
import { useInstallPrompt } from './useInstallPrompt';
import { useSession } from './useSession';

// App staff : installation d'abord (iPhone), puis connexion et, à la première connexion,
// changement du mot de passe temporaire. `requireInstall` : vrai dans la version construite
// (build, preview, déploiement), faux avec `npm run dev` (pas d'installation possible en http).
export function App({ requireInstall = import.meta.env.PROD }: { requireInstall?: boolean }) {
  const [device] = useState(currentDevice);
  const gate = installGate(device, requireInstall);

  if (gate === 'install-ios') return <InstallScreen browser={iosBrowser(device)} />;
  if (gate === 'update-ios') return <UpdateIosScreen />;
  return <StaffApp />;
}

function StaffApp() {
  const { state, login, changePassword, logout, retry } = useSession();
  const install = useInstallPrompt();
  const onLogout = () => void logout();

  // Android, Chrome, Edge : l'installation est proposée dès l'écran de connexion.
  const banner = install && <InstallBanner onInstall={install} />;

  if (state.status === 'signed-out') {
    return (
      <>
        <LoginScreen reason={state.reason} onLogin={login} />
        {banner && <div className="auth-footer">{banner}</div>}
      </>
    );
  }
  if (state.status === 'must-change-password') {
    return <ChangePasswordScreen onChange={changePassword} onLogout={onLogout} />;
  }

  return (
    <>
      <header className="header">
        {/* Icône de 180 px affichée à 32 : nette sur les écrans d'iPhone (3x) */}
        <img src="/icons/apple-touch-icon.png" alt="" width={32} height={32} />
        <p className="header__name">{t('app.name')}</p>
      </header>
      <main className="main">
        {state.status === 'checking' && (
          <p className="body" role="status">
            {t('session.loading')}
          </p>
        )}
        {state.status === 'offline' && (
          <div className="notice" role="alert">
            <h1 className="title">{t('session.offline.title')}</h1>
            <p className="body">{t('session.offline.body')}</p>
            <button type="button" className="button" onClick={retry}>
              {t('session.retry')}
            </button>
          </div>
        )}
        {state.status === 'signed-in' && <StaffShell me={state.me} onLogout={onLogout} />}
        {banner}
      </main>
    </>
  );
}
