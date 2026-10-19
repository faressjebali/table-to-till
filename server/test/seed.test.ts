import { readFileSync } from 'node:fs';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MenuCsvError, parseAvailability, parseMenuCsv, parsePrice } from '../src/seed/menu-csv.js';
import { seedMenu } from '../src/seed/seed-menu.js';
import { resetTestDatabase, testUrl } from './helpers/db.js';

const csv = readFileSync(new URL('../../docs/menu/menu.csv', import.meta.url), 'utf8');
const header =
  'category,category_en,name_fr,name_en,description_fr,description_en,price_dt,pos_code,availability,suggested_extras,note_hint_fr,note_hint_en,choice_groups,photo,station';
// Le minimum pour que les groupes de choix trouvent leurs options.
const baseRows = [
  'Œufs,Eggs,Omelette nature,Plain omelette,,,12,,,,,,,,kitchen',
  'Œufs,Eggs,Œufs brouillés,Scrambled eggs,,,12,,,,,,,,kitchen',
  'Œufs,Eggs,Œufs Bénédicte,Eggs Benedict,,,18,,,,,,,,kitchen',
  'Jus,Juices,Grenade,Pomegranate,,,12,,,,,,,,bar',
  'Cafés,Coffees,Espresso,Espresso,,,6,,,,,,,,bar',
];
const csvWith = (...rows: string[]) => [header, ...baseRows, ...rows].join('\n');

describe('parsePrice', () => {
  it('convertit les dinars en millimes sans flottant', () => {
    expect(parsePrice('12', 2)).toBe(10500);
    expect(parsePrice('5.5', 2)).toBe(6000);
    expect(parsePrice('0.125', 2)).toBe(125);
    expect(parsePrice('', 2)).toBeNull();
  });

  it('refuse un prix illisible ou nul', () => {
    expect(() => parsePrice('5,5', 7)).toThrow('ligne 7');
    expect(() => parsePrice('0', 7)).toThrow(MenuCsvError);
  });
});

describe('parseAvailability', () => {
  it('lit les trois formats du CSV', () => {
    expect(parseAvailability('', 2)).toEqual({
      days: [1, 2, 3, 4, 5, 6, 7],
      availableFrom: null,
      availableUntil: null,
    });
    // « until » part de l'ouverture du café (docs/menu/README.md).
    expect(parseAvailability('until 12:00', 2)).toEqual({
      days: [1, 2, 3, 4, 5, 6, 7],
      availableFrom: '08:00',
      availableUntil: '12:00',
    });
    expect(parseAvailability('mon-fri 08:00-15:00', 2)).toEqual({
      days: [1, 2, 3, 4, 5],
      availableFrom: '08:00',
      availableUntil: '15:00',
    });
  });

  it('refuse un horaire illisible', () => {
    expect(() => parseAvailability('après 12h', 3)).toThrow('ligne 3');
    expect(() => parseAvailability('fri-mon 08:00-15:00', 3)).toThrow(MenuCsvError);
    expect(() => parseAvailability('15:00-08:00', 3)).toThrow(MenuCsvError);
  });
});

