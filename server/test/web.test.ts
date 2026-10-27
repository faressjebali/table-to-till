import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { loadConfig, type Config } from '../src/config.js';
import { createPool } from '../src/db.js';
import type { WebDirs } from '../src/web.js';

// Les deux apps servies par le serveur (SERVE_WEB), avec de fausses versions construites.
// Ces tests ne touchent pas la base : le pool ne se connecte jamais.
let root: string;
let dirs: WebDirs;

function fakeBuild(dir: string, name: string) {
  mkdirSync(path.join(dir, 'assets'), { recursive: true });
  writeFileSync(path.join(dir, 'index.html'), `<p>${name}</p>`);
  writeFileSync(path.join(dir, 'assets', 'index-abc.js'), `// ${name}`);
}

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'coffee-web-'));
  dirs = { customerWeb: path.join(root, 'customer'), staffApp: path.join(root, 'staff') };
  fakeBuild(dirs.customerWeb, 'menu');
  fakeBuild(dirs.staffApp, 'staff');
  writeFileSync(path.join(dirs.staffApp, 'sw.js'), '// sw');
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const config: Config = { ...loadConfig(), serveWeb: true, staffBasePath: '/staff/' };
const app = () => createApp({ db: createPool('postgresql://unused'), config, webDirs: dirs });

describe('apps servies par le serveur (SERVE_WEB)', () => {
  it('menu QR à la racine : la page pour /t/<jeton>, ses fichiers gardés un an', async () => {
    const page = await request(app()).get('/t/abc123');
    expect(page.status).toBe(200);
    expect(page.text).toBe('<p>menu</p>');
    expect(page.headers['cache-control']).toBe('no-cache');

    const asset = await request(app()).get('/assets/index-abc.js');
    expect(asset.status).toBe(200);
    expect(asset.text).toBe('// menu');
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('app staff sous /staff/ : sa page, son service worker revérifié à chaque fois', async () => {
    const page = await request(app()).get('/staff/');
    expect(page.text).toBe('<p>staff</p>');
    expect((await request(app()).get('/staff/?order=12')).text).toBe('<p>staff</p>');
    expect((await request(app()).get('/staff/assets/index-abc.js')).text).toBe('// staff');

    const sw = await request(app()).get('/staff/sw.js');
    expect(sw.status).toBe(200);
    expect(sw.headers['cache-control']).toBe('no-cache');
  });

  it('/staff redirigé vers /staff/', async () => {
    const res = await request(app()).get('/staff');
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe('/staff/');
  });

  it('fichier absent : 404, jamais la page', async () => {
    expect((await request(app()).get('/assets/ancien.js')).status).toBe(404);
    expect((await request(app()).get('/staff/assets/ancien.js')).status).toBe(404);
  });

  it('adresse /api inconnue : erreur JSON du contrat, pas une page', async () => {
    const res = await request(app()).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Not found' } });
  });

  it('sans SERVE_WEB : aucune page servie', async () => {
    const off = createApp({
      db: createPool('postgresql://unused'),
      config: { ...config, serveWeb: false },
      webDirs: dirs,
    });
    expect((await request(off).get('/t/abc123')).status).toBe(404);
  });

  it('apps non construites : le serveur refuse de démarrer', () => {
    expect(() =>
      createApp({
        db: createPool('postgresql://unused'),
        config,
        webDirs: { ...dirs, staffApp: path.join(root, 'absent') },
      }),
    ).toThrow(/npm run build/);
  });
});

describe('réglages SERVE_WEB et STAFF_BASE_PATH', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('absents : app staff à la racine, rien de servi (comme en local)', () => {
    vi.stubEnv('SERVE_WEB', '');
    vi.stubEnv('STAFF_BASE_PATH', '');
    expect(loadConfig()).toMatchObject({ serveWeb: false, staffBasePath: '/' });
  });

  it('SERVE_WEB sans STAFF_BASE_PATH : refusé (le menu QR est à la racine)', () => {
    vi.stubEnv('SERVE_WEB', 'true');
    vi.stubEnv('STAFF_BASE_PATH', '');
    expect(() => loadConfig()).toThrow(/STAFF_BASE_PATH/);
  });

  it('chemin mal écrit : refusé', () => {
    vi.stubEnv('STAFF_BASE_PATH', '/staff');
    expect(() => loadConfig()).toThrow(/STAFF_BASE_PATH/);
  });
});
