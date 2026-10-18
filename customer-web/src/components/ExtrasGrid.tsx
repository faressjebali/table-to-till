import type { MenuItem } from '../api/types';
import { formatPrice } from '../format';
import { useLanguage } from '../i18n/useLanguage';

// Tableau des Extras comme sur le menu papier : nom et prix, sur deux colonnes au téléphone.
// Un tap sur un extra ouvre sa fiche : il se commande aussi seul, sur sa propre ligne.
export function ExtrasGrid({
  items,
  onOpen,
}: {
  items: MenuItem[];
  onOpen: (item: MenuItem) => void;
}) {
  const { lang, t } = useLanguage();

  return (
    <ul className="extras-grid">
      {items.map((item) => {
        const soldOut = item.unavailableReason === 'sold_out';
        return (
          <li key={item.id} className={soldOut ? 'extra extra--sold-out' : 'extra'}>
            <button type="button" className="extra__open" onClick={() => onOpen(item)}>
              <span className="extra__name">{item.name[lang]}</span>
              <span className="extra__price">
                {soldOut ? t('menu.soldOut') : formatPrice(item.price, lang)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
