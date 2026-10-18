import { t } from '../i18n/fr';

// Android, Chrome, Edge : le navigateur propose l'installation ; l'app ne bloque pas.
export function InstallBanner({ onInstall }: { onInstall: () => Promise<void> }) {
  return (
    <aside className="install-banner">
      <p className="install-banner__text">{t('install.hint')}</p>
      <button type="button" className="button button--secondary" onClick={() => void onInstall()}>
        {t('install.button')}
      </button>
    </aside>
  );
}
