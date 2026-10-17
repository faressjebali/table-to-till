import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedTables } from '../src/seed/seed-tables.js';
import { parseTablesCsv, TablesCsvError } from '../src/seed/tables-csv.js';
import { resetTestDatabase, testUrl } from './helpers/db.js';

const csv = readFileSync(new URL('../../docs/tables.csv', import.meta.url), 'utf8');
const header = 'number,kind,layout_x,layout_y,offer_for';
const csvWith = (...rows: string[]) => [header, ...rows].join('\n');

describe('parseTablesCsv sur docs/tables.csv', () => {
  const tables = parseTablesCsv(csv);

  it('lit 24 tables réelles et 16 fictives (11 d’offre, 5 de vente directe)', () => {
    const real = tables.filter((t) => t.kind === 'real');
    const virtual = tables.filter((t) => t.kind === 'virtual');
    expect(real).toHaveLength(24);
    expect(virtual).toHaveLength(16);
    expect(virtual.filter((t) => t.offerFor !== null)).toHaveLength(11);
    expect(virtual.filter((t) => t.offerFor === null).map((t) => t.number)).toEqual([
      15, 16, 55, 106, 333,
    ]);
    // Pas de 13 ni de 24 dans la salle (docs/pos.md § Tables).
    expect(real.map((t) => t.number)).not.toContain(13);
    expect(real.map((t) => t.number)).toContain(100);
  });

  it('place chaque table réelle sur le plan', () => {
    expect(tables.find((t) => t.number === 1)).toMatchObject({
      kind: 'real',
      layout: { x: 2, y: 5 },
      offerFor: null,
    });
    expect(tables.find((t) => t.number === 109)).toMatchObject({
      kind: 'virtual',
      layout: null,
      offerFor: 'Hedi Mansour',
    });
  });
});

describe('parseTablesCsv refuse un CSV incohérent', () => {
  it.each([
    ['numéro en double', csvWith('1,real,0,0,', '1,real,1,0,'), 'en double'],
    ['type inconnu', csvWith('1,salle,0,0,'), 'kind inconnu'],
    ['table réelle sans case', csvWith('1,real,,0,'), 'layout_x illisible'],
    ['table fictive sur le plan', csvWith('333,virtual,1,1,'), 'pas de place'],
    ['table réelle d’offre', csvWith('1,real,0,0,Rania'), 'jamais d’offre'],
    ['deux tables sur la même case', csvWith('1,real,0,0,', '2,real,0,0,'), 'déjà prise'],
    ['numéro nul', csvWith('0,virtual,,,'), 'positif'],
  ])('%s', (_name, text, message) => {
    expect(() => parseTablesCsv(text)).toThrow(TablesCsvError);
    expect(() => parseTablesCsv(text)).toThrow(message);
  });

  it('colonne manquante', () => {
    expect(() => parseTablesCsv('number,kind\n1,real')).toThrow('colonnes manquantes');
  });
});

