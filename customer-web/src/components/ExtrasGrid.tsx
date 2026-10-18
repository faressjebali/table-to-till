import type { MenuItem } from '../api/types';
import { formatPrice } from '../format';
import { useLanguage } from '../i18n/useLanguage';

// Tableau des Extras comme sur le menu papier : nom et prix, sur deux colonnes au téléphone.
export function ExtrasGrid({ items }: { items: MenuItem[] }) {
  const { lang, t } = useLanguage();

  return (
    <ul className="extras-grid">
      {items.map((item) => {
        const soldOut = item.unavailableReason === 'sold_out';
        return (
          <li key={item.id} className={soldOut ? 'extra extra--sold-out' : 'extra'}>
            <span className="extra__name">{item.name[lang]}</span>
            <span className="extra__price">
              {soldOut ? t('menu.soldOut') : formatPrice(item.price, lang)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
