import type { MenuItem } from '../api/types';
import { formatPrice } from '../format';
import { useLanguage } from '../i18n/useLanguage';

// Un article comme sur le menu papier : nom (orange), description (bleu), prix (vert), photo.
// En rupture : grisé, avec « Épuisé ».
export function MenuItemRow({ item }: { item: MenuItem }) {
  const { lang, t } = useLanguage();
  const soldOut = item.unavailableReason === 'sold_out';

  return (
    <li className={soldOut ? 'item item--sold-out' : 'item'}>
      <div className="item__text">
        <h3 className="item__name">{item.name[lang]}</h3>
        {item.description && <p className="item__description">{item.description[lang]}</p>}
        <p className="item__price">
          {formatPrice(item.price, lang)}
          {soldOut && <span className="item__badge">{t('menu.soldOut')}</span>}
        </p>
      </div>
      {item.photoUrl && (
        <img
          className="item__photo"
          src={item.photoUrl}
          alt=""
          width={88}
          height={88}
          loading="lazy"
          decoding="async"
        />
      )}
    </li>
  );
}
