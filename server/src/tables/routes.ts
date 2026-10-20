import { Router } from 'express';
import { z } from 'zod';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { HttpError } from '../errors.js';
import { requireWaiterOnShift } from '../shifts/on-shift.js';
import { loadOpenSession, loadTables } from './view.js';

const idParam = z.coerce.number().int().positive();

// Routes tables de docs/api.md § 3 (jeton du QR) et § 5 (plan de la salle).
export function tableRoutes(db: Db, config: Config): Router {
  const router = Router();

  // Plan des tables : serveurs en shift seulement, lecture comprise.
  router.get('/tables', ...requireWaiterOnShift(db, config), async (_req, res) => {
    res.json({ tables: await loadTables(db) });
  });

  // Commandes de la table : sa session ouverte, ou 404 si la table est libre (ou inconnue).
  router.get('/tables/:id/session', ...requireWaiterOnShift(db, config), async (req, res) => {
    const id = idParam.safeParse(req.params['id']);
    const found = id.success ? await loadOpenSession(db, id.data) : null;
    if (!found) throw new HttpError(404, 'NOT_FOUND', 'No open session');
    // TODO : les offerts de la table, quand ils existeront.
    res.json({ ...found, gifts: [] });
  });

  // Jeton du QR (sans connexion) : seulement une table réelle. Inconnu → « demandez au serveur ».
  router.get('/tables/:tableToken', async (req, res) => {
    const { rows } = await db.query<{ id: number; number: number }>(
      `SELECT id, number FROM tables WHERE qr_token = $1 AND kind = 'real'`,
      [req.params['tableToken']],
    );
    const table = rows[0];
    if (!table) throw new HttpError(404, 'TABLE_NOT_FOUND', 'Unknown table');
    res.json({ id: table.id, number: table.number });
  });

  return router;
}
