import { linesCount, linesTotal, type CartLine } from '../cart';
import type { MenuItem } from '../api/types';
import { formatPrice } from '../format';
import { useLanguage } from '../i18n/useLanguage';

// Barre du panier en bas de l'écran : nombre d'articles et total indicatif. L'écran du panier
// (modifier, supprimer, envoyer) arrive plus tard.
export function CartBar({ lines, items }: { lines: CartLine[]; items: Map<number, MenuItem> }) {
  const { lang, t } = useLanguage();
  const count = linesCount(lines);

  return (
    <div className="cart-bar" role="status">
      {count > 0 && (
        <p className="cart-bar__inner">
          <span className="cart-bar__label">{t('cart.title')}</span>
          <span>
            {count} {t(count === 1 ? 'cart.item' : 'cart.items')} ·{' '}
            {formatPrice(linesTotal(lines, items), lang)}
          </span>
        </p>
      )}
    </div>
  );
}
