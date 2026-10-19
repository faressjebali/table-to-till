import type { MenuItem } from '../api/types';
import { formatPrice } from '../format';
import { useLanguage } from '../i18n/useLanguage';

// Un article comme sur le menu papier : nom (orange), description (bleu), prix (vert), photo.
// En rupture : grisé, avec « Épuisé ». Un tap sur la ligne ouvre la fiche de l'article, la seule
// à montrer ses extras suggérés.
export function MenuItemRow({
  item,
  onOpen,
}: {
  item: MenuItem;
  onOpen: (item: MenuItem) => void;
}) {
  const { lang, t } = useLanguage();
  const soldOut = item.unavailableReason === 'sold_out';

  return (
    <li className={soldOut ? 'item item--sold-out' : 'item'}>
      <div className="item__main">
        <div className="item__text">
          <h3 className="item__name">
            {/* Le bouton couvre toute la ligne (::after) : un tap n'importe où ouvre la fiche */}
            <button type="button" className="item__open" onClick={() => onOpen(item)}>
              {item.name[lang]}
            </button>
          </h3>
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
      </div>
    </li>
  );
}
