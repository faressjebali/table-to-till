import { randomBytes } from 'node:crypto';
import type { ClientBase } from 'pg';
import type { SeedTable } from './tables-csv.js';

export interface SeedTablesResult {
  inserted: number;
  updated: number;
  deleted: number;
  /** Tables absentes du CSV mais gardées : elles ont déjà servi (commandes, sessions…). */
  kept: number[];
}

// Jeton aléatoire du QR (docs/api.md § 3) : jamais le numéro de la table.
export function newTableToken(): string {
  return randomBytes(16).toString('base64url');
}

/**
 * Aligne la table `tables` sur docs/tables.csv, dans une seule transaction. Relançable :
 * une table est reconnue par son numéro et garde son jeton QR (un QR imprimé ne casse jamais).
 * Le type et la case du plan sont réécrits ; la taille et la forme corrigées par la manager restent.
 * Une table absente du CSV est supprimée seulement si elle n'a jamais servi.
 */
export async function seedTables(
  client: ClientBase,
  tables: readonly SeedTable[],
): Promise<SeedTablesResult> {
  const result: SeedTablesResult = { inserted: 0, updated: 0, deleted: 0, kept: [] };

  await client.query('BEGIN');
  try {
    for (const table of tables) {
      const { rowCount } = await client.query('SELECT 1 FROM tables WHERE number = $1', [
        table.number,
      ]);
      if (table.kind === 'real') {
        const layout = table.layout;
        if (!layout) throw new Error(`table ${String(table.number)} sans case sur le plan`);
        await client.query(
          `INSERT INTO tables (number, kind, qr_token, layout_x, layout_y, layout_w, layout_h, layout_shape)
           VALUES ($1, 'real', $2, $3, $4, 1, 1, 'square')
           ON CONFLICT (number) DO UPDATE SET
             kind = 'real',
             qr_token = coalesce(tables.qr_token, EXCLUDED.qr_token),
             layout_x = EXCLUDED.layout_x,
             layout_y = EXCLUDED.layout_y,
             layout_w = coalesce(tables.layout_w, 1),
             layout_h = coalesce(tables.layout_h, 1),
             layout_shape = coalesce(tables.layout_shape, 'square')`,
          [table.number, newTableToken(), layout.x, layout.y],
        );
      } else {
        await client.query(
          `INSERT INTO tables (number, kind) VALUES ($1, 'virtual')
           ON CONFLICT (number) DO UPDATE SET
             kind = 'virtual', qr_token = NULL, layout_x = NULL, layout_y = NULL,
             layout_w = NULL, layout_h = NULL, layout_shape = NULL`,
          [table.number],
        );
      }
      if (rowCount) result.updated += 1;
      else result.inserted += 1;
    }

    const numbers = tables.map((t) => t.number);
    const { rows: deleted } = await client.query<{ number: number }>(
      `DELETE FROM tables t
        WHERE NOT (t.number = ANY($1))
          AND NOT EXISTS (SELECT 1 FROM table_sessions s WHERE s.table_id = t.id)
          AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.table_id = t.id)
          AND NOT EXISTS (SELECT 1 FROM gifts g WHERE g.table_id = t.id)
          AND NOT EXISTS (SELECT 1 FROM pos_jobs j WHERE j.table_id = t.id)
          AND NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.table_id = t.id)
        RETURNING t.number`,
      [numbers],
    );
    result.deleted = deleted.length;
    const { rows: kept } = await client.query<{ number: number }>(
      'SELECT number FROM tables WHERE NOT (number = ANY($1)) ORDER BY number',
      [numbers],
    );
    result.kept = kept.map((r) => r.number);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
  return result;
}
