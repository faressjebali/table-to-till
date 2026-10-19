import { useState } from 'react';
import { t } from '../i18n/fr';
import { useRealtimeEvent } from '../realtime';
import { playChime } from '../sound';

// Serveurs en shift : « Table 7 : boissons prêtes » quand le bar ou la cuisine appuie sur Prêt
// (`order:ready`), jusqu'à ce que le serveur touche OK. App fermée : notification push.
export function ReadyBanner() {
  const [items, setItems] = useState<{ key: string; text: string }[]>([]);

  useRealtimeEvent('order:ready', ({ orderId, table, station }) => {
    const key = `${String(orderId)}-${station}`;
    const text = `${t('place.table')} ${String(table.number)} : ${t(
      station === 'bar' ? 'ready.bar' : 'ready.kitchen',
    )}`;
    setItems((list) => [...list.filter((item) => item.key !== key), { key, text }]);
    playChime('new');
  });

  if (items.length === 0) return null;
  return (
    <div className="ready-list" role="status">
      {items.map((item) => (
        <div key={item.key} className="ready">
          <p className="ready__text">{item.text}</p>
          <button
            type="button"
            className="button button--secondary"
            onClick={() => setItems((list) => list.filter((i) => i.key !== item.key))}
          >
            {t('ready.dismiss')}
          </button>
        </div>
      ))}
    </div>
  );
}
