// npm run seed:dev-tables : tables de DÉVELOPPEMENT, pour tester le menu QR et le plan des tables.
// Les vraies tables (numéros, disposition, tables fictives) seront relevées à la visite au café.
// Relançable : une table qui existe déjà garde son jeton.
import { randomBytes } from 'node:crypto';
import pg from 'pg';

const REAL_TABLES = 20;
const COLUMNS = 5;
const VIRTUAL_TABLES = [331, 332, 333, 334, 335];
const CUSTOMER_WEB_URL = process.env.CUSTOMER_WEB_URL ?? 'http://localhost:5173';

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('seed:dev-tables est réservé au développement');
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL manquant (voir .env.example)');

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    for (let n = 1; n <= REAL_TABLES; n++) {
      // Plan en grille : 5 tables par rangée, une case vide entre deux tables.
      const x = ((n - 1) % COLUMNS) * 2;
      const y = Math.floor((n - 1) / COLUMNS) * 2;
      await client.query(
        `INSERT INTO tables (number, kind, qr_token, layout_x, layout_y, layout_w, layout_h, layout_shape)
         VALUES ($1, 'real', $2, $3, $4, 1, 1, $5)
         ON CONFLICT (number) DO NOTHING`,
        [n, randomBytes(16).toString('base64url'), x, y, n % 2 === 0 ? 'round' : 'square'],
      );
    }
    for (const n of VIRTUAL_TABLES) {
      await client.query(
        `INSERT INTO tables (number, kind) VALUES ($1, 'virtual') ON CONFLICT (number) DO NOTHING`,
        [n],
      );
    }

    const { rows } = await client.query<{ number: number; qr_token: string }>(
      `SELECT number, qr_token FROM tables WHERE kind = 'real' ORDER BY number`,
    );
    console.log(
      `Tables de développement : ${String(rows.length)} réelles, fictives ${VIRTUAL_TABLES.join(', ')}.`,
    );
    for (const row of rows) {
      console.log(
        `  table ${String(row.number).padStart(2)}  ${CUSTOMER_WEB_URL}/t/${row.qr_token}`,
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
