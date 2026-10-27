import path from 'node:path';
import { runner } from 'node-pg-migrate';
import { pgConfig } from './db.js';

// Migrations (migrations/, SQL pur), avec le même réglage de connexion que le serveur (fuseau
// Africa/Tunis, PGSSLMODE) : src/migrate.ts et les tests.
const migrationsDir = path.join(import.meta.dirname, '../migrations');

export async function runMigrations(databaseUrl: string, direction: 'up' | 'down') {
  await runner({
    databaseUrl: pgConfig(databaseUrl),
    dir: migrationsDir,
    direction,
    // Comme la commande node-pg-migrate : toutes les migrations en montant, une en descendant.
    count: direction === 'up' ? Infinity : 1,
    migrationsTable: 'pgmigrations',
    checkOrder: true,
    singleTransaction: true,
  });
}
