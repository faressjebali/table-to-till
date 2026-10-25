import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool, inTransaction, type Db } from '../src/db.js';
import { prepareLines } from '../src/orders/lines.js';
import { loadOrders } from '../src/orders/view.js';
import { resetTestDatabase, testUrl } from './helpers/db.js';

let db: Db;

beforeAll(async () => {
  await resetTestDatabase();
  db = createPool(testUrl);
});

afterAll(async () => {
  await db.end();
});

// Connexion de transaction qui compte ses requêtes en cours : pg@9 refusera d'en lancer une
// deuxième avant la fin de la première.
function watched(client: pg.PoolClient): { client: pg.PoolClient; maxActive: () => number } {
  let active = 0;
  let max = 0;
  const query = client.query.bind(client) as (...args: unknown[]) => Promise<unknown>;
  const proxy = new Proxy(client, {
    get(target, prop, receiver) {
      if (prop !== 'query') return Reflect.get(target, prop, receiver) as unknown;
      return async (...args: unknown[]) => {
        active += 1;
        max = Math.max(max, active);
        try {
          return await query(...args);
        } finally {
          active -= 1;
        }
      };
    },
  });
  return { client: proxy, maxActive: () => max };
}

describe('dans une transaction : une requête à la fois sur la connexion', () => {
  it('loadOrders', async () => {
    await inTransaction(db, async (client) => {
      const tx = watched(client);
      expect(await loadOrders(tx.client, [1, 2])).toEqual([]);
      expect(tx.maxActive()).toBe(1);
    });
  });

  it('prepareLines', async () => {
    await inTransaction(db, async (client) => {
      const tx = watched(client);
      // Article inconnu : refusé, mais seulement après les requêtes.
      await prepareLines(tx.client, [{ menuItemId: 999, quantity: 1 }], new Date(), 'staff').catch(
        () => undefined,
      );
      expect(tx.maxActive()).toBe(1);
    });
  });
});
