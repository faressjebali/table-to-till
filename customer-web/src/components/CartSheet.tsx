import { useId } from 'react';
import type { ChoiceGroup, MenuItem } from '../api/types';
import { linesTotal, type CartLine } from '../cart';
import { formatPrice } from '../format';
import type { MessageKey } from '../i18n/fr';
import { useLanguage } from '../i18n/useLanguage';
import type { SendError } from '../useCartOrder';
import { QuantityStepper } from './QuantityStepper';
import { Sheet } from './Sheet';

const ERROR_TEXT: Record<SendError['code'], MessageKey> = {
  CAFE_CLOSED: 'cart.error.cafeClosed',
  NO_WAITER_ON_SHIFT: 'cart.error.noWaiter',
  UNAVAILABLE: 'cart.error.unavailable',
  TOO_MANY_REQUESTS: 'cart.error.tooMany',
  NETWORK: 'cart.error.network',
  OTHER: 'cart.error.other',
};

// Le panier (docs/product.md § 4) : lignes, quantités, total indicatif, modifier / retirer,
// envoi. Une ligne d'article refusé est signalée ; l'envoi attend qu'elle soit retirée.
// Une seule commande en attente à la fois : la suivante part après la réponse du serveur.
export function CartSheet({
  lines,
  items,
  choiceGroups,
  blockedKeys,
  sending,
  error,
  orderPending,
  onQuantity,
  onRemove,
  onSend,
  onClose,
}: {
  lines: CartLine[];
  items: Map<number, MenuItem>;
  choiceGroups: ChoiceGroup[];
  blockedKeys: Set<string>;
  sending: boolean;
  error: SendError | null;
  orderPending: boolean;
  onQuantity: (key: string, quantity: number) => void;
  onRemove: (key: string) => void;
  onSend: () => void;
  onClose: () => void;
}) {
  const { lang, t } = useLanguage();
  const titleId = useId();
  const total = linesTotal(lines, items);
  const hasBlocked = lines.some((line) => blockedKeys.has(line.key));
  const groupName = (key: string) => choiceGroups.find((g) => g.key === key)?.name[lang];

  return (
    <Sheet
      labelledBy={titleId}
      onClose={onClose}
      footer={
        lines.length > 0 && (
          <>
            {error && (
              <p className="sheet__error" role="alert">
                {t(ERROR_TEXT[error.code])}
              </p>
            )}
            {orderPending && <p className="sheet__missing">{t('cart.waitPrevious')}</p>}
            <button
              type="button"
              className="button sheet__add"
              disabled={sending || hasBlocked || orderPending}
              onClick={onSend}
            >
              {sending ? t('cart.sending') : `${t('cart.send')} · ${formatPrice(total, lang)}`}
            </button>
          </>
        )
      }
    >
      <h2 className="sheet__title" id={titleId}>
        {t('cart.heading')}
      </h2>
      {lines.length === 0 ? (
        <p className="sheet__description">{t('cart.empty')}</p>
      ) : (
        <>
          <ul className="cart-lines">
            {lines.map((line) => {
              const item = items.get(line.menuItemId);
              const blocked = blockedKeys.has(line.key);
              return (
                <li
                  key={line.key}
                  className={blocked ? 'cart-line cart-line--blocked' : 'cart-line'}
                >
                  <div className="cart-line__head">
                    <h3 className="cart-line__name">{item?.name[lang] ?? '—'}</h3>
                    <span className="cart-line__price">
                      {formatPrice((item?.price ?? 0) * line.quantity, lang)}
                    </span>
                  </div>
                  {line.choices.length > 0 && (
                    <p className="cart-line__detail">
                      {line.choices
                        .map(
                          (c) =>
                            `${groupName(c.group) ?? ''}${t('cart.choiceSeparator')}${items.get(c.menuItemId)?.name[lang] ?? ''}`,
                        )
                        .join(' · ')}
                    </p>
                  )}
                  {line.note && <p className="cart-line__detail">« {line.note} »</p>}
                  {blocked && <p className="cart-line__warning">{t('cart.lineUnavailable')}</p>}
                  <div className="cart-line__actions">
                    <QuantityStepper
                      value={line.quantity}
                      onChange={(quantity) => onQuantity(line.key, quantity)}
                    />
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => onRemove(line.key)}
                    >
                      {t('cart.remove')}
                      <span className="visually-hidden"> {item?.name[lang]}</span>
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="cart-total">
            <span>{t('cart.total')}</span>
            <span>{formatPrice(total, lang)}</span>
          </p>
          <p className="sheet__hint">{t('cart.totalHint')}</p>
        </>
      )}
    </Sheet>
  );
}
