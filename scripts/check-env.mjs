#!/usr/bin/env node
// Vérifie .env par rapport à .env.example (appelé par scripts/start-day.sh, avant Docker) :
// - pas de .env : copie de .env.example (avec une paire VAPID), puis arrêt pour remplir les change-me ;
// - variables manquantes : ajoutées à la fin avec la valeur d'exemple ;
// - VAPID absentes : paire générée, VITE_VAPID_PUBLIC_KEY = la même clé publique ;
// - change-me, variables en trop ou en double, clés publiques différentes : avertissement.
// Ne modifie jamais une valeur existante (seulement des valeurs vides ou des lignes ajoutées),
// sauvegarde .env.bak avant toute modification, n'affiche que des noms, jamais des valeurs.
// Sans dépendance : marche avant `npm ci`, sous Linux et Git Bash (fichiers LF ou CRLF).
// Usage : node scripts/check-env.mjs [dossier]   (par défaut : la racine du repo)
// Code de sortie : 0 = on continue, 1 = arrêt (.env créé à remplir, ou erreur).

import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;
const PLACEHOLDER_SUBJECT = 'mailto:you@example.com';
const VAPID_PUBLIC = 'VAPID_PUBLIC_KEY';
const VAPID_PRIVATE = 'VAPID_PRIVATE_KEY';
const VAPID_SUBJECT = 'VAPID_SUBJECT';
const VITE_PUBLIC = 'VITE_VAPID_PUBLIC_KEY';

/** Lignes d'un fichier .env, avec sa fin de ligne (CRLF gardé tel quel). */
export function parseEnv(text) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const raw = text.split(/\r?\n/);
  // Le dernier saut de ligne ne crée pas de ligne vide.
  if (raw.length > 0 && raw[raw.length - 1] === '') raw.pop();
  const lines = raw.map((line) => {
    const match = LINE.exec(line);
    return match ? { raw: line, key: match[1], value: unquote(match[2]) } : { raw: line };
  });
  return { eol, lines };
}

function unquote(value) {
  const trimmed = value.trim();
  const quoted = /^(["'])(.*)\1$/.exec(trimmed);
  return quoted ? quoted[2] : trimmed;
}

/** Valeur effective : la dernière ligne gagne, comme pour Node et Vite. */
function valueOf(lines, key) {
  let value;
  for (const line of lines) if (line.key === key) value = line.value;
  return value;
}

/** Paire VAPID (P-256) au format de web-push : clés en base64url, publique non compressée. */
export function generateVapidKeys() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pub = publicKey.export({ format: 'jwk' });
  const priv = privateKey.export({ format: 'jwk' });
  const point = Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(pub.x, 'base64url'),
    Buffer.from(pub.y, 'base64url'),
  ]);
  return { publicKey: point.toString('base64url'), privateKey: priv.d };
}

const isEmail = (email) => /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email);

/**
 * Compare .env à .env.example. `envText` : null si .env n'existe pas.
 * Renvoie le nouveau contenu (`text`, null si rien ne change) et des listes de noms seulement.
 */
