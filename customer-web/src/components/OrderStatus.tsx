import type { SentOrder } from '../cart-storage';
import type { MessageKey } from '../i18n/fr';
import { useLanguage } from '../i18n/useLanguage';

const TEXT: Record<SentOrder['status'], MessageKey> = {
  pending: 'order.pending',
  confirmed: 'order.confirmed',
  rejected: 'order.rejected',
  expired: 'order.expired',
};

// État de la dernière commande envoyée, au-dessus de la barre du panier. En attente : « un serveur
// va la confirmer » ; ensuite confirmée, refusée ou expirée (panier rendu), avec « OK » pour fermer.
export function OrderStatus({ order, onDismiss }: { order: SentOrder; onDismiss: () => void }) {
  const { t } = useLanguage();
  const done = order.status !== 'pending';

  return (
    <div className={`order-status order-status--${order.status}`}>
      <p className="order-status__text">{t(TEXT[order.status])}</p>
      {done && (
        <button type="button" className="order-status__ok" onClick={onDismiss}>
          {t('order.ok')}
        </button>
      )}
    </div>
  );
}
