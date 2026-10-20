import { t } from '../i18n/fr';
import { addReady, clearReadyTables, dismissReady, useReadyItems } from '../readyTables';
import { useRealtimeEvent } from '../realtime';
import { playChime } from '../sound';
import { StateIcon } from './StateIcon';

// Serveurs en shift : « Table 7 : boissons prêtes » quand le bar ou la cuisine appuie sur Prêt
// (`order:ready`), jusqu'à ce que le serveur touche OK. App fermée : notification push.
// La même liste donne la bande bleue du plan des tables (src/readyTables.ts).
export function ReadyBanner() {
  const items = useReadyItems();

  useRealtimeEvent('order:ready', (ready) => {
    addReady(ready);
    playChime('new');
  });
  useRealtimeEvent('table:updated', (table) => {
    if (table.state === 'free') clearReadyTables([table.id]);
  });

  if (items.length === 0) return null;
  return (
    <div className="ready-list" role="status">
      {items.map((item) => (
        <div key={item.key} className="ready">
          <span className="alert__icon">
            <StateIcon state={item.station} />
          </span>
          <p className="ready__text">
            {`${t('place.table')} ${String(item.tableNumber)} : ${t(
              item.station === 'bar' ? 'ready.bar' : 'ready.kitchen',
            )}`}
          </p>
          <button
            type="button"
            className="button button--secondary"
            onClick={() => dismissReady(item.key)}
          >
            {t('ready.dismiss')}
          </button>
        </div>
      ))}
    </div>
  );
}
