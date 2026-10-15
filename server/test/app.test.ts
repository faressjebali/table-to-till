import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db.js';

// Ces tests ne touchent pas la base : le pool ne se connecte jamais.
const app = () => createApp({ db: createPool('postgresql://unused'), config: loadConfig() });

describe('app', () => {
  it('répond 404 NOT_FOUND au format du contrat pour une route inconnue', async () => {
    const res = await request(app()).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Not found' } });
  });

  it('répond 400 VALIDATION_ERROR pour un JSON mal formé', async () => {
    const res = await request(app())
      .post('/api/anything')
      .set('Content-Type', 'application/json')
      .send('{bad');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });
});
