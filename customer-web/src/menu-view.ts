import type { MenuCategory, MenuResponse } from './api/types';

/**
 * Ce que le client voit : hors horaire → masqué ; en rupture → gardé (grisé) ;
 * une catégorie sans article visible disparaît. Ordre du menu papier (`sortOrder`).
 */
export function visibleCategories(menu: MenuResponse): MenuCategory[] {
  return [...menu.categories]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((category) => ({
      ...category,
      items: category.items.filter((item) => item.unavailableReason !== 'outside_hours'),
    }))
    .filter((category) => category.items.length > 0);
}

/** Ancre d'une catégorie, pour la barre des catégories (`#categorie-<id>`). */
export const categoryAnchor = (id: number) => `categorie-${String(id)}`;
