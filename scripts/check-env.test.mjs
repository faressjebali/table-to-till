// Tests de scripts/check-env.mjs : node --test scripts/ (npm run test:scripts).
import assert from 'node:assert/strict';
import { createECDH } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { checkEnv, generateVapidKeys, main, parseEnv } from './check-env.mjs';

const EXAMPLE = `# Base
POSTGRES_PASSWORD=change-me
PORT=3000

# Push
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:you@example.com
VITE_VAPID_PUBLIC_KEY=
`;
const KEYS = { publicKey: 'PUBLIQUE', privateKey: 'PRIVEE' };
const TODAY = new Date('2026-10-19T10:00:00Z');
const check = (envText, options = {}) =>
  checkEnv({
    envText,
    exampleText: EXAMPLE,
    email: 'idriss@example.com',
    vapidKeys: () => KEYS,
    today: TODAY,
    ...options,
  });
const values = (text) =>
  Object.fromEntries(
    parseEnv(text)
      .lines.filter((l) => l.key)
      .map((l) => [l.key, l.value]),
  );

const COMPLETE = `POSTGRES_PASSWORD=secret
PORT=4000
VAPID_PUBLIC_KEY=pub
VAPID_PRIVATE_KEY=priv
VAPID_SUBJECT=mailto:a@b.tn
VITE_VAPID_PUBLIC_KEY=pub
`;

