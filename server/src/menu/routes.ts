import { Router } from 'express';
import { z } from 'zod';
import { findAuth, getAuth, optionalStaff, requireStaff } from '../auth/middleware.js';
import type { Role } from '../auth/sessions.js';
import type { Config } from '../config.js';
import { audit, type Db } from '../db.js';
import { HttpError, validationError } from '../errors.js';
import type { Realtime } from '../realtime.js';
import { isOnShift } from '../shifts/on-shift.js';
import { localized, loadMenuItems, onMenu, toMenuItem, type Station } from './items.js';

const idParam = z.coerce.number().int().positive();
const availabilityBody = z.object({ available: z.boolean() });

// Qui peut marquer une rupture, selon le poste de l'article (docs/product.md § 3).
const stationsByRole: Record<Role, readonly Station[]> = {
  waiter: ['bar', 'kitchen', 'both'],
  manager: ['bar', 'kitchen', 'both'],
  barista: ['bar', 'both'],
  chef: ['kitchen', 'both'],
};

type CategoryRow = {
  id: number;
  name_fr: string;
  name_en: string | null;
  section: 'food' | 'drinks';
  display: 'list' | 'grid';
  sort_order: number;
};
type ChoiceGroupRow = {
  key: string;
  name_fr: string;
  name_en: string | null;
  option_ids: number[];
};

// Routes menu de docs/api.md § 3 (GET /menu) et § 5 (rupture).
export function menuRoutes(db: Db, config: Config, realtime: Realtime): Router {
  const router = Router();

  // Avec un jeton staff : posCode et disponibilité du staff (docs/api.md § 3).
  router.get('/menu', optionalStaff(db, config), async (_req, res) => {
    const now = new Date();
    const audience = findAuth(res) ? 'staff' : 'customer';
    const [{ rows: categories }, items, { rows: groups }] = await Promise.all([
      db.query<CategoryRow>(
        `SELECT id, name_fr, name_en, section, display, sort_order FROM categories ORDER BY sort_order, id`,
      ),
      loadMenuItems(db),
      db.query<ChoiceGroupRow>(
        `SELECT g.key, g.name_fr, g.name_en,
                array(SELECT o.menu_item_id FROM choice_group_options o
                        JOIN menu_items i ON i.id = o.menu_item_id
                       WHERE o.group_key = g.key AND ${onMenu('i')}
                       ORDER BY o.sort_order, o.menu_item_id) AS option_ids
           FROM choice_groups g ORDER BY g.key`,
      ),
    ]);

    res.json({
      categories: categories.map((category) => ({
        id: category.id,
        name: localized(category.name_fr, category.name_en),
        section: category.section,
        display: category.display,
        sortOrder: category.sort_order,
        items: items
          .filter((row) => row.category_id === category.id)
          .map((row) => toMenuItem(row, now, audience)),
      })),
      choiceGroups: groups.map((group) => ({
        key: group.key,
        name: localized(group.name_fr, group.name_en),
        optionIds: group.option_ids,
      })),
    });
  });

  router.patch(
    '/menu-items/:id/availability',
    requireStaff(db, config, { roles: Object.keys(stationsByRole) as Role[] }),
    async (req, res) => {
      const id = idParam.safeParse(req.params['id']);
      if (!id.success) throw new HttpError(404, 'NOT_FOUND', 'Menu item not found');
      const body = availabilityBody.safeParse(req.body);
      if (!body.success) throw validationError(body.error);
      const { user } = getAuth(res);

      const [row] = await loadMenuItems(db, [id.data]);
      if (!row) throw new HttpError(404, 'NOT_FOUND', 'Menu item not found');
      if (!stationsByRole[user.role].includes(row.station)) {
        throw new HttpError(403, 'FORBIDDEN', 'Forbidden');
      }
      // Un serveur hors shift ne voit que « Démarrer mon shift » (docs/api.md v1.8).
      if (user.role === 'waiter' && !(await isOnShift(db, user.id))) {
        throw new HttpError(403, 'NOT_ON_SHIFT', 'Not on shift');
      }

      const soldOut = !body.data.available;
      const now = new Date();
      const updated = { ...row, sold_out: soldOut };
      if (row.sold_out !== soldOut) {
        await db.query(`UPDATE menu_items SET sold_out = $2, updated_at = now() WHERE id = $1`, [
          row.id,
          soldOut,
        ]);
        await audit(db, {
          userId: user.id,
          action: soldOut ? 'menu_item.sold_out' : 'menu_item.back_in_stock',
          entityType: 'menu_item',
          entityId: row.id,
        });
        const update = (audience: 'staff' | 'customer') => {
          const {
            id: menuItemId,
            available,
            unavailableReason,
          } = toMenuItem(updated, now, audience);
          return { menuItemId, available, unavailableReason };
        };
        realtime.menuUpdated({ staff: update('staff'), customer: update('customer') });
      }

      res.json(toMenuItem(updated, now, 'staff'));
    },
  );

  return router;
}
