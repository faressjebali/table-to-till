import type { MenuCategory, MenuItem, MenuResponse, MenuSectionKey } from './api/types';

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

/**
 * Catégories d'un onglet (Food ou Drinks). Un tableau d'extras n'ouvre jamais la carte :
 * après 15h, les œufs sont masqués et les Extras passent sous la catégorie suivante (Salades).
 */
export function sectionCategories(
  categories: MenuCategory[],
  section: MenuSectionKey,
): MenuCategory[] {
  const result = categories.filter((category) => category.section === section);
  const [first, second, ...rest] = result;
  if (first?.display === 'grid' && second) return [second, first, ...rest];
  return result;
}

/** Onglets à afficher : seulement ceux qui ont au moins une catégorie visible, Food d'abord. */
export function availableSections(categories: MenuCategory[]): MenuSectionKey[] {
  return (['food', 'drinks'] as const).filter((section) =>
    categories.some((category) => category.section === section),
  );
}

/** Tous les articles de la carte par id, pour retrouver les extras suggérés. */
export function itemsById(menu: MenuResponse): Map<number, MenuItem> {
  return new Map(menu.categories.flatMap((c) => c.items).map((item) => [item.id, item]));
}

/**
 * Extras suggérés sous un article (« +Bacon de bœuf 7 DT »), dans l'ordre du serveur.
 * Un extra hors horaire est masqué ; en rupture, il reste visible (grisé).
 */
export function suggestedExtras(item: MenuItem, items: Map<number, MenuItem>): MenuItem[] {
  return item.suggestedExtraIds.flatMap((id) => {
    const extra = items.get(id);
    return extra && extra.unavailableReason !== 'outside_hours' ? [extra] : [];
  });
}

/** Ancre d'une catégorie, pour la barre des catégories (`#categorie-<id>`). */
export const categoryAnchor = (id: number) => `categorie-${String(id)}`;

/** Panneau de la carte et onglets Food / Drinks (attributs ARIA du motif « tabs »). */
export const sectionPanelId = 'carte';
export const sectionTabId = (section: MenuSectionKey) => `onglet-${section}`;
