import type { StaffOrderLine } from './api/client';
import type { ChoiceGroup, MenuItem, MenuResponse } from './api/types';

// Commande saisie par un serveur pour une table (docs/product.md § 5, « Saisir une commande ») :
// mêmes lignes que le menu QR (docs/api.md § 3) : quantité 1–20, note de 200 caractères au plus,
// choix complets pour une formule, chaque extra sur une ligne à part. Le serveur calcule les prix ;
// le total affiché ici est indicatif.

export const MAX_QUANTITY = 20;
export const MAX_NOTE_LENGTH = 200;
export const MAX_LINES = 30;

export interface DraftChoice {
  group: string;
  menuItemId: number;
}

/** Une ligne du brouillon, avec une clé locale pour l'affichage. */
export interface DraftLine {
  key: string;
  menuItemId: number;
  quantity: number;
  note: string | null;
  choices: DraftChoice[];
}

/** Ce que le serveur a préparé dans la fiche d'un article. */
export interface Selection {
  item: MenuItem;
  quantity: number;
  note: string;
  choices: DraftChoice[];
  /** Extras suggérés cochés : chacun devient une ligne de quantité 1. */
  extraIds: number[];
}

let nextKey = 0;
const newKey = () => `ligne-${String((nextKey += 1))}`;

const clamp = (quantity: number) => Math.min(MAX_QUANTITY, Math.max(1, quantity));

/** Une ligne sans note ni choix : « + » sur le même article l'augmente au lieu d'en créer une. */
const isPlain = (line: DraftLine) => line.note === null && line.choices.length === 0;

/** « + » dans la carte : 1 de plus de l'article (sans choix), sur sa ligne simple s'il en a une. */
export function quickAdd(lines: DraftLine[], menuItemId: number): DraftLine[] {
  const plain = lines.find((line) => line.menuItemId === menuItemId && isPlain(line));
  if (plain) return setQuantity(lines, plain.key, plain.quantity + 1);
  return [...lines, { key: newKey(), menuItemId, quantity: 1, note: null, choices: [] }];
}

/** Lignes ajoutées depuis la fiche : l'article, puis une ligne par extra coché. */
export function addSelection(lines: DraftLine[], selection: Selection): DraftLine[] {
  const note = selection.note.trim();
  let next: DraftLine[] = [
    ...lines,
    {
      key: newKey(),
      menuItemId: selection.item.id,
      quantity: clamp(selection.quantity),
      note: note === '' ? null : note.slice(0, MAX_NOTE_LENGTH),
      choices: selection.choices,
    },
  ];
  for (const id of selection.extraIds) next = quickAdd(next, id);
  return next;
}

/** Quantité d'une ligne, bornée à 1–20. */
export function setQuantity(lines: DraftLine[], key: string, quantity: number): DraftLine[] {
  return lines.map((line) => (line.key === key ? { ...line, quantity: clamp(quantity) } : line));
}

export const removeLine = (lines: DraftLine[], key: string) =>
  lines.filter((line) => line.key !== key);

/** Total indicatif en millimes ; le prix d'une option de formule est inclus dans la formule. */
export const draftTotal = (lines: DraftLine[], items: Map<number, MenuItem>) =>
  lines.reduce((sum, line) => sum + (items.get(line.menuItemId)?.price ?? 0) * line.quantity, 0);

/** Nombre d'articles (somme des quantités). */
export const draftCount = (lines: DraftLine[]) =>
  lines.reduce((count, line) => count + line.quantity, 0);

/** Combien de cet article sont déjà dans le brouillon (toutes ses lignes). */
export const countOf = (lines: DraftLine[], menuItemId: number) =>
  lines.reduce((n, line) => (line.menuItemId === menuItemId ? n + line.quantity : n), 0);

/** Lignes au format de `POST /staff-orders`. */
export const orderLines = (lines: DraftLine[]): StaffOrderLine[] =>
  lines.map(({ menuItemId, quantity, note, choices }) =>
    choices.length > 0 ? { menuItemId, quantity, note, choices } : { menuItemId, quantity, note },
  );

/** Lignes touchées par un article refusé (l'article lui-même, ou un choix de formule). */
export const linesWithItem = (lines: DraftLine[], menuItemId: number) =>
  lines.filter(
    (line) =>
      line.menuItemId === menuItemId || line.choices.some((c) => c.menuItemId === menuItemId),
  );

/** Tous les articles de la carte, par id. */
export function itemsById(menu: MenuResponse): Map<number, MenuItem> {
  return new Map(menu.categories.flatMap((category) => category.items.map((i) => [i.id, i])));
}

/** Change la disponibilité d'un article reçue par `menu:updated`. */
export function applyMenuUpdate(
  menu: MenuResponse,
  update: {
    menuItemId: number;
    available: boolean;
    unavailableReason: MenuItem['unavailableReason'];
  },
): MenuResponse {
  return {
    ...menu,
    categories: menu.categories.map((category) => ({
      ...category,
      items: category.items.map((item) =>
        item.id === update.menuItemId
          ? { ...item, available: update.available, unavailableReason: update.unavailableReason }
          : item,
      ),
    })),
  };
}

/** Groupes de choix de l'article, dans son ordre. */
export function groupsOf(item: MenuItem, groups: ChoiceGroup[]): ChoiceGroup[] {
  return item.choiceGroups.flatMap((key) => {
    const group = groups.find((g) => g.key === key);
    return group ? [group] : [];
  });
}

/** Un article hors de ses horaires (Plat de la semaine le week-end…) n'apparaît pas. */
export const isShown = (item: MenuItem) => item.unavailableReason !== 'outside_hours';

// Recherche sans accents ni majuscules : « oeuf » trouve « Œufs brouillés ».
const fold = (text: string) =>
  text.toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae').normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Vrai si le nom (fr ou en) ou le code caisse de l'article contient chaque mot cherché. */
export function matches(item: MenuItem, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = fold(`${item.name.fr} ${item.name.en} ${item.posCode ?? ''}`);
  return words.every((word) => text.includes(word));
}

/** Identifiant anti-doublon de `POST /staff-orders` (UUID). */
export function newRequestId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Brouillon de chaque table, gardé tant que l'app est ouverte : le serveur peut aller confirmer
// une commande QR (onglet Commandes) et retrouver sa saisie en revenant.
const drafts = new Map<number, DraftLine[]>();
export const loadDraft = (tableId: number) => drafts.get(tableId) ?? [];
export function saveDraft(tableId: number, lines: DraftLine[]) {
  if (lines.length === 0) drafts.delete(tableId);
  else drafts.set(tableId, lines);
}
/** Pour les tests. */
export const clearDrafts = () => drafts.clear();
