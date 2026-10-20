import { useId } from 'react';
import type { Room } from '../api/types';
import { t } from '../i18n/fr';
import { ROOMS } from '../roomChoice';

// Choix de la salle du plan des tables (docs/design.md, choix segmenté) : son nom, son nombre de
// tables, et une pastille quand une table de l'autre salle attend une action (à confirmer, prête).
export function RoomSwitch({
  room,
  counts,
  waiting,
  onChange,
}: {
  room: Room;
  counts: Record<Room, number>;
  /** Tables qui attendent une action, par salle ; la pastille ne s'affiche que hors de la salle vue. */
  waiting: Record<Room, number>;
  onChange: (room: Room) => void;
}) {
  const name = useId();
  return (
    <fieldset className="segmented">
      <legend className="visually-hidden">{t('tables.room')}</legend>
      <div className="segmented__options">
        {ROOMS.map((option) => {
          const badge = option !== room ? waiting[option] : 0;
          return (
            <label key={option} className="segmented__option">
              <input
                type="radio"
                name={name}
                value={option}
                checked={room === option}
                onChange={() => onChange(option)}
              />
              <span>
                {t(`room.${option}`)} <span className="segmented__count">{counts[option]}</span>
              </span>
              {badge > 0 && (
                <span className="segmented__badge">
                  {badge}
                  <span className="visually-hidden"> {t('tables.waitingThere')}</span>
                </span>
              )}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