describe('parseMenuCsv sur docs/menu/menu.csv', () => {
  const menu = parseMenuCsv(csv);

  it('lit 19 catégories et 97 articles, dans l’ordre du menu papier', () => {
    expect(menu.categories).toHaveLength(19);
    expect(menu.items).toHaveLength(97);
    expect(menu.categories[0]).toMatchObject({
      nameFr: 'Formules petit-déjeuner',
      section: 'food',
    });
    expect(menu.categories.filter((c) => c.section === 'drinks')).toHaveLength(7);
    expect(menu.categories.find((c) => c.nameFr === 'Extras')?.display).toBe('grid');
    expect(menu.items.filter((i) => i.categoryFr === 'Extras').map((i) => i.sortOrder)).toEqual(
      Array.from({ length: 14 }, (_, i) => i + 1),
    );
  });

  it('a un nom anglais pour chaque article et chaque catégorie', () => {
    expect(menu.items.every((i) => i.nameEn !== '')).toBe(true);
    expect(menu.categories.every((c) => c.nameEn !== '')).toBe(true);
  });

  it('laisse le Plat de la semaine sans prix (pas commandable), du lundi au vendredi', () => {
    const dish = menu.items.find((i) => i.nameFr === 'Plat de la semaine');
    expect(dish).toMatchObject({
      price: null,
      posCode: null,
      days: [1, 2, 3, 4, 5],
      availableFrom: '08:00',
      availableUntil: '15:00',
    });
    expect(menu.items.filter((i) => i.price === null)).toHaveLength(1);
  });

  it('lit les codes caisse, vides seulement pour le Plat de la semaine', () => {
    expect(menu.items.find((i) => i.nameFr === 'Avocat')).toMatchObject({
      price: 7000,
      posCode: '82',
    });
    expect(menu.items.filter((i) => i.posCode === null).map((i) => i.nameFr)).toEqual([
      'Plat de la semaine',
    ]);
  });

  it('construit les groupes de choix de docs/api.md', () => {
    const options = Object.fromEntries(menu.choiceGroups.map((g) => [g.key, g.options]));
    expect(options.hot_drink).toEqual([
      'Lemon grove',
      'Ginger calm',
      'Verveine',
      'Camomille',
      'Espresso',
      'Espresso macchiato',
      'Latte macchiato',
      'Capuccino',
      'Americano',
    ]);
    expect(options.seasonal_juice).toEqual(['Grenade']);
    expect(options.eggs).toEqual(['Omelette nature', 'Œufs brouillés']);
    expect(options.eggs_with_benedict).toEqual([
      'Omelette nature',
      'Œufs brouillés',
      'Œufs Bénédicte',
    ]);
    expect(menu.items.find((i) => i.nameFr === 'Sweet Start')?.choiceGroups).toEqual([
      'hot_drink',
      'eggs_with_benedict',
      'seasonal_juice',
    ]);
  });
});

describe('parseMenuCsv refuse un CSV incohérent', () => {
  it('extra suggéré inconnu', () => {
    expect(() =>
      parseMenuCsv(csvWith('Plats,Mains,Burger,Burger,,,20,,,Ketchup,,,,,kitchen')),
    ).toThrow('ligne 7 : extra suggéré inconnu « Ketchup »');
  });

  it('groupe de choix inconnu', () => {
    expect(() =>
      parseMenuCsv(csvWith('Plats,Mains,Burger,Burger,,,20,,,,,,dessert,,kitchen')),
    ).toThrow('groupe de choix inconnu');
  });

  it('article en double', () => {
    expect(() => parseMenuCsv(csvWith('Jus,Juices,Grenade,Pomegranate,,,12,,,,,,,,bar'))).toThrow(
      'article en double',
    );
  });

  it('station inconnue ou nom anglais manquant', () => {
    expect(() => parseMenuCsv(csvWith('Plats,Mains,Burger,Burger,,,20,,,,,,,,salle'))).toThrow(
      'station inconnue',
    );
    expect(() => parseMenuCsv(csvWith('Plats,Mains,Burger,,,,20,,,,,,,,kitchen'))).toThrow(
      'colonne name_en vide',
    );
  });

  it('aide de note sans traduction', () => {
    expect(() =>
      parseMenuCsv(csvWith('Plats,Mains,Burger,Burger,,,20,,,,Sans oignon ?,,,,kitchen')),
    ).toThrow('ligne 7 : note_hint_fr et note_hint_en');
    expect(() =>
      parseMenuCsv(csvWith('Plats,Mains,Burger,Burger,,,20,,,,,No onion?,,,kitchen')),
    ).toThrow(MenuCsvError);
  });
});

