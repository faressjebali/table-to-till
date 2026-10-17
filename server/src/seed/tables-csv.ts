import { parse } from 'csv-parse/sync';

// Lecture et validation de docs/tables.csv (relevé du plan de LegacyPOS, docs/pos.md § Tables).
// Fonctions pures : aucune écriture en base ici.

export type TableKind = 'real' | 'virtual';

export interface SeedTable {
  /** Numéro de ligne dans le CSV (en-tête = 1), pour les messages d'erreur. */
  line: number;
  /** Numéro de la table dans LegacyPOS. */
  number: number;
  kind: TableKind;
  /** Case du plan (colonne, rangée) : seulement pour une table réelle. */
  layout: { x: number; y: number } | null;
  /** Nom de la table d'offre ; null pour une table de vente directe ou une table réelle. */
  offerFor: string | null;
}

const COLUMNS = ['number', 'kind', 'layout_x', 'layout_y', 'offer_for'] as const;
type Row = Record<(typeof COLUMNS)[number], string>;

export class TablesCsvError extends Error {
  constructor(line: number, message: string) {
    super(`tables.csv ligne ${String(line)} : ${message}`);
    this.name = 'TablesCsvError';
  }
}

function parseIndex(value: string, line: number, column: string): number {
  if (!/^\d+$/.test(value)) throw new TablesCsvError(line, `${column} illisible « ${value} »`);
  return Number(value);
}

export function parseTablesCsv(text: string): SeedTable[] {
  const rows = parse<Row>(text, { columns: true, skip_empty_lines: true, trim: true });
  const header = rows[0] ? Object.keys(rows[0]) : [];
  const missing = COLUMNS.filter((c) => !header.includes(c));
  if (missing.length > 0)
    throw new TablesCsvError(1, `colonnes manquantes : ${missing.join(', ')}`);

  const numbers = new Set<number>();
  const cells = new Set<string>();

  return rows.map((row, index) => {
    const line = index + 2;
    const number = parseIndex(row.number, line, 'number');
    if (number <= 0) throw new TablesCsvError(line, 'le numéro doit être positif');
    if (numbers.has(number)) throw new TablesCsvError(line, `table ${String(number)} en double`);
    numbers.add(number);

    if (row.kind !== 'real' && row.kind !== 'virtual') {
      throw new TablesCsvError(line, `kind inconnu « ${row.kind} » (real ou virtual)`);
    }
    const offerFor = row.offer_for === '' ? null : row.offer_for;

    if (row.kind === 'virtual') {
      if (row.layout_x !== '' || row.layout_y !== '') {
        throw new TablesCsvError(line, 'une table fictive n’a pas de place sur le plan');
      }
      return { line, number, kind: 'virtual', layout: null, offerFor };
    }

    if (offerFor !== null) throw new TablesCsvError(line, 'une table réelle n’est jamais d’offre');
    const layout = {
      x: parseIndex(row.layout_x, line, 'layout_x'),
      y: parseIndex(row.layout_y, line, 'layout_y'),
    };
    const cell = `${String(layout.x)},${String(layout.y)}`;
    if (cells.has(cell)) throw new TablesCsvError(line, `case ${cell} déjà prise sur le plan`);
    cells.add(cell);
    return { line, number, kind: 'real', layout, offerFor: null };
  });
}
