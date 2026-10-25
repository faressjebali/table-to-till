import type pg from 'pg';
import { z } from 'zod';
import { queryAll, type Db } from '../db.js';
import { HttpError } from '../errors.js';
import { computeAvailability, type Audience } from '../menu/availability.js';
import { onMenu } from '../menu/items.js';

// Lignes envoyées par le client ou le staff (docs/api.md § 3, règles POST /orders).
export const orderLinesSchema = z
  .array(
    z.object({
      menuItemId: z.number().int().positive(),
      quantity: z.number().int().min(1).max(20),
      note: z.string().max(200).nullable().optional(),
      choices: z
        .array(z.object({ group: z.string().min(1), menuItemId: z.number().int().positive() }))
        .optional(),
    }),
  )
  .min(1)
  .max(30);

export type OrderLineInput = z.infer<typeof orderLinesSchema>[number];

// Ligne prête à enregistrer : nom et prix copiés depuis le menu, choix vérifiés.
export type PreparedLine = {
  menuItemId: number;
  nameFr: string;
  nameEn: string | null;
  quantity: number;
  unitPrice: number;
  note: string | null;
  choices: { group: string; menuItemId: number }[];
};

type ItemRow = {
  id: number;
  name_fr: string;
  name_en: string | null;
  price: number;
  pos_code: string | null;
  days: number[];
  available_from: string | null;
  available_until: string | null;
  sold_out: boolean;
  choice_groups: string[];
};

function fieldError(field: string, message: string): HttpError {
  return new HttpError(400, 'VALIDATION_ERROR', 'Invalid request body', {
    fields: [{ field, message }],
  });
}

// Article (ou option d'une formule) commandable maintenant : sinon OUTSIDE_HOURS ou ITEM_UNAVAILABLE,
// avec l'article en cause. Sans code produit, l'agent ne peut pas le saisir en caisse : indisponible.
function checkAvailable(item: ItemRow, now: Date, audience: Audience, needsPosCode: boolean) {
  const { unavailableReason } = computeAvailability(
    {
      days: item.days,
      from: item.available_from,
      until: item.available_until,
      soldOut: item.sold_out,
    },
    now,
    audience,
  );
  if (unavailableReason === 'outside_hours') {
    throw new HttpError(409, 'OUTSIDE_HOURS', `${item.name_fr} is outside its hours`, {
      menuItemId: item.id,
    });
  }
  if (unavailableReason === 'sold_out' || (needsPosCode && item.pos_code === null)) {
    throw new HttpError(409, 'ITEM_UNAVAILABLE', `${item.name_fr} is unavailable`, {
      menuItemId: item.id,
    });
  }
}

// Vérifie les lignes et calcule les prix à partir de la base : jamais à partir du client.
// Les erreurs de forme (article inconnu, choix incomplets) passent avant la disponibilité.
export async function prepareLines(
  db: Db | pg.PoolClient,
  lines: readonly OrderLineInput[],
  now: Date,
  audience: Audience,
): Promise<PreparedLine[]> {
  const ids = new Set<number>();
  for (const line of lines) {
    ids.add(line.menuItemId);
    for (const choice of line.choices ?? []) ids.add(choice.menuItemId);
  }

  const [{ rows: items }, { rows: options }] = await queryAll(
    db,
    () =>
      db.query<ItemRow>(
        `SELECT i.id, i.name_fr, i.name_en, i.price, i.pos_code, i.days,
              i.available_from::text, i.available_until::text, i.sold_out,
              array(SELECT g.group_key FROM menu_item_choice_groups g
                     WHERE g.menu_item_id = i.id
                     ORDER BY g.sort_order, g.group_key) AS choice_groups
         FROM menu_items i
        WHERE ${onMenu('i')} AND i.id = ANY($1)`,
        [[...ids]],
      ),
    () =>
      db.query<{ group_key: string; menu_item_id: number }>(
        `SELECT o.group_key, o.menu_item_id FROM choice_group_options o
         JOIN menu_items i ON i.id = o.menu_item_id
        WHERE ${onMenu('i')}`,
      ),
  );
  const byId = new Map(items.map((item) => [item.id, item]));
  const optionsByGroup = new Map<string, Set<number>>();
  for (const option of options) {
    const set = optionsByGroup.get(option.group_key) ?? new Set<number>();
    set.add(option.menu_item_id);
    optionsByGroup.set(option.group_key, set);
  }

  const prepared = lines.map((line, index): PreparedLine & { item: ItemRow } => {
    const item = byId.get(line.menuItemId);
    if (!item) throw fieldError(`lines.${String(index)}.menuItemId`, 'Unknown menu item');

    // Un choix par groupe de l'article, ni plus ni moins (docs/api.md § ChoiceGroup).
    const choices = line.choices ?? [];
    if (item.choice_groups.length === 0 && choices.length > 0) {
      throw fieldError(`lines.${String(index)}.choices`, 'This item has no choices');
    }
    const groups = new Set(choices.map((choice) => choice.group));
    if (
      groups.size !== choices.length ||
      item.choice_groups.length !== choices.length ||
      !item.choice_groups.every((group) => groups.has(group))
    ) {
      throw fieldError(
        `lines.${String(index)}.choices`,
        `Exactly one choice is required for each group: ${item.choice_groups.join(', ')}`,
      );
    }
    choices.forEach((choice, choiceIndex) => {
      if (!optionsByGroup.get(choice.group)?.has(choice.menuItemId)) {
        throw fieldError(
          `lines.${String(index)}.choices.${String(choiceIndex)}.menuItemId`,
          `Not an option of ${choice.group}`,
        );
      }
    });

    return {
      item,
      menuItemId: item.id,
      nameFr: item.name_fr,
      nameEn: item.name_en,
      quantity: line.quantity,
      unitPrice: item.price,
      note: line.note === undefined || line.note === null || line.note === '' ? null : line.note,
      // Ordre des groupes de l'article, pour un affichage stable.
      choices: item.choice_groups.map((group) => {
        const choice = choices.find((c) => c.group === group);
        if (!choice) throw new Error('choix vérifié introuvable');
        return { group, menuItemId: choice.menuItemId };
      }),
    };
  });

  for (const line of prepared) {
    // Seul l'article est tapé en caisse : les options n'ont pas besoin de code produit.
    checkAvailable(line.item, now, audience, true);
    for (const choice of line.choices) {
      const option = byId.get(choice.menuItemId);
      if (!option) throw new Error('option vérifiée introuvable');
      checkAvailable(option, now, audience, false);
    }
  }

  return prepared.map(({ item: _item, ...line }) => line);
}

// Total d'une commande sans remise (création) : chaque ligne quantité × prix unitaire.
export const linesTotal = (lines: readonly PreparedLine[]) =>
  lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
