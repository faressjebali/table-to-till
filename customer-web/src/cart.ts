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

let nextKey = 0;
const newKey = () => `ligne-${String((nextKey += 1))}`;

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
