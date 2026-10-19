import { parse } from 'csv-parse/sync';
import { OPENING_TIME } from '../menu/availability.js';

// Lecture et validation de docs/menu/menu.csv (format décrit dans docs/menu/README.md).
// Fonctions pures : aucune écriture en base ici.

export type Section = 'food' | 'drinks';
export type Station = 'bar' | 'kitchen' | 'both';
export type CategoryDisplay = 'list' | 'grid';

export interface SeedCategory {
  nameFr: string;
  nameEn: string;
  section: Section;
  display: CategoryDisplay;
  sortOrder: number;
}

export interface SeedItem {
  /** Numéro de ligne dans le CSV (en-tête = 1), pour les messages d'erreur. */
  line: number;
  categoryFr: string;
  nameFr: string;
  nameEn: string;
  descriptionFr: string | null;
  descriptionEn: string | null;
  /** Millimes ; null tant que le prix n'est pas fixé (Plat de la semaine). */
  price: number | null;
  posCode: string | null;
  station: Station;
  /** 1 = lundi … 7 = dimanche. */
  days: number[];
  /** "HH:MM" ; null = sans début propre (« until » part de l'ouverture : 08:00). */
  availableFrom: string | null;
  /** "HH:MM" ; null = jusqu'à la fermeture du café. */
  availableUntil: string | null;
  noteHintFr: string | null;
  noteHintEn: string | null;
  /** Noms français des extras suggérés, dans l'ordre. */
  suggestedExtras: string[];
  choiceGroups: string[];
  sortOrder: number;
}

export interface SeedChoiceGroup {
  key: string;
  nameFr: string;
  nameEn: string;
  /** Noms français des articles proposés, dans l'ordre. */
  options: string[];
}

export interface SeedMenu {
  categories: SeedCategory[];
  items: SeedItem[];
  choiceGroups: SeedChoiceGroup[];
}

// Catégories « Boissons » du menu papier (docs/product.md § 3) ; toutes les autres sont « Food ».
const DRINK_CATEGORIES = new Set([
  'Jus',
  'Fresh Blends',
  'Thé & Infusion',
  'Cafés',
  'Matcha',
  'Healthy Shots',
  'Eau',
]);

// Catégories affichées en tableau (nom + prix) dans le menu QR, comme sur le menu papier.
const GRID_CATEGORIES = new Set(['Extras']);

// Groupes de choix (docs/api.md § ChoiceGroup). Les options sont des articles du menu.
const CHOICE_GROUPS: {
  key: string;
  nameFr: string;
  nameEn: string;
  options: (items: SeedItem[]) => string[];
}[] = [
  {
    key: 'hot_drink',
    nameFr: 'Café ou thé',
    nameEn: 'Coffee or tea',
    // Règle du café (15/10/2026) : les thés à 6,5 DT et les cafés jusqu'à 8,5 DT.
    options: (items) =>
      items
        .filter(
          (i) =>
            (i.categoryFr === 'Thé & Infusion' && i.price === 6500) ||
            (i.categoryFr === 'Cafés' && i.price !== null && i.price <= 8500),
        )
        .map((i) => i.nameFr),
  },
  {
    key: 'seasonal_juice',
    nameFr: 'Jus de saison',
    nameEn: 'Seasonal juice',
    // Modifiable ensuite par la manager ; pour l'instant seulement Grenade.
    options: () => ['Grenade'],
  },
  {
    key: 'eggs',
    nameFr: 'Omelette ou œufs brouillés',
    nameEn: 'Omelette or scrambled eggs',
    options: () => ['Omelette nature', 'Œufs brouillés'],
  },
  {
    key: 'eggs_with_benedict',
    nameFr: 'Vos œufs',
    nameEn: 'Your eggs',
    options: () => ['Omelette nature', 'Œufs brouillés', 'Œufs Bénédicte'],
  },
];

const COLUMNS = [
  'category',
  'category_en',
  'name_fr',
  'name_en',
  'description_fr',
  'description_en',
  'price_dt',
  'pos_code',
  'availability',
  'suggested_extras',
  'note_hint_fr',
  'note_hint_en',
  'choice_groups',
  'photo',
  'station',
] as const;
type Row = Record<(typeof COLUMNS)[number], string>;

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];

export class MenuCsvError extends Error {
  constructor(line: number, message: string) {
    super(`menu.csv ligne ${String(line)} : ${message}`);
    this.name = 'MenuCsvError';
  }
}

/** "12" → 12000, "5.5" → 5500, "" → null. Calcul sur la chaîne : pas de flottant. */
export function parsePrice(value: string, line: number): number | null {
  if (value === '') return null;
  const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(value);
  if (!match) throw new MenuCsvError(line, `prix illisible « ${value} » (ex. 12 ou 5.5)`);
  const dinars = Number(match[1]);
  const millimes = Number((match[2] ?? '').padEnd(3, '0'));
  const price = dinars * 1000 + millimes;
  if (price <= 0) throw new MenuCsvError(line, 'le prix doit être positif');
  return price;
}

