import type { Lang, Millimes } from './api/types';

// Espace insécable : « 5,5 » et « DT » restent sur la même ligne.
const NBSP = '\u00a0';

/**
 * Prix comme sur le menu papier : `12 DT`, `5,5 DT` (en anglais `5.5 DT`).
 * Calcul sur les millimes entiers : pas de flottant. Espace insécable avant « DT ».
 */
export function formatPrice(price: Millimes, lang: Lang): string {
  const dinars = Math.floor(price / 1000);
  const millimes = String(price % 1000)
    .padStart(3, '0')
    .replace(/0+$/, '');
  const separator = lang === 'fr' ? ',' : '.';
  return `${String(dinars)}${millimes === '' ? '' : separator + millimes}${NBSP}DT`;
}
