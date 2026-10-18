import type { MenuCategory, MenuItem } from '../api/types';
import { useLanguage } from '../i18n/useLanguage';
import { categoryAnchor } from '../menu-view';
import { ExtrasGrid } from './ExtrasGrid';
import { MenuItemRow } from './MenuItemRow';

// Une catégorie : article par article, ou en tableau nom + prix (`display: grid`, les Extras).
export function MenuSection({
  category,
  items,
  onOpen,
}: {
  category: MenuCategory;
  items: Map<number, MenuItem>;
  onOpen: (item: MenuItem) => void;
}) {
  const { lang } = useLanguage();
  const titleId = `${categoryAnchor(category.id)}-titre`;

  return (
    <section className="category" id={categoryAnchor(category.id)} aria-labelledby={titleId}>
      <h2 className="category__title" id={titleId}>
        {category.name[lang]}
      </h2>
      {category.display === 'grid' ? (
        <ExtrasGrid items={category.items} onOpen={onOpen} />
      ) : (
        <ul className="category__items">
          {category.items.map((item) => (
            <MenuItemRow key={item.id} item={item} items={items} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </section>
  );
}
