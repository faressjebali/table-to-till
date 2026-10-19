import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrate, resetTestDatabase, testUrl } from './helpers/db.js';

let db: pg.Client;

beforeAll(async () => {
  await resetTestDatabase();
  db = new pg.Client({ connectionString: testUrl });
  await db.connect();
});

afterAll(async () => {
  await db.end();
});

describe('migrations', () => {
  it('descendent puis remontent proprement', async () => {
    await migrate('down');
    const { rowCount } = await db.query(
      "SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'pgmigrations'",
    );
    expect(rowCount).toBe(0);
    await migrate('up');
  });
});

describe('contraintes du schéma', () => {
  let waiterId: number;
  let menuItemId: number;
  let tableId: number;

  beforeEach(async () => {
    await db.query(`TRUNCATE users, categories, choice_groups, tables RESTART IDENTITY CASCADE`);
    waiterId = await insertId(
      `INSERT INTO users (login, name, password_hash, role) VALUES ('sami', 'Sami', 'x', 'waiter') RETURNING id`,
    );
    const categoryId = await insertId(
      `INSERT INTO categories (section, name_fr) VALUES ('drinks', 'Cafés') RETURNING id`,
    );
    menuItemId = await insertId(
      `INSERT INTO menu_items (category_id, name_fr, price, station) VALUES ($1, 'Espresso', 6500, 'bar') RETURNING id`,
      [categoryId],
    );
    tableId = await insertId(
      `INSERT INTO tables (number, kind, qr_token) VALUES (7, 'real', 'tok-7') RETURNING id`,
    );
  });

  async function insertId(sql: string, params: unknown[] = []): Promise<number> {
    const { rows } = await db.query<{ id: number }>(sql, params);
    const row = rows[0];
    if (!row) throw new Error('aucune ligne insérée');
    return row.id;
  }

  // Exécute dans un savepoint pour que l'échec attendu n'empêche pas la suite.
  async function expectRejected(sql: string, params: unknown[] = []) {
    await db.query('BEGIN');
    try {
      await expect(db.query(sql, params)).rejects.toThrow();
    } finally {
      await db.query('ROLLBACK');
    }
  }

  async function confirmedOrder(): Promise<number> {
    const sessionId = await insertId(
      `INSERT INTO table_sessions (table_id) VALUES ($1) RETURNING id`,
      [tableId],
    );
    return insertId(
      `INSERT INTO orders (client_request_id, table_id, table_session_id, source, status, created_by, confirmed_at)
       VALUES ($1, $2, $3, 'waiter', 'confirmed', $4, now()) RETURNING id`,
      [randomUUID(), tableId, sessionId, waiterId],
    );
  }

  it('refuse un prix négatif, nul ou décimal', async () => {
    for (const price of ['-1000', '0', '5.5']) {
      await expectRejected(`UPDATE menu_items SET price = $1 WHERE id = $2`, [price, menuItemId]);
    }
  });

  it('refuse un identifiant de connexion en double, sans tenir compte des majuscules', async () => {
    await expectRejected(
      `INSERT INTO users (login, name, password_hash, role) VALUES ('SAMI', 'Autre', 'x', 'waiter')`,
    );
  });

  it('refuse un rôle inconnu, y compris l’ancien rôle owner', async () => {
    await expectRejected(
      `INSERT INTO users (login, name, password_hash, role) VALUES ('x', 'X', 'x', 'admin')`,
    );
    await expectRejected(
      `INSERT INTO users (login, name, password_hash, role) VALUES ('x', 'X', 'x', 'owner')`,
    );
  });

  it('refuse deux shifts ouverts pour la même personne', async () => {
    await db.query(`INSERT INTO shifts (user_id) VALUES ($1)`, [waiterId]);
    await expectRejected(`INSERT INTO shifts (user_id) VALUES ($1)`, [waiterId]);
  });

  it('refuse deux sessions ouvertes sur la même table', async () => {
    await db.query(`INSERT INTO table_sessions (table_id) VALUES ($1)`, [tableId]);
    await expectRejected(`INSERT INTO table_sessions (table_id) VALUES ($1)`, [tableId]);
  });

  it('refuse une table réelle sans jeton QR et une table fictive avec jeton ou plan', async () => {
    await expectRejected(`INSERT INTO tables (number, kind) VALUES (8, 'real')`);
    await expectRejected(
      `INSERT INTO tables (number, kind, qr_token) VALUES (333, 'virtual', 'tok')`,
    );
    await expectRejected(
      `INSERT INTO tables (number, kind, layout_x, layout_y, layout_w, layout_h, layout_shape)
       VALUES (333, 'virtual', 0, 0, 1, 1, 'square')`,
    );
    await db.query(`INSERT INTO tables (number, kind) VALUES (333, 'virtual')`);
  });

  it('refuse un clientRequestId en double', async () => {
    const sql = `INSERT INTO orders (client_request_id, table_id, source, status, expires_at)
                 VALUES ($1, $2, 'qr', 'pending', now() + interval '5 minutes')`;
    const id = randomUUID();
    await db.query(sql, [id, tableId]);
    await expectRejected(sql, [id, tableId]);
  });

  it('refuse une commande en attente rattachée à une session, ou confirmée sans session', async () => {
    const sessionId = await insertId(
      `INSERT INTO table_sessions (table_id) VALUES ($1) RETURNING id`,
      [tableId],
    );
    await expectRejected(
      `INSERT INTO orders (client_request_id, table_id, table_session_id, source, status, expires_at)
       VALUES ($1, $2, $3, 'qr', 'pending', now())`,
      [randomUUID(), tableId, sessionId],
    );
    await expectRejected(
      `INSERT INTO orders (client_request_id, table_id, source, status, created_by, confirmed_at)
       VALUES ($1, $2, 'waiter', 'confirmed', $3, now())`,
      [randomUUID(), tableId, waiterId],
    );
  });

  it('refuse une remise autre que 0 ou 20 %, une quantité hors 1–20 et une note trop longue', async () => {
    const orderId = await confirmedOrder();
    const sql = `INSERT INTO order_lines (order_id, menu_item_id, name_fr, quantity, unit_price, discount_percent, note, station)
                 VALUES ($1, $2, 'Espresso', $3, 6500, $4, $5, 'bar')`;
    await db.query(sql, [orderId, menuItemId, 1, 20, 'sans sucre']);
    await expectRejected(sql, [orderId, menuItemId, 1, 10, null]);
    await expectRejected(sql, [orderId, menuItemId, 0, 0, null]);
    await expectRejected(sql, [orderId, menuItemId, 21, 0, null]);
    await expectRejected(sql, [orderId, menuItemId, 1, 0, 'x'.repeat(201)]);
  });

  it('accepte un offert sans table et refuse un offert sans note ou rattaché à une session sans table', async () => {
    const sql = `INSERT INTO gifts (table_id, table_session_id, menu_item_id, quantity, reason, given_by, note)
                 VALUES ($1, $2, $3, 1, $4, $5, $6)`;
    await db.query(sql, [null, null, menuItemId, 'staff', waiterId, 'café de Sami']);
    await expectRejected(sql, [null, null, menuItemId, 'staff', waiterId, '']);
    await expectRejected(sql, [null, null, menuItemId, 'friend', waiterId, 'x']);
    await expectRejected(sql, [null, null, menuItemId, 'owner', waiterId, 'café du patron']);

    const sessionId = await insertId(
      `INSERT INTO table_sessions (table_id) VALUES ($1) RETURNING id`,
      [tableId],
    );
    await expectRejected(sql, [
      null,
      sessionId,
      menuItemId,
      'unhappy_customer',
      waiterId,
      'attente',
    ]);
    await db.query(sql, [tableId, sessionId, menuItemId, 'unhappy_customer', waiterId, 'attente']);
  });

  it("refuse le statut de ligne gifted : un offert n'est jamais une ligne de commande", async () => {
    const orderId = await confirmedOrder();
    await expectRejected(
      `INSERT INTO order_lines (order_id, menu_item_id, name_fr, quantity, unit_price, status, station)
       VALUES ($1, $2, 'Espresso', 1, 6500, 'gifted', 'bar')`,
      [orderId, menuItemId],
    );
  });

  it('refuse deux tâches caisse en cours en même temps', async () => {
    const sql = `INSERT INTO pos_jobs (type, status, table_id) VALUES ('print_bill', $1, $2)`;
    await db.query(sql, ['in_progress', tableId]);
    await db.query(sql, ['queued', tableId]);
    await expectRejected(sql, ['in_progress', tableId]);
  });

  it("n'accepte le statut waiting que pour une annulation", async () => {
    await expectRejected(
      `INSERT INTO pos_jobs (type, status, table_id) VALUES ('print_bill', 'waiting', $1)`,
      [tableId],
    );
    await db.query(
      `INSERT INTO pos_jobs (type, status, table_id) VALUES ('cancel_line', 'waiting', $1)`,
      [tableId],
    );
  });

  it('refuse des horaires incohérents ou un jour invalide', async () => {
    await expectRejected(
      `UPDATE menu_items SET available_from = '15:00', available_until = '08:00' WHERE id = $1`,
      [menuItemId],
    );
    await expectRejected(`UPDATE menu_items SET days = '{0,1}' WHERE id = $1`, [menuItemId]);
    await expectRejected(`UPDATE menu_items SET days = '{}' WHERE id = $1`, [menuItemId]);
  });
});
