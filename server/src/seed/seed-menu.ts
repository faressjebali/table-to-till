import type { ClientBase } from 'pg';
import type { SeedMenu } from './menu-csv.js';

export interface SeedMenuResult {
  categories: number;
  inserted: number;
  updated: number;
}

/**
 * Charge le menu en base, dans une seule transaction. Relançable sans doublon :
 * une catégorie est reconnue par son nom français, un article par catégorie + nom français.
 * Les champs du CSV sont réécrits ; la rupture (sold_out), l'archivage et la photo ne sont jamais touchés.
 * À ne pas relancer sur la base du café en service : les modifications de la manager seraient écrasées.
 */
export async function seedMenu(client: ClientBase, menu: SeedMenu): Promise<SeedMenuResult> {
  const result: SeedMenuResult = { categories: menu.categories.length, inserted: 0, updated: 0 };

  await client.query('BEGIN');
  try {
    const categoryIds = new Map<string, number>();
    for (const c of menu.categories) {
      const { rows } = await client.query<{ id: number }>(
        `INSERT INTO categories (name_fr, name_en, section, sort_order) VALUES ($1, $2, $3, $4)
         ON CONFLICT (name_fr) DO UPDATE
           SET name_en = EXCLUDED.name_en, section = EXCLUDED.section, sort_order = EXCLUDED.sort_order
         RETURNING id`,
        [c.nameFr, c.nameEn, c.section, c.sortOrder],
      );
      categoryIds.set(c.nameFr, rowId(rows));
    }

    const itemIds = new Map<string, number>();
    for (const item of menu.items) {
      const categoryId = categoryIds.get(item.categoryFr);
      if (categoryId === undefined) throw new Error(`catégorie inconnue ${item.categoryFr}`);
      const values = [
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
      ];

      const existing = await client.query<{ id: number }>(
        `SELECT id FROM menu_items
         WHERE category_id = $1 AND name_fr = $2 AND archived_at IS NULL
         ORDER BY id LIMIT 1`,
        [categoryId, item.nameFr],
      );
      const existingId = existing.rows[0]?.id;
      if (existingId === undefined) {
        const { rows } = await client.query<{ id: number }>(
          `INSERT INTO menu_items (category_id, name_fr, name_en, description_fr, description_en, price,
             pos_code, station, days, available_from, available_until, note_hint_fr, note_hint_en, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
           RETURNING id`,
          values,
        );
        itemIds.set(item.nameFr, rowId(rows));
        result.inserted += 1;
      } else {
        await client.query(
          `UPDATE menu_items SET category_id = $1, name_fr = $2, name_en = $3, description_fr = $4,
             description_en = $5, price = $6, pos_code = $7, station = $8, days = $9,
             available_from = $10, available_until = $11, note_hint_fr = $12, note_hint_en = $13,
             sort_order = $14, updated_at = now()
           WHERE id = $15`,
          [...values, existingId],
        );
        itemIds.set(item.nameFr, existingId);
        result.updated += 1;
      }
    }

    const idOf = (name: string): number => {
      const id = itemIds.get(name);
      if (id === undefined) throw new Error(`article inconnu ${name}`);
      return id;
    };

    // Extras suggérés et groupes : remplacés par ceux du CSV pour chaque article chargé.
    const seededIds = [...itemIds.values()];
    await client.query('DELETE FROM suggested_extras WHERE menu_item_id = ANY($1)', [seededIds]);
    await client.query('DELETE FROM menu_item_choice_groups WHERE menu_item_id = ANY($1)', [
      seededIds,
    ]);

    for (const group of menu.choiceGroups) {
      await client.query(
        `INSERT INTO choice_groups (key, name_fr, name_en) VALUES ($1, $2, $3)
         ON CONFLICT (key) DO UPDATE SET name_fr = EXCLUDED.name_fr, name_en = EXCLUDED.name_en`,
        [group.key, group.nameFr, group.nameEn],
      );
      // Jus de saison : la liste de la manager survit au seed du matin (scripts/start-day.sh).
      if (group.managedInApp) {
        const { rowCount } = await client.query(
          'SELECT 1 FROM choice_group_options WHERE group_key = $1 LIMIT 1',
          [group.key],
        );
        if (rowCount) continue;
      }
      await client.query('DELETE FROM choice_group_options WHERE group_key = $1', [group.key]);
      for (const [index, option] of group.options.entries()) {
        await client.query(
          'INSERT INTO choice_group_options (group_key, menu_item_id, sort_order) VALUES ($1, $2, $3)',
          [group.key, idOf(option), index + 1],
        );
      }
    }

    for (const item of menu.items) {
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