describe('parseMenuCsv lit l’aide de note', () => {
  it('en français et en anglais', () => {
    const menu = parseMenuCsv(
      csvWith('Plats,Mains,Burger,Burger,,,20,,,,Sans oignon ?,No onion?,,,kitchen'),
    );
    expect(menu.items.at(-1)).toMatchObject({
      noteHintFr: 'Sans oignon ?',
      noteHintEn: 'No onion?',
    });
  });
});

describe('seedMenu (base de test)', () => {
  const client = new pg.Client({ connectionString: testUrl });
  const menu = parseMenuCsv(csv);

  beforeAll(async () => {
    await resetTestDatabase();
    await client.connect();
  });
  afterAll(async () => {
    await client.end();
  });

  const count = async (table: string) => {
    const { rows } = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
    return rows[0]?.n;
  };

  it('charge tout le menu', async () => {
    expect(await seedMenu(client, menu)).toEqual({ categories: 19, inserted: 97, skipped: 0 });
    expect(await count('categories')).toBe(19);
    expect(await count('menu_items')).toBe(97);
    expect(await count('choice_groups')).toBe(4);

    const { rows } = await client.query<{ price: number | null; name_en: string }>(
      "SELECT price, name_en FROM menu_items WHERE name_fr = 'Épinards'",
    );
    expect(rows).toEqual([{ price: 6000, name_en: 'Spinach' }]);

    const extras = await client.query<{ name_fr: string }>(
      `SELECT e.name_fr FROM suggested_extras s
         JOIN menu_items m ON m.id = s.menu_item_id JOIN menu_items e ON e.id = s.extra_item_id
       WHERE m.name_fr = 'Cheese Burger' ORDER BY s.sort_order`,
    );
    expect(extras.rows.map((r) => r.name_fr)).toEqual([
      'Bacon de bœuf',
      'Œuf',
      'Gouda',
      'Cheddar',
      'Steak',
      'Gruyère',
    ]);
  });

  const optionsOf = async (key: string) => {
    const { rows } = await client.query<{ name_fr: string }>(
      `SELECT m.name_fr FROM choice_group_options o JOIN menu_items m ON m.id = o.menu_item_id
        WHERE o.group_key = $1 ORDER BY o.sort_order, m.name_fr`,
      [key],
    );
    return rows.map((r) => r.name_fr);
  };
  const extrasOf = async (name: string) => {
    const { rows } = await client.query<{ name_fr: string }>(
      `SELECT e.name_fr FROM suggested_extras s
         JOIN menu_items m ON m.id = s.menu_item_id JOIN menu_items e ON e.id = s.extra_item_id
       WHERE m.name_fr = $1 ORDER BY s.sort_order`,
      [name],
    );
    return rows.map((r) => r.name_fr);
  };

  it('se relance sans doublon et ne modifie rien de ce que la manager a changé', async () => {
    // Modifications faites dans l'app : rupture, prix, nom anglais, code, horaires, aide de note,
    // catégorie, extras suggérés, jus de saison, liste des cafés des formules.
    await client.query(
      `UPDATE menu_items SET sold_out = true, price = 7000, name_en = 'Avocado (new)', pos_code = '999',
         available_from = '10:00', note_hint_fr = 'Bien mûr ?', note_hint_en = 'Ripe?'
       WHERE name_fr = 'Avocat'`,
    );
    await client.query("UPDATE categories SET name_en = 'Add-ons' WHERE name_fr = 'Extras'");
    await client.query(
      `DELETE FROM suggested_extras
        WHERE menu_item_id = (SELECT id FROM menu_items WHERE name_fr = 'Cheese Burger')
          AND extra_item_id = (SELECT id FROM menu_items WHERE name_fr = 'Gouda')`,
    );
    await client.query(
      `UPDATE choice_group_options SET menu_item_id = (SELECT id FROM menu_items WHERE name_fr = 'Fraise')
        WHERE group_key = 'seasonal_juice'`,
    );
    await client.query(
      `DELETE FROM choice_group_options
        WHERE group_key = 'hot_drink'
          AND menu_item_id = (SELECT id FROM menu_items WHERE name_fr = 'Americano')`,
    );
    await client.query("UPDATE choice_groups SET name_en = 'Hot drink' WHERE key = 'hot_drink'");

    expect(await seedMenu(client, menu)).toEqual({ categories: 19, inserted: 0, skipped: 97 });
    expect(await count('categories')).toBe(19);
    expect(await count('menu_items')).toBe(97);

    const { rows } = await client.query(
      `SELECT sold_out, price, name_en, pos_code, available_from, note_hint_fr, note_hint_en
         FROM menu_items WHERE name_fr = 'Avocat'`,
    );
    expect(rows).toEqual([
      {
        sold_out: true,
        price: 7000,
        name_en: 'Avocado (new)',
        pos_code: '999',
        available_from: '10:00:00',
        note_hint_fr: 'Bien mûr ?',
        note_hint_en: 'Ripe?',
      },
    ]);
    const category = await client.query("SELECT name_en FROM categories WHERE name_fr = 'Extras'");
    expect(category.rows).toEqual([{ name_en: 'Add-ons' }]);
    expect(await extrasOf('Cheese Burger')).not.toContain('Gouda');
    expect(await optionsOf('seasonal_juice')).toEqual(['Fraise']);
    expect(await optionsOf('hot_drink')).not.toContain('Americano');
    const group = await client.query("SELECT name_en FROM choice_groups WHERE key = 'hot_drink'");
    expect(group.rows).toEqual([{ name_en: 'Hot drink' }]);
  });

  it('ne fait pas revenir un article archivé', async () => {
    await client.query("UPDATE menu_items SET archived_at = now() WHERE name_fr = 'Épinards'");
    expect(await seedMenu(client, menu)).toMatchObject({ inserted: 0, skipped: 97 });
    const { rows } = await client.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM menu_items WHERE name_fr = 'Épinards'",
    );
    expect(rows).toEqual([{ n: 1 }]);
  });

  it('ajoute un nouvel article du CSV, avec ses extras (déjà en base) et ses groupes', async () => {
    const extended = parseMenuCsv(
      csv.trimEnd() +
        '\nPlats,Mains,Burger du chef,Chef burger,,,28,200,,Œuf;Gouda,,,eggs,,kitchen' +
        '\nNouveautés,New,Tarte du jour,Pie of the day,,,9,201,,,,,,,both',
    );
    expect(await seedMenu(client, extended)).toEqual({
      categories: 20,
      inserted: 2,
      skipped: 97,
    });
    expect(await extrasOf('Burger du chef')).toEqual(['Œuf', 'Gouda']);
    const groups = await client.query(
      `SELECT g.group_key FROM menu_item_choice_groups g JOIN menu_items m ON m.id = g.menu_item_id
        WHERE m.name_fr = 'Burger du chef'`,
    );
    expect(groups.rows).toEqual([{ group_key: 'eggs' }]);
    const { rows } = await client.query(
      `SELECT c.name_en, m.price, m.pos_code FROM menu_items m JOIN categories c ON c.id = m.category_id
        WHERE m.name_fr = 'Tarte du jour'`,
    );
    expect(rows).toEqual([{ name_en: 'New', price: 7000, pos_code: '201' }]);
    // Les articles déjà là gardent leurs extras : Cheese Burger toujours sans Gouda.
    expect(await extrasOf('Cheese Burger')).not.toContain('Gouda');
  });

  it('n’écrit rien si une étape échoue', async () => {
    const broken = {
      ...menu,
      categories: [
        ...menu.categories,
        {
          nameFr: 'Test',
          nameEn: 'Test',
          section: 'food' as const,
          display: 'list' as const,
          sortOrder: 99,
        },
      ],
      choiceGroups: [{ key: 'x', nameFr: 'x', nameEn: 'x', options: ['Inconnu'] }],
    };
    await expect(seedMenu(client, broken)).rejects.toThrow('article inconnu Inconnu');
    const { rows } = await client.query("SELECT 1 FROM categories WHERE name_fr = 'Test'");
    expect(rows).toEqual([]);
  });
});
