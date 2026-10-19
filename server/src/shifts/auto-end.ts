import { audit, type Db } from '../db.js';
import { TIME_ZONE } from '../menu/availability.js';
import type { Realtime } from '../realtime.js';

// Délai entre deux passages de la fin automatique.
export const AUTO_END_SWEEP_MS = 60_000;

// Shifts oubliés (docs/api.md § 5) : chaque jour à SHIFT_AUTO_END_TIME (Africa/Tunis), les shifts
// encore ouverts démarrés avant cette heure se terminent, à cette heure-là. Rattrape aussi un
// passage manqué (serveur arrêté pendant la nuit).
// TODO : les serveurs aussi, avec la clôture automatique du principal.
export async function endForgottenShifts(
  db: Db,
  realtime: Realtime,
  now: Date,
  autoEndTime: string,
): Promise<number[]> {
  const { rows } = await db.query<{ id: number; user_id: number }>(
    `WITH local AS (SELECT ($1::timestamptz AT TIME ZONE $2) AS now),
          cutoff AS (
            SELECT (CASE WHEN local.now::time >= $3::time
                         THEN local.now::date + $3::time
                         ELSE local.now::date - 1 + $3::time END) AT TIME ZONE $2 AS at
              FROM local)
     UPDATE shifts s SET ended_at = cutoff.at
       FROM cutoff, users u
      WHERE u.id = s.user_id AND u.role <> 'waiter'
        AND s.ended_at IS NULL AND s.started_at < cutoff.at
      RETURNING s.id, s.user_id`,
    [now, TIME_ZONE, autoEndTime],
  );
  for (const row of rows) {
    await audit(db, {
      userId: null,
      action: 'shift.auto_ended',
      entityType: 'shift',
      entityId: row.id,
      details: { userId: row.user_id },
    });
    realtime.shiftEnded(row.user_id);
  }
  return rows.map((row) => row.id);
}

// Passage régulier, lancé au démarrage du serveur. Une erreur (base indisponible) est seulement
// journalisée : le passage suivant réessaie.
export function startShiftAutoEnd(db: Db, realtime: Realtime, autoEndTime: string): NodeJS.Timeout {
  return setInterval(() => {
    endForgottenShifts(db, realtime, new Date(), autoEndTime).catch((err: unknown) => {
      console.error('fin automatique des shifts :', err);
    });
  }, AUTO_END_SWEEP_MS);
}
