import type { MenuCategory } from '../api/types';
import { useLanguage } from '../i18n/useLanguage';
import { categoryAnchor } from '../menu-view';

// Barre des catégories qui défile à l'horizontale : un tap saute à la catégorie.
export function CategoryNav({ categories }: { categories: MenuCategory[] }) {
  const { lang, t } = useLanguage();

  return (
    <nav className="category-nav" aria-label={t('menu.categories')}>
      <ul className="category-nav__list">
        {categories.map((category) => (
          <li key={category.id}>
            <a className="category-nav__link" href={`#${categoryAnchor(category.id)}`}>
              {category.name[lang]}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
