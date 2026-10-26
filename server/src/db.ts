import pg from 'pg';

export type Db = pg.Pool;

export function createPool(connectionString = process.env.DATABASE_URL): Db {
  if (!connectionString) throw new Error('DATABASE_URL manquant (voir .env.example)');
  const pool = new pg.Pool({ connectionString });
  // Connexion inactive coupée par Postgres (redémarrage, réseau) : pg la retire du pool et la
  // suivante en ouvre une nouvelle. Sans écouteur, Node arrêterait tout le serveur.
  pool.on('error', (err) => {
    console.error('base de données (connexion inactive) :', err);
  });
  return pool;
}

// Journal d'actions : qui (NULL = système), quoi, sur quoi.
export async function audit(
  db: Db | pg.PoolClient,
  entry: {
    userId: number | null;
    action: string;
    entityType?: string;
    entityId?: number;
    tableId?: number;
    note?: string | null;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO audit_log (user_id, action, entity_type, entity_id, table_id, note, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      entry.userId,
      entry.action,
      entry.entityType ?? null,
      entry.entityId ?? null,
      entry.tableId ?? null,
      entry.note ?? null,
      entry.details ?? null,
    ],
  );
}

// Lance plusieurs requêtes indépendantes : en parallèle sur le pool (une connexion chacune),
// l'une après l'autre sur une connexion de transaction, qui n'en exécute qu'une à la fois
// (pg@9 refusera d'en lancer une deuxième avant la fin de la première).
export async function queryAll<T extends unknown[]>(
  db: Db | pg.PoolClient,
  ...queries: { [K in keyof T]: () => Promise<T[K]> }
): Promise<T> {
  if (db instanceof pg.Pool) return (await Promise.all(queries.map((query) => query()))) as T;
  const results: unknown[] = [];
  for (const query of queries) results.push(await query());
  return results as T;
}

// Exécute `work` dans une transaction : COMMIT si tout passe, ROLLBACK et erreur relancée sinon.
export async function inTransaction<T>(
  db: Db,
  work: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
