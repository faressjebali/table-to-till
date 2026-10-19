import { useEffect, useState } from 'react';
import { getCurrentShifts } from '../api/client';
import type { CurrentShifts } from '../api/types';
import { t } from '../i18n/fr';

// Qui est en shift en ce moment : serveurs (principal ou renfort), baristas, cuisiniers.
export function OnShiftList() {
  const [shifts, setShifts] = useState<CurrentShifts | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    getCurrentShifts().then(setShifts, () => setFailed(true));
  }, []);

  if (failed) return <p className="body">{t('onShift.error')}</p>;
  if (!shifts) return null;

  const people = [
    ...shifts.waiters.map((w) => ({
      key: `w${String(w.id)}`,
      name: w.name,
      what: t(w.principal ? 'shift.principal' : 'shift.backup'),
    })),
    ...shifts.stations.map((s) => ({
      key: `s${String(s.id)}`,
      name: s.name,
      what: t(s.role === 'barista' ? 'role.barista' : 'role.chef'),
    })),
  ];

  return (
    <section className="on-shift" aria-labelledby="on-shift-title">
      <h2 id="on-shift-title" className="on-shift__title">
        {t('onShift.title')}
      </h2>
      <ul className="rows">
        {people.map((person) => (
          <li key={person.key} className="on-shift__row">
            <span className="row__label">{person.name}</span>
            <span className="on-shift__what">{person.what}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
