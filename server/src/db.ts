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
    details?: Record<string, unknown>;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      entry.userId,
      entry.action,
      entry.entityType ?? null,
      entry.entityId ?? null,
      entry.details ?? null,
    ],
  );
}
