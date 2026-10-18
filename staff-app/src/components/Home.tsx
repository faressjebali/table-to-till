import type { Me } from '../api/types';
import { t } from '../i18n/fr';

// Accueil connecté, provisoire : les écrans de chaque rôle arrive plus tard.
export function Home({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const role = t(`role.${me.role}`);
  return (
    <>
      <h1 className="title">
        {t('home.hello')}, {me.name}
      </h1>
      <p className="badge">{me.title && me.title !== role ? `${role} · ${me.title}` : role}</p>
      <p className="body">{t('home.body')}</p>
      <button type="button" className="button button--secondary" onClick={onLogout}>
        {t('session.logout')}
      </button>
    </>
  );
}
