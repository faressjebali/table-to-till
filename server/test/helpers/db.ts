import path from 'node:path';
import { runner } from 'node-pg-migrate';
import pg from 'pg';

// Base de test séparée (TEST_DATABASE_URL), créée si besoin et vidée à chaque lancement.
try {
  process.loadEnvFile(path.join(import.meta.dirname, '../../../.env'));
} catch {
  // Pas de .env : TEST_DATABASE_URL doit venir de l'environnement.
}
export const testUrl = process.env.TEST_DATABASE_URL ?? '';
if (!testUrl) throw new Error('TEST_DATABASE_URL manquant (voir .env.example)');

const migrationsDir = path.join(import.meta.dirname, '../../migrations');

export async function migrate(direction: 'up' | 'down') {
  await runner({
    databaseUrl: testUrl,
    dir: migrationsDir,
    direction,
    count: Infinity,
    migrationsTable: 'pgmigrations',
    log: () => undefined,
  });
}

async function createTestDatabase(url: string) {
  const dbName = new URL(url).pathname.slice(1);
  const admin = new pg.Client({ connectionString: url.replace(/\/[^/]*$/, '/postgres') });
  await admin.connect();
  try {
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      dbName,
    ]);
    if (!rowCount) await admin.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.end();
  }
}

// Base de test vide, toutes migrations appliquées.
export async function resetTestDatabase() {
  await createTestDatabase(testUrl);
  const db = new pg.Client({ connectionString: testUrl });
  await db.connect();
  try {
    await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  } finally {
    await db.end();
  }
  await migrate('up');
}
