import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
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

describe('GET /health', () => {
  it('sans connexion : base joignable', async () => {
    const res = await request(createApp({ db, config: loadConfig() })).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db: 'ok', time: expect.any(String) as unknown });
    const { time } = res.body as { time: string };
    expect(Number.isNaN(Date.parse(time))).toBe(false);
  });

  it('base injoignable : 503 SERVICE_UNAVAILABLE', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const down = createPool('postgresql://coffee:x@127.0.0.1:1/none');
    try {
      const res = await request(createApp({ db: down, config: loadConfig() })).get('/api/health');
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ error: { code: 'SERVICE_UNAVAILABLE' } });
    } finally {
      await down.end();
      error.mockRestore();
    }
  });
});
