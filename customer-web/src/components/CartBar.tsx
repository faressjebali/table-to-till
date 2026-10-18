import type { ReactNode } from 'react';
import type { MenuItem } from '../api/types';
import { linesCount, linesTotal, type CartLine } from '../cart';
import { formatPrice } from '../format';
import { useLanguage } from '../i18n/useLanguage';

// Bas de l'écran : état de la dernière commande (`status`), puis le bouton du panier (nombre
// d'articles et total indicatif) qui ouvre l'écran du panier. Les changements sont annoncés.
export function CartBar({
  lines,
  items,
  status,
  onOpen,
}: {
  lines: CartLine[];
  items: Map<number, MenuItem>;
  status: ReactNode;
  onOpen: () => void;
}) {
  const { lang, t } = useLanguage();
  const count = linesCount(lines);

  return (
    <div className="cart-bar" role="status">
      {status}
      {count > 0 && (
        <button type="button" className="cart-bar__inner" onClick={onOpen}>
          <span className="cart-bar__label">{t('cart.title')}</span>
          <span>
            {count} {t(count === 1 ? 'cart.item' : 'cart.items')} ·{' '}
            {formatPrice(linesTotal(lines, items), lang)}
          </span>
        </button>
      )}
    </div>
  );
}
