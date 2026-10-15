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
    expect(parseAvailability('until 12:00', 2)).toEqual({
      days: [1, 2, 3, 4, 5, 6, 7],
      availableFrom: null,
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

  it('accepte les codes caisse vides', () => {
    expect(menu.items.find((i) => i.nameFr === 'Avocat')).toMatchObject({
      price: 7000,
      posCode: null,
    });
  });

  it('construit les groupes de choix de docs/api.md', () => {
    const options = Object.fromEntries(menu.choiceGroups.map((g) => [g.key, g.options]));
    expect(options.hot_drink).toHaveLength(22);
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
    expect(await seedMenu(client, menu)).toEqual({ categories: 19, inserted: 97, updated: 0 });
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

  it('se relance sans doublon et garde les ruptures', async () => {
    await client.query("UPDATE menu_items SET sold_out = true WHERE name_fr = 'Avocat'");
    const extrasBefore = await count('suggested_extras');
    const optionsBefore = await count('choice_group_options');

    expect(await seedMenu(client, menu)).toEqual({ categories: 19, inserted: 0, updated: 97 });
    expect(await count('categories')).toBe(19);
    expect(await count('menu_items')).toBe(97);
    expect(await count('suggested_extras')).toBe(extrasBefore);
    expect(await count('choice_group_options')).toBe(optionsBefore);

    const { rows } = await client.query<{ sold_out: boolean }>(
      "SELECT sold_out FROM menu_items WHERE name_fr = 'Avocat'",
    );
    expect(rows).toEqual([{ sold_out: true }]);
  });

  it('écrit l’aide de note dans les deux langues', async () => {
    const withHint = {
      ...menu,
      items: menu.items.map((i) =>
        i.nameFr === 'Espresso' ? { ...i, noteHintFr: 'Sucre ?', noteHintEn: 'Sugar?' } : i,
      ),
    };
    await seedMenu(client, withHint);
    const { rows } = await client.query<{ note_hint_fr: string; note_hint_en: string }>(
      "SELECT note_hint_fr, note_hint_en FROM menu_items WHERE name_fr = 'Espresso'",
    );
    expect(rows).toEqual([{ note_hint_fr: 'Sucre ?', note_hint_en: 'Sugar?' }]);
  });

  it('n’écrit rien si une étape échoue', async () => {
    const broken = {
      ...menu,
      choiceGroups: [{ key: 'x', nameFr: 'x', nameEn: 'x', options: ['Inconnu'] }],
    };
    await client.query("UPDATE menu_items SET price = 1000 WHERE name_fr = 'Avocat'");
    await expect(seedMenu(client, broken)).rejects.toThrow('article inconnu Inconnu');
    const { rows } = await client.query<{ price: number }>(
      "SELECT price FROM menu_items WHERE name_fr = 'Avocat'",
    );
    expect(rows).toEqual([{ price: 1000 }]);
  });
});
