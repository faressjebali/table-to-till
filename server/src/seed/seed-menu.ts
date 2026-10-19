import type { ClientBase } from 'pg';
import type { SeedMenu } from './menu-csv.js';

export interface SeedMenuResult {
  categories: number;
  inserted: number;
  skipped: number;
}

/**
 * Ajoute au menu ce qui manque, dans une seule transaction ; ne modifie jamais rien d'existant
 * (l'app est la référence du menu, docs/decisions.md 19/10). Une catégorie est reconnue par son nom
 * français, un article par catégorie + nom français (archivé compris : il ne revient pas), un groupe
 * de choix par sa clé. Extras suggérés et groupes ne sont écrits que pour les articles ajoutés,
 * les options que pour les groupes ajoutés.
 */
export async function seedMenu(client: ClientBase, menu: SeedMenu): Promise<SeedMenuResult> {
  const result: SeedMenuResult = { categories: menu.categories.length, inserted: 0, skipped: 0 };

  await client.query('BEGIN');
  try {
    const categoryIds = new Map<string, number>();
    for (const c of menu.categories) {
      await client.query(
        `INSERT INTO categories (name_fr, name_en, section, display, sort_order)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (name_fr) DO NOTHING`,
        [c.nameFr, c.nameEn, c.section, c.display, c.sortOrder],
      );
      const { rows } = await client.query<{ id: number }>(
        'SELECT id FROM categories WHERE name_fr = $1',
        [c.nameFr],
      );
      categoryIds.set(c.nameFr, rowId(rows));
    }

    const itemIds = new Map<string, number>();
    const inserted = new Set<string>();
    for (const item of menu.items) {
      const categoryId = categoryIds.get(item.categoryFr);
      if (categoryId === undefined) throw new Error(`catégorie inconnue ${item.categoryFr}`);

      const existing = await client.query<{ id: number }>(
        `SELECT id FROM menu_items WHERE category_id = $1 AND name_fr = $2
         ORDER BY archived_at NULLS FIRST, id LIMIT 1`,
        [categoryId, item.nameFr],
      );
      const existingId = existing.rows[0]?.id;
      if (existingId !== undefined) {
        itemIds.set(item.nameFr, existingId);
        result.skipped += 1;
        continue;
      }
      const { rows } = await client.query<{ id: number }>(
        `INSERT INTO menu_items (category_id, name_fr, name_en, description_fr, description_en, price,
           pos_code, station, days, available_from, available_until, note_hint_fr, note_hint_en, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         RETURNING id`,
        [
          categoryId,
          item.nameFr,
          item.nameEn,
          item.descriptionFr,
          item.descriptionEn,
          item.price,
          item.posCode,
          item.station,
          item.days,
          item.availableFrom,
          item.availableUntil,
          item.noteHintFr,
          item.noteHintEn,
          item.sortOrder,
        ],
      );
      itemIds.set(item.nameFr, rowId(rows));
      inserted.add(item.nameFr);
      result.inserted += 1;
    }

    const idOf = (name: string): number => {
      const id = itemIds.get(name);
      if (id === undefined) throw new Error(`article inconnu ${name}`);
      return id;
    };

    for (const group of menu.choiceGroups) {
      const { rowCount } = await client.query(
        `INSERT INTO choice_groups (key, name_fr, name_en) VALUES ($1, $2, $3)
         ON CONFLICT (key) DO NOTHING`,
        [group.key, group.nameFr, group.nameEn],
      );
      if (!rowCount) continue;
      for (const [index, option] of group.options.entries()) {
        await client.query(
          'INSERT INTO choice_group_options (group_key, menu_item_id, sort_order) VALUES ($1, $2, $3)',
          [group.key, idOf(option), index + 1],
        );
      }
    }

    for (const item of menu.items) {
      if (!inserted.has(item.nameFr)) continue;
      for (const [index, extra] of item.suggestedExtras.entries()) {
        await client.query(
          'INSERT INTO suggested_extras (menu_item_id, extra_item_id, sort_order) VALUES ($1, $2, $3)',
          [idOf(item.nameFr), idOf(extra), index + 1],
        );
      }
      for (const [index, key] of item.choiceGroups.entries()) {
        await client.query(
          'INSERT INTO menu_item_choice_groups (menu_item_id, group_key, sort_order) VALUES ($1, $2, $3)',
          [idOf(item.nameFr), key, index + 1],
        );
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
  return result;
}

function rowId(rows: { id: number }[]): number {
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('aucune ligne renvoyée');
  return id;
}