/** "" ; "until 12:00" ; "mon-fri 08:00-15:00". */
export function parseAvailability(
  value: string,
  line: number,
): { days: number[]; availableFrom: string | null; availableUntil: string | null } {
  if (value === '') return { days: ALL_DAYS, availableFrom: null, availableUntil: null };
  const match =
    /^(?:([a-z]{3})-([a-z]{3}) )?(?:until (\d{2}:\d{2})|(\d{2}:\d{2})-(\d{2}:\d{2}))$/.exec(value);
  if (!match) throw new MenuCsvError(line, `horaire illisible « ${value} »`);
  const [, dayFrom, dayTo, until, from, to] = match;

  let days = ALL_DAYS;
  if (dayFrom !== undefined && dayTo !== undefined) {
    const start = DAY_KEYS.indexOf(dayFrom) + 1;
    const end = DAY_KEYS.indexOf(dayTo) + 1;
    if (start === 0 || end === 0 || start > end) {
      throw new MenuCsvError(line, `jours illisibles « ${dayFrom}-${dayTo} »`);
    }
    days = ALL_DAYS.filter((d) => d >= start && d <= end);
  }

  // « until 12:00 » part de l'ouverture du café (docs/menu/README.md) : sans ce début,
  // le staff, qui n'est pas borné par l'ouverture, pourrait commander une formule à 7h30.
  const availableFrom = from ?? (until !== undefined ? OPENING_TIME : null);
  const availableUntil = until ?? to ?? null;
  for (const time of [availableFrom, availableUntil]) {
    if (time !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      throw new MenuCsvError(line, `heure invalide « ${time} »`);
    }
  }
  if (availableFrom !== null && availableUntil !== null && availableFrom >= availableUntil) {
    throw new MenuCsvError(line, `horaire vide « ${value} »`);
  }
  return { days, availableFrom, availableUntil };
}

function splitList(value: string): string[] {
  return value === '' ? [] : value.split(';').map((v) => v.trim());
}

function orNull(value: string): string | null {
  return value === '' ? null : value;
}

export function parseMenuCsv(text: string): SeedMenu {
  const rows = parse<Row>(text, { columns: true, skip_empty_lines: true, trim: true });
  const header = rows[0] ? Object.keys(rows[0]) : [];
  const missing = COLUMNS.filter((c) => !header.includes(c));
  if (missing.length > 0) throw new MenuCsvError(1, `colonnes manquantes : ${missing.join(', ')}`);

  const categories: SeedCategory[] = [];
  const items: SeedItem[] = [];
  const seen = new Set<string>();

  rows.forEach((row, index) => {
    const line = index + 2;
    for (const col of ['category', 'category_en', 'name_fr', 'name_en', 'station'] as const) {
      if (row[col] === '') throw new MenuCsvError(line, `colonne ${col} vide`);
    }
    if (!['bar', 'kitchen', 'both'].includes(row.station)) {
      throw new MenuCsvError(line, `station inconnue « ${row.station} »`);
    }

    let category = categories.find((c) => c.nameFr === row.category);
    if (!category) {
      category = {
        nameFr: row.category,
        nameEn: row.category_en,
        section: DRINK_CATEGORIES.has(row.category) ? 'drinks' : 'food',
        display: GRID_CATEGORIES.has(row.category) ? 'grid' : 'list',
        sortOrder: categories.length + 1,
      };
      categories.push(category);
    } else if (category.nameEn !== row.category_en) {
      throw new MenuCsvError(line, `catégorie « ${row.category} » traduite de deux façons`);
    }

    // Texte client : en français et en anglais, ou pas du tout.
    if ((row.note_hint_fr === '') !== (row.note_hint_en === '')) {
      throw new MenuCsvError(line, 'note_hint_fr et note_hint_en : remplir les deux ou aucun');
    }

    // Les noms d'articles servent de référence (extras, choix) : uniques dans tout le menu.
    if (seen.has(row.name_fr)) throw new MenuCsvError(line, `article en double « ${row.name_fr} »`);
    seen.add(row.name_fr);

    items.push({
      line,
      categoryFr: row.category,
      nameFr: row.name_fr,
      nameEn: row.name_en,
      descriptionFr: orNull(row.description_fr),
      descriptionEn: orNull(row.description_en),
      price: parsePrice(row.price_dt, line),
      posCode: orNull(row.pos_code),
      station: row.station as Station,
      ...parseAvailability(row.availability, line),
      noteHintFr: orNull(row.note_hint_fr),
      noteHintEn: orNull(row.note_hint_en),
      suggestedExtras: splitList(row.suggested_extras),
      choiceGroups: splitList(row.choice_groups),
      sortOrder: items.filter((i) => i.categoryFr === row.category).length + 1,
    });
  });

  const choiceGroups = CHOICE_GROUPS.map((g) => ({
    key: g.key,
    nameFr: g.nameFr,
    nameEn: g.nameEn,
    options: g.options(items),
  }));

  // Références : extras, groupes et options doivent exister.
  for (const item of items) {
    for (const extra of item.suggestedExtras) {
      if (!seen.has(extra) || extra === item.nameFr) {
        throw new MenuCsvError(item.line, `extra suggéré inconnu « ${extra} »`);
      }
    }
    for (const key of item.choiceGroups) {
      if (!choiceGroups.some((g) => g.key === key)) {
        throw new MenuCsvError(item.line, `groupe de choix inconnu « ${key} »`);
      }
    }
  }
  for (const group of choiceGroups) {
    if (group.options.length === 0) throw new MenuCsvError(1, `groupe ${group.key} sans option`);
    for (const option of group.options) {
      if (!seen.has(option)) {
        throw new MenuCsvError(1, `option « ${option} » du groupe ${group.key} absente du menu`);
      }
    }
  }

  return { categories, items, choiceGroups };
}