describe('checkEnv', () => {
  it('.env complet : rien ne change', () => {
    const result = check(COMPLETE);
    assert.equal(result.text, null);
    assert.deepEqual(
      [result.added, result.filled, result.changeMe, result.extra],
      [[], [], [], []],
    );
  });

  it('pas de .env : copie de l’exemple avec une paire VAPID, change-me listés', () => {
    const result = check(null);
    assert.equal(result.created, true);
    assert.deepEqual(values(result.text), {
      POSTGRES_PASSWORD: 'change-me',
      PORT: '3000',
      VAPID_PUBLIC_KEY: 'PUBLIQUE',
      VAPID_PRIVATE_KEY: 'PRIVEE',
      VAPID_SUBJECT: 'mailto:idriss@example.com',
      VITE_VAPID_PUBLIC_KEY: 'PUBLIQUE',
    });
    assert.deepEqual(result.changeMe, ['POSTGRES_PASSWORD']);
    assert.match(result.text, /^# Base\n/);
  });

  it('variables manquantes : ajoutées à la fin avec la valeur d’exemple, le reste intact', () => {
    const env = 'POSTGRES_PASSWORD=secret\nVAPID_PUBLIC_KEY=pub\nVAPID_PRIVATE_KEY=priv\n';
    const result = check(env);
    assert.deepEqual(result.added, ['PORT', 'VAPID_SUBJECT', 'VITE_VAPID_PUBLIC_KEY']);
    assert.ok(result.text.startsWith(env));
    assert.match(result.text, /# Ajouté par scripts\/start-day.sh le 2026-10-19/);
    assert.equal(values(result.text).PORT, '3000');
    // Clé publique existante recopiée pour l'app staff ; paire existante gardée.
    assert.equal(values(result.text).VITE_VAPID_PUBLIC_KEY, 'pub');
    assert.equal(result.vapidGenerated, false);
  });

  it('ne modifie jamais une valeur existante, même change-me ou l’adresse d’exemple', () => {
    const env = COMPLETE.replace('secret', 'change-me').replace(
      'mailto:a@b.tn',
      'mailto:you@example.com',
    );
    const result = check(env);
    assert.equal(result.text, null);
    assert.deepEqual(result.changeMe, ['POSTGRES_PASSWORD']);
  });

  it('VAPID vides : paire générée, VITE = même clé publique, adresse git', () => {
    const env = COMPLETE.replace('=pub\n', '=\n')
      .replace('=priv\n', '=\n')
      .replace('VITE_VAPID_PUBLIC_KEY=pub', 'VITE_VAPID_PUBLIC_KEY=')
      .replace('mailto:a@b.tn', 'mailto:you@example.com');
    const result = check(env);
    assert.equal(result.vapidGenerated, true);
    assert.deepEqual(result.filled, [
      'VAPID_PUBLIC_KEY',
      'VAPID_PRIVATE_KEY',
      'VAPID_SUBJECT',
      'VITE_VAPID_PUBLIC_KEY',
    ]);
    const v = values(result.text);
    assert.equal(v.VAPID_PUBLIC_KEY, 'PUBLIQUE');
    assert.equal(v.VITE_VAPID_PUBLIC_KEY, 'PUBLIQUE');
    assert.equal(v.VAPID_SUBJECT, 'mailto:idriss@example.com');
    assert.equal(v.PORT, '4000');
  });

  it('VAPID générées : une adresse déjà remplie est gardée, une adresse git invalide signalée', () => {
    const env = COMPLETE.replace('=pub\n', '=\n').replace('=priv\n', '=\n');
    const kept = check(env);
    assert.equal(values(kept.text).VAPID_SUBJECT, 'mailto:a@b.tn');
    // VITE déjà remplie : gardée, mais différente de la nouvelle clé publique.
    assert.equal(values(kept.text).VITE_VAPID_PUBLIC_KEY, 'pub');
    assert.equal(kept.viteMismatch, true);

    const invalid = check(null, { email: 'idriss@gmail..com' });
    assert.equal(invalid.invalidEmail, true);
    assert.equal(values(invalid.text).VAPID_SUBJECT, 'mailto:you@example.com');
  });

  it('une seule clé VAPID : rien n’est généré, avertissement', () => {
    const result = check(COMPLETE.replace('=priv\n', '=\n'));
    assert.equal(result.vapidIncomplete, true);
    assert.equal(result.vapidGenerated, false);
    assert.equal(result.text, null);
  });

  it('variables en trop ou en double : avertissement seulement, rien supprimé', () => {
    const env = `${COMPLETE}AUTRE=1\nVAPID_PUBLIC_KEY=pub\n`;
    const result = check(env);
    assert.equal(result.text, null);
    assert.deepEqual(result.extra, ['AUTRE']);
    assert.deepEqual(result.duplicates, ['VAPID_PUBLIC_KEY']);
  });

  it('en double : la dernière ligne compte, comme Node', () => {
    const env = COMPLETE.replace('VITE_VAPID_PUBLIC_KEY=pub\n', '') + 'VITE_VAPID_PUBLIC_KEY=\n';
    const result = check(`${env}VAPID_PUBLIC_KEY=autre\n`);
    assert.equal(values(result.text).VITE_VAPID_PUBLIC_KEY, 'autre');
  });

  it('CRLF : lu correctement, lignes ajoutées en CRLF, pas de ligne vide de trop', () => {
    const env = 'POSTGRES_PASSWORD=secret\r\nVAPID_PUBLIC_KEY=pub\r\nVAPID_PRIVATE_KEY=priv\r\n';
    const result = check(env);
    assert.deepEqual(result.added, ['PORT', 'VAPID_SUBJECT', 'VITE_VAPID_PUBLIC_KEY']);
    assert.equal(values(result.text).VITE_VAPID_PUBLIC_KEY, 'pub');
    assert.ok(result.text.startsWith(env));
    assert.equal(result.text.replace(/\r\n/g, '').includes('\n'), false);
    assert.ok(result.text.endsWith('\r\n'));
    assert.equal(result.text.includes('\r\n\r\n\r\n'), false);
  });

  it('fichier sans saut de ligne final, valeurs entre guillemets', () => {
    const result = check(COMPLETE.replace('PORT=4000', 'PORT="4000"').trimEnd());
    assert.equal(result.text, null);
    const added = check('POSTGRES_PASSWORD="secret"');
    assert.ok(added.text.startsWith('POSTGRES_PASSWORD="secret"\n'));
    assert.equal(added.changeMe.length, 0);
  });
});

it('generateVapidKeys : clé publique P-256 non compressée (65 octets), privée de 32 octets', () => {
  const { publicKey, privateKey } = generateVapidKeys();
  const pub = Buffer.from(publicKey, 'base64url');
  assert.equal(pub.length, 65);
  assert.equal(pub[0], 0x04);
  assert.equal(Buffer.from(privateKey, 'base64url').length, 32);
  // La clé publique correspond bien à la privée.
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(Buffer.from(privateKey, 'base64url'));
  assert.equal(ecdh.getPublicKey().toString('base64url'), publicKey);
});

describe('main', () => {
  let dir;
  let output;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'check-env-'));
    writeFileSync(path.join(dir, '.env.example'), EXAMPLE);
    output = [];
    mock.method(console, 'log', (text) => output.push(text));
  });
  afterEach(() => {
    mock.restoreAll();
    rmSync(dir, { recursive: true, force: true });
  });

  it('pas de .env : le crée et demande d’arrêter', () => {
    assert.equal(main(dir), 1);
    assert.ok(existsSync(path.join(dir, '.env')));
    assert.equal(existsSync(path.join(dir, '.env.bak')), false);
  });

  it('sauvegarde .env.bak avant de modifier, et n’affiche jamais de valeur', () => {
    const env = 'POSTGRES_PASSWORD=tres-secret\nAUTRE=valeur-cachee\n';
    writeFileSync(path.join(dir, '.env'), env);
    assert.equal(main(dir), 0);
    assert.equal(readFileSync(path.join(dir, '.env.bak'), 'utf8'), env);
    const after = values(readFileSync(path.join(dir, '.env'), 'utf8'));
    assert.equal(after.POSTGRES_PASSWORD, 'tres-secret');
    assert.equal(after.VAPID_PUBLIC_KEY, after.VITE_VAPID_PUBLIC_KEY);
    const printed = output.join('\n');
    for (const secret of [
      'tres-secret',
      'valeur-cachee',
      after.VAPID_PRIVATE_KEY,
      after.VAPID_PUBLIC_KEY,
    ]) {
      assert.equal(printed.includes(secret), false);
    }
    assert.match(printed, /AUTRE/);
  });

  it('rien à changer : pas de .env.bak, fichier intact', () => {
    writeFileSync(path.join(dir, '.env'), COMPLETE);
    assert.equal(main(dir), 0);
    assert.equal(existsSync(path.join(dir, '.env.bak')), false);
    assert.equal(readFileSync(path.join(dir, '.env'), 'utf8'), COMPLETE);
  });
});
