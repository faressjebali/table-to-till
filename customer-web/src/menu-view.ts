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

/** Données de `menu:updated` (docs/api.md § 8), disponibilité calculée par le serveur pour les clients. */
export interface MenuUpdate {
  menuItemId: number;
  available: boolean;
  unavailableReason: MenuItem['unavailableReason'];
}

/** Menu avec la nouvelle disponibilité d'un article (rupture, retour en stock). */
export function applyMenuUpdate(menu: MenuResponse, update: MenuUpdate): MenuResponse {
  return {
    ...menu,
    categories: menu.categories.map((category) =>
      category.items.some((item) => item.id === update.menuItemId)
        ? {
            ...category,
            items: category.items.map((item) =>
              item.id === update.menuItemId
                ? {
                    ...item,
                    available: update.available,
                    unavailableReason: update.unavailableReason,
                  }
                : item,
            ),
          }
        : category,
    ),
  };
}

/** Ouverture et fermeture du café pour le menu QR (docs/product.md § 1). */
const CAFE_HOURS = ['08:00', '22:00'];
const DAY_SECONDS = 24 * 3600;
/** Marge après l'heure limite : l'horloge du téléphone peut avancer un peu sur celle du serveur. */
export const BOUNDARY_MARGIN_MS = 30_000;

/** Heure de Tunis (`Africa/Tunis`), en secondes depuis minuit. */
function tunisSecondsOfDay(now: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Tunis',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return part('hour') * 3600 + part('minute') * 60 + part('second');
}

const toSeconds = (time: string) => {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return hours * 3600 + minutes * 60;
};

/**
 * Délai avant de relire le menu : la prochaine heure où un article peut apparaître ou disparaître
 * (`availability.from` / `until`, ouverture et fermeture du café, minuit pour les jours), plus une
 * marge. Le menu QR ne décide rien lui-même : il redemande au serveur, qui fait foi.
 */
export function nextRefreshDelay(menu: MenuResponse, now: Date): number {
  const times = new Set(CAFE_HOURS);
  for (const item of menu.categories.flatMap((c) => c.items)) {
    if (item.availability.from) times.add(item.availability.from);
    if (item.availability.until) times.add(item.availability.until);
  }
  const current = tunisSecondsOfDay(now);
  const next = Math.min(
    DAY_SECONDS,
    ...[...times].map(toSeconds).filter((seconds) => seconds > current),
  );
  return (next - current) * 1000 + BOUNDARY_MARGIN_MS;
}
