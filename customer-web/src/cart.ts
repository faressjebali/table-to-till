import type { ChoiceGroupKey, MenuItem, Millimes } from './api/types';

export const MAX_QUANTITY = 20;
export const MAX_NOTE_LENGTH = 200;

/** Un choix de formule ou de Kids Menu, au format de `POST /orders`. */
export interface LineChoice {
  group: ChoiceGroupKey;
  menuItemId: number;
}

/**
 * Une ligne du panier, au format d'une ligne de `POST /orders` (docs/api.md § 3),
 * plus une clé locale pour l'affichage. `choices` est vide pour un article sans choix.
 */
export interface CartLine {
  key: string;
  menuItemId: number;
  quantity: number;
  note: string | null;
  choices: LineChoice[];
}

/** Ce que le client a préparé dans la fiche d'un article. */
export interface SheetSelection {
  item: MenuItem;
  quantity: number;
  note: string;
  choices: LineChoice[];
  /** Extras suggérés cochés : chacun devient une ligne séparée de quantité 1. */
  extraIds: number[];
}

// Clé locale unique, même face aux lignes restaurées après un rechargement de la page.
let nextKey = 0;
const newKey = () => `ligne-${Date.now().toString(36)}-${String((nextKey += 1))}`;

/** Lignes ajoutées au panier : l'article, puis une ligne par extra coché (quantité 1). */
export function linesFromSelection(selection: SheetSelection): CartLine[] {
  const note = selection.note.trim();
  const main: CartLine = {
    key: newKey(),
    menuItemId: selection.item.id,
    quantity: selection.quantity,
    note: note === '' ? null : note,
    choices: selection.choices,
  };
  const extras = selection.extraIds.map((id): CartLine => ({
    key: newKey(),
    menuItemId: id,
    quantity: 1,
    note: null,
    choices: [],
  }));
  return [main, ...extras];
}

/**
 * Total indicatif en millimes (le serveur fait foi). Le prix d'une option de formule est
 * ignoré : il est inclus dans la formule.
 */
export function linesTotal(lines: CartLine[], items: Map<number, MenuItem>): Millimes {
  return lines.reduce(
    (total, line) => total + (items.get(line.menuItemId)?.price ?? 0) * line.quantity,
    0,
  );
}

/** Nombre d'articles (somme des quantités). */
export const linesCount = (lines: CartLine[]) =>
  lines.reduce((count, line) => count + line.quantity, 0);

/** Change la quantité d'une ligne (bornée à 1–20). */
export function setLineQuantity(lines: CartLine[], key: string, quantity: number): CartLine[] {
  const bounded = Math.min(MAX_QUANTITY, Math.max(1, quantity));
  return lines.map((line) => (line.key === key ? { ...line, quantity: bounded } : line));
}

export const removeLine = (lines: CartLine[], key: string) =>
  lines.filter((line) => line.key !== key);

/** Lignes au format de `POST /orders` : sans la clé locale, `choices` seulement s'il y en a. */
export const orderLines = (lines: CartLine[]) =>
  lines.map(({ menuItemId, quantity, note, choices }) =>
    choices.length > 0 ? { menuItemId, quantity, note, choices } : { menuItemId, quantity, note },
  );

/** Lignes touchées par un article refusé (l'article lui-même, ou un choix de formule). */
export const linesWithItem = (lines: CartLine[], menuItemId: number) =>
  lines.filter(
    (line) =>
      line.menuItemId === menuItemId || line.choices.some((c) => c.menuItemId === menuItemId),
  );

/** Identifiant anti-doublon de `POST /orders` (UUID). */
export function newRequestId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Navigateurs anciens sans randomUUID : UUID v4 depuis getRandomValues.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
