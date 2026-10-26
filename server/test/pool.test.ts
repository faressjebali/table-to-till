import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPool, type Db } from '../src/db.js';
import { resetTestDatabase, testUrl } from './helpers/db.js';

let db: Db;

beforeAll(async () => {
  await resetTestDatabase();
  db = createPool(testUrl);
});

afterAll(async () => {
  await db.end();
});

describe('pool de connexions', () => {
  it('une connexion inactive coupée par Postgres : journalisée, le serveur continue', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // La connexion retourne au pool après la requête : inactive.
    const { rows } = await db.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
    const admin = new pg.Client({ connectionString: testUrl });
    await admin.connect();
    try {
      await admin.query('SELECT pg_terminate_backend($1)', [rows[0]?.pid]);
    } finally {
      await admin.end();
    }

    await vi.waitFor(() => {
      expect(error).toHaveBeenCalledWith(
        'base de données (connexion inactive) :',
        expect.any(Error),
      );
    });
    // Une nouvelle connexion remplace la morte.
    const after = await db.query<{ ok: number }>('SELECT 1 AS ok');
    expect(after.rows).toEqual([{ ok: 1 }]);
    error.mockRestore();
  });
});
