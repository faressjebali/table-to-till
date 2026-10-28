import type { Me } from '../api/types';
import { roleLabel } from '../format';
import { t } from '../i18n/fr';

// Nom, puis rôle et titre du compte ; pour un serveur en shift, principal ou renfort.
export function AccountSummary({ me }: { me: Me }) {
  const shift =
    me.role === 'waiter' && me.onShift
      ? t(me.principal ? 'shift.principal' : 'shift.backup')
      : null;
  return (
    <>
      <h1 className="title">
        {t('home.hello')}, {me.name}
      </h1>
      <p className="badges">
        <span className="badge">{roleLabel(me.role, me.title)}</span>
        {shift && <span className="badge badge--accent">{shift}</span>}
      </p>
    </>
  );
}
