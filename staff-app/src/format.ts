import type { Role } from './api/types';
import { t } from './i18n/fr';

// Espace insécable : « 5,5 » et « DT » restent sur la même ligne.
const NBSP = '\u00a0';

/**
 * Prix comme sur le menu papier (`12 DT`, `5,5 DT`), même règle que le menu QR.
 * Calcul sur les millimes entiers : pas de flottant.
 */
export function formatPrice(millimes: number): string {
  return `${formatAmount(millimes)}${NBSP}DT`;
}

/** Montant sans « DT » (`12`, `5,5`) : sur une table du plan, où la place manque. */
export function formatAmount(millimes: number): string {
  const dinars = Math.floor(millimes / 1000);
  const rest = String(millimes % 1000)
    .padStart(3, '0')
    .replace(/0+$/, '');
  return `${String(dinars)}${rest === '' ? '' : `,${rest}`}`;
}

/** Rôle et titre d'un compte (« Manager · Patronne ») ; le rôle seul si le titre le répète. */
export function roleLabel(role: Role, title: string | null | undefined): string {
  const name = t(`role.${role}`);
  return title && title !== name ? `${name} · ${title}` : name;
}
