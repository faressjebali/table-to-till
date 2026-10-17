// npm run tables:links : lien du QR de chaque table réelle (<CUSTOMER_WEB_URL>/t/<tableToken>, docs/api.md § 3).
// Les jetons sont créés par npm run seed et ne changent jamais (sauf rotate-token).
import pg from 'pg';

const CUSTOMER_WEB_URL = process.env.CUSTOMER_WEB_URL ?? 'http://localhost:5173';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL manquant (voir .env.example)');

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const { rows } = await client.query<{ number: number; qr_token: string }>(
      `SELECT number, qr_token FROM tables WHERE kind = 'real' ORDER BY number`,
    );
    if (rows.length === 0) console.log('Aucune table : lancer d’abord npm run seed.');
    for (const row of rows) {
      console.log(`table ${String(row.number).padStart(3)}  ${CUSTOMER_WEB_URL}/t/${row.qr_token}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
