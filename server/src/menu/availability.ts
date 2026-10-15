// Disponibilité d'un article à un instant donné (docs/api.md § MenuItem).
// Les horaires sont en heure locale Africa/Tunis, quel que soit le fuseau du serveur.

export const TIME_ZONE = 'Africa/Tunis';
// Ouverture du café (docs/product.md § 1).
export const OPENING_TIME = '08:00';
export const CLOSING_TIME = '22:00';

export type UnavailableReason = 'sold_out' | 'outside_hours';

export type AvailabilityRule = {
  // 1 = lundi … 7 = dimanche.
  days: readonly number[];
  // "HH:MM" ou "HH:MM:SS" (format renvoyé par PostgreSQL), null = ouverture ou fermeture du café.
  from: string | null;
  until: string | null;
  soldOut: boolean;
};

const formatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const weekdays: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

// Jour de la semaine (1–7) et minutes depuis minuit, en heure de Tunis.
export function localTime(now: Date): { day: number; minutes: number } {
  const parts = Object.fromEntries(formatter.formatToParts(now).map((p) => [p.type, p.value]));
  const day = weekdays[parts['weekday'] ?? ''];
  if (day === undefined) throw new Error(`jour inattendu : ${String(parts['weekday'])}`);
  return { day, minutes: Number(parts['hour']) * 60 + Number(parts['minute']) };
}

function toMinutes(time: string): number {
  const [hours = '', minutes = ''] = time.split(':');
  return Number(hours) * 60 + Number(minutes);
}

// L'horaire propre d'un article s'applique en plus de l'ouverture du café.
// L'heure de fin est exclue : à 12h00 pile, les formules ne sont plus servies.
export function isWithinHours(rule: Omit<AvailabilityRule, 'soldOut'>, now: Date): boolean {
  const { day, minutes } = localTime(now);
  if (!rule.days.includes(day)) return false;
  const from = Math.max(toMinutes(OPENING_TIME), toMinutes(rule.from ?? OPENING_TIME));
  const until = Math.min(toMinutes(CLOSING_TIME), toMinutes(rule.until ?? CLOSING_TIME));
  return minutes >= from && minutes < until;
}

// Hors horaire l'emporte sur la rupture : l'article est alors masqué chez le client.
export function computeAvailability(
  rule: AvailabilityRule,
  now: Date,
): { available: boolean; unavailableReason: UnavailableReason | null } {
  if (!isWithinHours(rule, now)) return { available: false, unavailableReason: 'outside_hours' };
  if (rule.soldOut) return { available: false, unavailableReason: 'sold_out' };
  return { available: true, unavailableReason: null };
}
