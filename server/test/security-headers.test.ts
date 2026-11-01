import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db.js';

// En-têtes de sécurité. Ces tests ne touchent pas la base : le pool ne se connecte jamais.
const db = createPool('postgresql://coffee:x@127.0.0.1:1/none');

afterAll(async () => {
  await db.end();
});

describe('en-têtes de sécurité', () => {
  it('sur toutes les réponses, erreurs comprises, sans X-Powered-By', async () => {
    const res = await request(createApp({ db, config: loadConfig() })).get('/api/inconnu');
    expect(res.status).toBe(404);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['cross-origin-opener-policy']).toBe('same-origin');
    const csp = String(res.headers['content-security-policy']);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe/);
  });

  it('HSTS seulement en HTTPS', async () => {
    const http = await request(createApp({ db, config: loadConfig() })).get('/api/inconnu');
    expect(http.headers['strict-transport-security']).toBeUndefined();

    const app = createApp({ db, config: { ...loadConfig(), trustProxy: 1 } });
    const https = await request(app).get('/api/inconnu').set('X-Forwarded-Proto', 'https');
    expect(https.headers['strict-transport-security']).toBe('max-age=31536000');
  });
});