export function checkEnv({
  envText,
  exampleText,
  email = '',
  vapidKeys = generateVapidKeys,
  today = new Date(),
}) {
  const example = parseEnv(exampleText);
  const exampleKeys = [...new Set(example.lines.filter((l) => l.key).map((l) => l.key))];
  const created = envText === null;
  const { eol, lines } = parseEnv(created ? exampleText : envText);
  const result = {
    created,
    added: [],
    filled: [],
    changeMe: [],
    extra: [],
    duplicates: [],
    vapidGenerated: false,
    vapidIncomplete: false,
    viteMismatch: false,
    invalidEmail: false,
  };

  // Variables manquantes : à la fin, avec la valeur d'exemple.
  const present = new Set(lines.filter((l) => l.key).map((l) => l.key));
  const missing = exampleKeys.filter((key) => !present.has(key));
  if (missing.length > 0) {
    const date = today.toISOString().slice(0, 10);
    lines.push(
      { raw: '' },
      { raw: `# Ajouté par scripts/start-day.sh le ${date} (valeurs de .env.example)` },
    );
    for (const key of missing) {
      const line = example.lines.findLast((l) => l.key === key);
      lines.push({ raw: line.raw, key, value: line.value });
    }
    result.added = missing;
  }

  // Remplit une valeur vide (ou encore à sa valeur d'exemple pour VAPID_SUBJECT) : la dernière
  // ligne de la variable, celle qui compte. Jamais une valeur déjà remplie.
  const fill = (key, value) => {
    const line = lines.findLast((l) => l.key === key);
    line.raw = `${key}=${value}`;
    line.value = value;
    if (!result.added.includes(key) && !result.filled.includes(key)) result.filled.push(key);
  };
  const empty = (key) => (valueOf(lines, key) ?? '') === '';
  const vapidUsed = exampleKeys.includes(VAPID_PUBLIC) && exampleKeys.includes(VAPID_PRIVATE);

  if (vapidUsed && empty(VAPID_PUBLIC) && empty(VAPID_PRIVATE)) {
    const keys = vapidKeys();
    fill(VAPID_PUBLIC, keys.publicKey);
    fill(VAPID_PRIVATE, keys.privateKey);
    result.vapidGenerated = true;
    if (exampleKeys.includes(VAPID_SUBJECT)) {
      const subject = valueOf(lines, VAPID_SUBJECT) ?? '';
      if (subject === '' || subject === PLACEHOLDER_SUBJECT) {
        if (isEmail(email)) fill(VAPID_SUBJECT, `mailto:${email}`);
        else result.invalidEmail = true;
      }
    }
  } else if (vapidUsed && (empty(VAPID_PUBLIC) || empty(VAPID_PRIVATE))) {
    // Une seule clé : en régénérer une remplacerait une clé existante.
    result.vapidIncomplete = true;
  }
  if (exampleKeys.includes(VITE_PUBLIC) && empty(VITE_PUBLIC) && !empty(VAPID_PUBLIC)) {
    fill(VITE_PUBLIC, valueOf(lines, VAPID_PUBLIC));
  }
  if (!empty(VITE_PUBLIC) && !empty(VAPID_PUBLIC)) {
    result.viteMismatch = valueOf(lines, VITE_PUBLIC) !== valueOf(lines, VAPID_PUBLIC);
  }

  const counts = new Map();
  for (const line of lines) if (line.key) counts.set(line.key, (counts.get(line.key) ?? 0) + 1);
  result.duplicates = [...counts].filter(([, n]) => n > 1).map(([key]) => key);
  result.extra = [...counts.keys()].filter((key) => !exampleKeys.includes(key));
  result.changeMe = [...counts.keys()].filter((key) =>
    (valueOf(lines, key) ?? '').toLowerCase().includes('change-me'),
  );

  const changed = created || result.added.length > 0 || result.filled.length > 0;
  result.text = changed ? lines.map((l) => l.raw).join(eol) + eol : null;
  return result;
}

const color = (code) => (text) => `\u001b[${code}m${text}\u001b[0m`;
const ok = (text) => console.log(color(32)(`✔ ${text}`));
const info = (text) => console.log(color(36)(`→ ${text}`));
const warn = (text) => console.log(color(33)(`⚠ ${text}`));
const stop = (text) => console.log(color(31)(`✘ ${text}`));
const names = (list) => list.join(', ');

function gitEmail(cwd) {
  try {
    return execFileSync('git', ['config', 'user.email'], { cwd, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

export function main(root) {
  const envPath = path.join(root, '.env');
  const examplePath = path.join(root, '.env.example');
  if (!existsSync(examplePath)) {
    stop('.env.example introuvable.');
    return 1;
  }
  const exists = existsSync(envPath);
  const result = checkEnv({
    envText: exists ? readFileSync(envPath, 'utf8') : null,
    exampleText: readFileSync(examplePath, 'utf8'),
    email: gitEmail(root),
  });

  if (result.text !== null) {
    if (exists) copyFileSync(envPath, path.join(root, '.env.bak'));
    writeFileSync(envPath, result.text);
  }

  if (result.created) info('.env absent : copié depuis .env.example.');
  if (result.added.length > 0) info(`Ajouté à la fin de .env : ${names(result.added)}`);
  if (result.vapidGenerated) info('Clés VAPID générées (notifications push).');
  if (result.filled.length > 0) info(`Rempli dans .env : ${names(result.filled)}`);
  if (result.text !== null && exists) info('Ancien fichier sauvegardé dans .env.bak.');
  if (result.invalidEmail) {
    warn(
      `${VAPID_SUBJECT} : pas d'adresse valide dans git config user.email, remplis-le à la main.`,
    );
  }
  if (result.vapidIncomplete) {
    warn(
      `${VAPID_PUBLIC} ou ${VAPID_PRIVATE} est vide, l'autre non : rien n'est généré (une clé existante serait remplacée). Vide les deux pour en générer une paire neuve.`,
    );
  }
  if (result.viteMismatch) {
    warn(
      `${VITE_PUBLIC} est différente de ${VAPID_PUBLIC} : les notifications push n'arriveront pas.`,
    );
  }
  if (result.duplicates.length > 0) {
    warn(`En double dans .env (la dernière ligne compte) : ${names(result.duplicates)}`);
  }
  if (result.extra.length > 0) {
    warn(`Absent de .env.example (gardé tel quel) : ${names(result.extra)}`);
  }
  if (result.created) {
    stop(`Remplis les change-me dans .env (${names(result.changeMe)}), puis relance.`);
    return 1;
  }
  if (result.changeMe.length > 0) warn(`Encore « change-me » : ${names(result.changeMe)}`);
  if (result.text === null) ok('.env complet');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  process.exitCode = main(root);
}
