// npm run migrate (en local) ou migrate:release (au déploiement, depuis dist/) : applique les
// migrations à la base (DATABASE_URL). `down` : annule la dernière (développement seulement).
import { runMigrations } from './migrations.js';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL manquant (voir .env.example)');
  await runMigrations(databaseUrl, process.argv[2] === 'down' ? 'down' : 'up');
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
