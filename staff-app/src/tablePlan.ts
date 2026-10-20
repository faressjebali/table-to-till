import type { Table } from './api/types';
import { formatPrice } from './format';
import { t } from './i18n/fr';

/** Table placée sur la grille : coordonnées décalées pour que le plan commence à la case (1, 1). */
export interface PlacedTable {
  table: Table;
  column: number;
  row: number;
  width: number;
  height: number;
  round: boolean;
}

/**
 * Plan de la salle (docs/tables.csv) : chaque table à sa case, sans les rangées et colonnes vides
 * du bord. Une table sans `layout` n'est pas sur le plan.
 */
export function placeTables(tables: Table[]): {
  placed: PlacedTable[];
  columns: number;
  rows: number;
} {
  const laidOut = tables.flatMap((table) =>
    table.layout ? [{ table, layout: table.layout }] : [],
  );
  if (laidOut.length === 0) return { placed: [], columns: 0, rows: 0 };
  const minX = Math.min(...laidOut.map(({ layout }) => layout.x));
  const minY = Math.min(...laidOut.map(({ layout }) => layout.y));
  const placed = laidOut.map(({ table, layout }) => ({
    table,
    column: layout.x - minX + 1,
    row: layout.y - minY + 1,
    width: layout.w,
    height: layout.h,
    round: layout.shape === 'round',
  }));
  return {
    placed,
    columns: Math.max(...placed.map((p) => p.column + p.width - 1)),
    rows: Math.max(...placed.map((p) => p.row + p.height - 1)),
  };
}

// Dimensions du plan (docs/design.md § Plan de la salle), en px.
export const PLAN = {
  /** Largeur d'une case, hauteur d'une rangée. */
  tile: 48,
  rowHeight: 60,
  /** Table ronde : diamètre. */
  round: 56,
  /** Écart minimal entre deux tables, en largeur comme en hauteur. */
  gap: 8,
  /** Entre deux colonnes qui n'ont jamais de table sur la même rangée. */
  near: 4,
} as const;

/** Table dessinée : position et taille en px dans sa salle. */
export interface DrawnTable {
  table: Table;
  left: number;
  top: number;
  width: number;
  height: number;
  round: boolean;
  long: boolean;
}

/**
 * Dessin d'une salle : chaque table à sa case, en gardant les positions relatives de la salle.
 * Deux colonnes qui ont des tables sur la même rangée sont à 8 px (plus 4 px par table ronde de
 * 56 px qui déborde de sa case) ; deux colonnes qui ne se font jamais face sont à 4 px : leurs
 * tables sont déjà séparées par les 8 px entre deux rangées. Une table longue garde 8 px entre
 * ses cases.
 */
export function drawRoom(tables: Table[]): { tables: DrawnTable[]; width: number; height: number } {
  const { placed, columns, rows } = placeTables(tables);
  const overhang = (p: PlacedTable) => (p.round ? (PLAN.round - PLAN.tile) / 2 : 0);
  // Écart à droite de chaque colonne (index 1 à columns - 1).
  const gaps = Array.from({ length: columns + 1 }, () => PLAN.near as number);
  for (let c = 1; c < columns; c++) {
    if (placed.some((p) => p.column <= c && p.column + p.width - 1 > c)) gaps[c] = PLAN.gap;
    for (const left of placed.filter((p) => p.column + p.width - 1 === c)) {
      for (const right of placed.filter((p) => p.column === c + 1)) {
        const sameRow = left.row < right.row + right.height && right.row < left.row + left.height;
        if (sameRow) {
          gaps[c] = Math.max(gaps[c] ?? 0, PLAN.gap + overhang(left) + overhang(right));
        }
      }
    }
  }
  const xOf: number[] = [0, 0];
  for (let c = 2; c <= columns + 1; c++) {
    xOf[c] = (xOf[c - 1] ?? 0) + PLAN.tile + (gaps[c - 1] ?? 0);
  }
  const yOf = (row: number) => (row - 1) * (PLAN.rowHeight + PLAN.gap);

  const drawn = placed.map((p): DrawnTable => {
    const left = xOf[p.column] ?? 0;
    const right = (xOf[p.column + p.width - 1] ?? 0) + PLAN.tile;
    const top = yOf(p.row);
    const bottom = yOf(p.row + p.height - 1) + PLAN.rowHeight;
    if (p.round) {
      // Ronde : centrée sur sa case, un peu plus large qu'elle.
      return {
        table: p.table,
        left: (left + right - PLAN.round) / 2,
        top: (top + bottom - PLAN.round) / 2,
        width: PLAN.round,
        height: PLAN.round,
        round: true,
        long: false,
      };
    }
    return {
      table: p.table,
      left,
      top,
      width: right - left,
      height: bottom - top,
      round: false,
      long: p.width > 1,
    };
  });
  // Une ronde au bord déborde : tout se décale pour que rien ne sorte du plan.
  const shift = Math.min(0, ...drawn.map((d) => d.left));
  for (const d of drawn) d.left -= shift;
  return {
    tables: drawn,
    width: Math.max(0, ...drawn.map((d) => d.left + d.width)),
    height: rows === 0 ? 0 : yOf(rows) + PLAN.rowHeight,
  };
}

/** Remplace une table reçue par `table:updated` ; une table inconnue est ajoutée. */
export function upsertTable(tables: Table[], table: Table): Table[] {
  return tables.some((current) => current.id === table.id)
    ? tables.map((current) => (current.id === table.id ? table : current))
    : [...tables, table];
}

/** « de Sami », « d’Amira » : la caisse d'un principal. */
export function ofName(name: string): string {
  return /^[aeiouyhàâéèêëîïôûü]/i.test(name) ? `d’${name}` : `de ${name}`;
}

/** « 1 commande à confirmer », « 2 commandes à confirmer ». */
export const pendingText = (count: number) =>
  `${String(count)} ${t(count > 1 ? 'table.pendingMany' : 'table.pendingOne')}`;

/** Ce qu'un lecteur d'écran annonce pour une table du plan. */
export function tableDescription(
  table: Table,
  otherPrincipal: string | null,
  ready: ('bar' | 'kitchen')[] = [],
): string {
  const parts = [`${t('table.label')} ${String(table.number)}`];
  if (table.state === 'occupied') parts.push(t('table.occupied'), formatPrice(table.openTotal));
  else parts.push(t('table.free'));
  if (table.pendingOrders > 0) parts.push(pendingText(table.pendingOrders));
  if (ready.includes('bar')) parts.push(t('table.readyBar'));
  if (ready.includes('kitchen')) parts.push(t('table.readyKitchen'));
  if (otherPrincipal) parts.push(`${t('table.otherPrincipal')} ${otherPrincipal}`);
  return parts.join(', ');
}