describe('seedTables (base de test)', () => {
  const client = new pg.Client({ connectionString: testUrl });
  const tables = parseTablesCsv(csv);

  beforeAll(async () => {
    await resetTestDatabase();
    await client.connect();
  });
  afterAll(async () => {
    await client.end();
  });
  beforeEach(async () => {
    await client.query('TRUNCATE tables, users RESTART IDENTITY CASCADE');
  });

  type Row = {
    number: number;
    kind: string;
    qr_token: string | null;
    layout_x: number | null;
    layout_shape: string | null;
  };
  const rows = async () =>
    (
      await client.query<Row>(
        'SELECT number, kind, qr_token, layout_x, layout_shape FROM tables ORDER BY number',
      )
    ).rows;

  it('charge les 40 tables : jeton et case carrée pour les réelles, rien pour les fictives', async () => {
    expect(await seedTables(client, tables)).toEqual({
      inserted: 40,
      updated: 0,
      deleted: 0,
      kept: [],
    });
    const all = await rows();
    expect(all).toHaveLength(40);
    const real = all.filter((r) => r.kind === 'real');
    expect(real.every((r) => r.qr_token !== null && r.layout_shape === 'square')).toBe(true);
    expect(new Set(real.map((r) => r.qr_token)).size).toBe(24);
    expect(all.filter((r) => r.kind === 'virtual').every((r) => r.qr_token === null)).toBe(true);
  });

  it('se relance sans changer les jetons ni la forme corrigée par la manager', async () => {
    await seedTables(client, tables);
    await client.query(`UPDATE tables SET layout_shape = 'round' WHERE number = 1`);
    const before = await rows();

    expect(await seedTables(client, tables)).toEqual({
      inserted: 0,
      updated: 40,
      deleted: 0,
      kept: [],
    });
    expect(await rows()).toEqual(before);
  });

  it('remplace les anciennes tables de développement', async () => {
    // Ancien seed:dev-tables : tables réelles 1–20 (dont 13, 15, 16) et fictives 331–335.
    for (let n = 1; n <= 20; n++) {
      await client.query(
        `INSERT INTO tables (number, kind, qr_token, layout_x, layout_y, layout_w, layout_h, layout_shape)
         VALUES ($1, 'real', $2, $1, 0, 1, 1, 'round')`,
        [n, `ancien-${String(n)}`],
      );
    }
    for (const n of [331, 332, 333, 334, 335]) {
      await client.query(`INSERT INTO tables (number, kind) VALUES ($1, 'virtual')`, [n]);
    }

    const result = await seedTables(client, tables);
    expect(result.deleted).toBe(5); // 13, 331, 332, 334, 335
    expect(result.kept).toEqual([]);

    const all = await rows();
    expect(all.map((r) => r.number)).toEqual(tables.map((t) => t.number).sort((a, b) => a - b));
    // 15 était réelle : la voilà fictive, sans jeton ni case.
    expect(all.find((r) => r.number === 15)).toMatchObject({
      kind: 'virtual',
      qr_token: null,
      layout_x: null,
    });
    // 7 garde son jeton (QR déjà imprimé) et prend sa case du plan réel.
    expect(all.find((r) => r.number === 7)).toMatchObject({
      kind: 'real',
      qr_token: 'ancien-7',
      layout_x: 7,
    });
  });

  it('charge le nom des 11 tables d’offre et garde le compte lié par la manager', async () => {
    await seedTables(client, tables);
    const offers = async () =>
      (
        await client.query<{ number: number; offer_label: string; offer_user_id: number | null }>(
          `SELECT number, offer_label, offer_user_id FROM tables
            WHERE offer_label IS NOT NULL ORDER BY number`,
        )
      ).rows;
    expect((await offers()).map((r) => [r.number, r.offer_label])).toEqual([
      [101, 'Karim Haddad'],
      [102, 'Sami Trabelsi'],
      [103, 'Nour Ben Salem'],
      [104, 'Table de test'],
      [105, 'Rania'],
      [107, 'Walid'],
      [109, 'Hedi Mansour'],
      [111, 'Table des artistes'],
      [817, 'Yasmine Ben Salem'],
      [888, 'Rania Gharbi'],
      [1010, 'Walid Chaabane'],
    ]);

    // La manager lie la table 105 à son compte ; le seed du matin ne le défait pas.
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO users (login, name, password_hash, role) VALUES ('rania', 'Rania', 'x', 'manager')
       RETURNING id`,
    );
    const rania = rows[0]?.id;
    await client.query('UPDATE tables SET offer_user_id = $1 WHERE number = 105', [rania]);
    await seedTables(client, tables);
    expect((await offers()).find((r) => r.number === 105)?.offer_user_id).toBe(rania);

    // Retirée des tables d'offre dans le CSV : plus de nom ni de compte.
    await seedTables(
      client,
      tables.map((t) => (t.number === 105 ? { ...t, offerFor: null } : t)),
    );
    expect((await offers()).find((r) => r.number === 105)).toBeUndefined();
  });

  it('garde une table absente du CSV qui a déjà servi', async () => {
    await client.query(`INSERT INTO tables (number, kind) VALUES (331, 'virtual')`);
    await client.query(
      `INSERT INTO orders (client_request_id, table_id, source, status, expires_at)
       SELECT $1, id, 'qr', 'pending', now() FROM tables WHERE number = 331`,
      [randomUUID()],
    );
    const result = await seedTables(client, tables);
    expect(result.deleted).toBe(0);
    expect(result.kept).toEqual([331]);
  });
});
