import type { MenuCategory } from '../api/types';
import { useLanguage } from '../i18n/useLanguage';
import { categoryAnchor } from '../menu-view';
import { MenuItemRow } from './MenuItemRow';

export function MenuSection({ category }: { category: MenuCategory }) {
  const { lang } = useLanguage();
  const titleId = `${categoryAnchor(category.id)}-titre`;

  return (
    <section className="category" id={categoryAnchor(category.id)} aria-labelledby={titleId}>
      <h2 className="category__title" id={titleId}>
        {category.name[lang]}
      </h2>
      <ul className="category__items">
        {category.items.map((item) => (
          <MenuItemRow key={item.id} item={item} />
        ))}
      </ul>
    </section>
  );
}
