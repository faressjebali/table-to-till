// npm run seed : charge docs/menu/menu.csv puis docs/tables.csv dans la base (DATABASE_URL).
// Le menu : ajoute seulement ce qui manque, ne modifie jamais rien (l'app est la référence du menu).
// En production : lancé une seule fois, sur une base vide.
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { parseMenuCsv } from './menu-csv.js';
import { seedMenu } from './seed-menu.js';
import { seedTables } from './seed-tables.js';
import { parseTablesCsv } from './tables-csv.js';

const MENU_CSV = new URL('../../../docs/menu/menu.csv', import.meta.url);
const TABLES_CSV = new URL('../../../docs/tables.csv', import.meta.url);

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL manquant (voir .env.example)');

  const menu = parseMenuCsv(await readFile(MENU_CSV, 'utf8'));
  const tables = parseTablesCsv(await readFile(TABLES_CSV, 'utf8'));
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await seedMenu(client, menu);
    console.log(
      `Menu chargé : ${String(result.categories)} catégories, ${String(result.inserted)} articles ajoutés, ${String(result.skipped)} déjà présents (non modifiés).`,
    );
    const t = await seedTables(client, tables);
    console.log(
      `Tables chargées : ${String(t.inserted)} ajoutées, ${String(t.updated)} mises à jour, ${String(t.deleted)} supprimées (jetons QR gardés ; liens : npm run tables:links).`,
    );
    if (t.kept.length > 0) {
      console.warn(
        `⚠ Tables absentes de docs/tables.csv gardées car déjà utilisées : ${t.kept.join(', ')}.`,
      );
    }
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
