import type { Order, OrderLine, StationName } from './api/types';
import { t } from './i18n/fr';

// Liste « À préparer » de l'écran bar / cuisine (docs/api.md § 5 ter), tenue à jour par les
// événements `station:order` et `station:updated`.

/** Reste-t-il quelque chose à préparer pour ce poste ? */
export const hasActiveLines = (order: Order) =>
  order.lines.some((line) => line.status === 'active');

const byConfirmation = (a: Order, b: Order) =>
  (a.confirmedAt ?? '').localeCompare(b.confirmedAt ?? '') || a.id - b.id;

/**
 * Ajoute ou remplace une commande reçue. Une commande prête à ce poste (ici ou sur un autre
 * téléphone) sort de la liste. Une commande déjà affichée dont toutes les lignes viennent d'être
 * annulées ou transférées reste, barrée, jusqu'à ce que le poste l'ait vue ; une nouvelle commande
 * sans rien à préparer n'entre pas.
 */
export function upsertOrder(list: Order[], order: Order, station: StationName): Order[] {
  const others = list.filter((o) => o.id !== order.id);
  if (order.ready[station]) return others;
  const shown = others.length !== list.length;
  if (!shown && !hasActiveLines(order)) return list;
  return [...others, order].sort(byConfirmation);
}

export const removeOrder = (list: Order[], orderId: number) => list.filter((o) => o.id !== orderId);

/** Lignes devenues annulées entre deux versions d'une commande (pour l'alerte). */
export function newlyCancelled(before: Order | undefined, after: Order): OrderLine[] {
  const was = new Map(before?.lines.map((line) => [line.id, line.status]));
  return after.lines.filter(
    (line) => line.status === 'cancelled' && was.get(line.id) !== 'cancelled',
  );
}

/** Où apporter la commande : « Table 7 », « Vente directe 333 », « 103 Nour Ben Salem ». */
export function placeLabel(order: Order): string {
  const number = String(order.table.number);
  if (order.offer) return `${number} ${order.offer.label}`;
  if (order.source === 'direct') return `${t('place.direct')} ${number}`;
  return `${t('place.table')} ${number}`;
}

const clock = new Intl.DateTimeFormat('fr-FR', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Africa/Tunis',
});

/** Heure de confirmation, à l'heure de Tunis (« 09:05 »). */
export const timeLabel = (order: Order) =>
  clock.format(new Date(order.confirmedAt ?? order.createdAt));
