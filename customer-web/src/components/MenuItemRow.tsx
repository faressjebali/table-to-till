import type { MenuItem } from '../api/types';
import { formatPrice } from '../format';
import { useLanguage } from '../i18n/useLanguage';
import { suggestedExtras } from '../menu-view';

// Un article comme sur le menu papier : nom (orange), description (bleu), prix (vert), photo,
// puis les extras suggérés (« +Bacon de bœuf 7 DT »). En rupture : grisé, avec « Épuisé ».
export function MenuItemRow({ item, items }: { item: MenuItem; items: Map<number, MenuItem> }) {
  const { lang, t } = useLanguage();
  const soldOut = item.unavailableReason === 'sold_out';
  const extras = suggestedExtras(item, items);

  return (
    <li className={soldOut ? 'item item--sold-out' : 'item'}>
      <div className="item__main">
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
      </div>
      {extras.length > 0 && (
        <ul className="suggestions" aria-label={t('menu.suggestions')}>
          {extras.map((extra) => {
            const extraSoldOut = extra.unavailableReason === 'sold_out';
            return (
              <li
                key={extra.id}
                className={extraSoldOut ? 'suggestion suggestion--sold-out' : 'suggestion'}
              >
                +{extra.name[lang]}{' '}
                <span className="suggestion__price">
                  {extraSoldOut ? t('menu.soldOut') : formatPrice(extra.price, lang)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}
