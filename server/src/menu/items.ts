import type { Db } from '../db.js';
import { computeAvailability, type UnavailableReason } from './availability.js';

export type Station = 'bar' | 'kitchen' | 'both';
export type Localized = { fr: string; en: string };

// Forme MenuItem de docs/api.md § 2. `posCode` seulement pour le staff et l'agent.
export type MenuItem = {
  id: number;
  categoryId: number;
  name: Localized;
  description: Localized | null;
  price: number;
  photoUrl: string | null;
  available: boolean;
  unavailableReason: UnavailableReason | null;
  availability: { days: number[]; from: string | null; until: string | null };
  suggestedExtraIds: number[];
  choiceGroups: string[];
  noteHint: Localized | null;
  station: Station;
  posCode?: string | null;
};

type ItemRow = {
  id: number;
  category_id: number;
  name_fr: string;
  name_en: string | null;
  description_fr: string | null;
  description_en: string | null;
  price: number;
  photo_url: string | null;
  days: number[];
  available_from: string | null;
  available_until: string | null;
  sold_out: boolean;
  note_hint_fr: string | null;
  note_hint_en: string | null;
  station: Station;
  pos_code: string | null;
  suggested_extra_ids: number[];
  choice_groups: string[];
};

// Un article est « au menu » s'il n'est pas archivé et a un prix
// (le Plat de la semaine reste masqué tant que la manager ne l'a pas rempli).
export const onMenu = (alias: string) =>
  `${alias}.archived_at IS NULL AND ${alias}.price IS NOT NULL`;

// Anglais manquant : on renvoie le français plutôt que null.
export function localized(fr: string, en: string | null): Localized;
export function localized(fr: string | null, en: string | null): Localized | null;
export function localized(fr: string | null, en: string | null): Localized | null {
  if (fr === null) return null;
  return { fr, en: en ?? fr };
}

// "08:00:00" (PostgreSQL) → "08:00".
const hhmm = (time: string | null) => (time === null ? null : time.slice(0, 5));

export async function loadMenuItems(db: Db, ids?: readonly number[]): Promise<ItemRow[]> {
  const { rows } = await db.query<ItemRow>(
    `SELECT i.id, i.category_id, i.name_fr, i.name_en, i.description_fr, i.description_en,
            i.price, i.photo_url, i.days, i.available_from::text, i.available_until::text,
            i.sold_out, i.note_hint_fr, i.note_hint_en, i.station, i.pos_code,
            array(SELECT s.extra_item_id FROM suggested_extras s
                    JOIN menu_items e ON e.id = s.extra_item_id
                   WHERE s.menu_item_id = i.id AND ${onMenu('e')}
                   ORDER BY s.sort_order, s.extra_item_id) AS suggested_extra_ids,
            array(SELECT g.group_key FROM menu_item_choice_groups g
                   WHERE g.menu_item_id = i.id
                   ORDER BY g.sort_order, g.group_key) AS choice_groups
       FROM menu_items i
      WHERE ${onMenu('i')} AND ($1::int[] IS NULL OR i.id = ANY($1))
      ORDER BY i.sort_order, i.id`,
    [ids ?? null],
  );
  return rows;
}

export function toMenuItem(row: ItemRow, now: Date, { withPosCode }: { withPosCode: boolean }) {
  const availability = {
    days: row.days,
    from: hhmm(row.available_from),
    until: hhmm(row.available_until),
  };
  const item: MenuItem = {
    id: row.id,
    categoryId: row.category_id,
    name: localized(row.name_fr, row.name_en),
    description: localized(row.description_fr, row.description_en),
    price: row.price,
    photoUrl: row.photo_url,
    ...computeAvailability({ ...availability, soldOut: row.sold_out }, now),
    availability,
    suggestedExtraIds: row.suggested_extra_ids,
    choiceGroups: row.choice_groups,
    noteHint: localized(row.note_hint_fr, row.note_hint_en),
    station: row.station,
  };
  if (withPosCode) item.posCode = row.pos_code;
  return item;
}
