import pg from 'pg';

export type Db = pg.Pool;

export function createPool(connectionString = process.env.DATABASE_URL): Db {
  if (!connectionString) throw new Error('DATABASE_URL manquant (voir .env.example)');
  return new pg.Pool({ connectionString });
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
    details?: Record<string, unknown>;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO audit_log (user_id, action, entity_type, entity_id, table_id, details)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      entry.userId,
      entry.action,
      entry.entityType ?? null,
      entry.entityId ?? null,
      entry.tableId ?? null,
      entry.details ?? null,
    ],
  );
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
