import { useEffect, useRef } from 'react';
import { getMenu } from './api/client';
import type { MenuResponse } from './api/types';
import { applyMenuUpdate, nextRefreshDelay } from './menu-view';
import { connectTable } from './realtime';

type SetMenu = (update: (menu: MenuResponse) => MenuResponse) => void;

/**
 * Menu à jour sans recharger la page (docs/product.md § 3, ruptures et horaires) :
 * - `menu:updated` : rupture ou retour en stock, appliqué tout de suite ;
 * - le menu est relu juste après la prochaine heure limite (formules à 12h00, fermeture…),
 *   à chaque reconnexion (les événements de la coupure sont perdus) et quand le téléphone revient
 *   sur la page (minuteurs suspendus en arrière-plan).
 * Une relecture ratée garde le menu affiché : la suivante réessaie.
 */
export function useLiveMenu(
  tableToken: string | null,
  menu: MenuResponse | null,
  setMenu: SetMenu,
) {
  const ready = menu !== null;
  const latestSet = useRef(setMenu);
  useEffect(() => {
    latestSet.current = setMenu;
  });

  // Relit le menu entier, disponibilité calculée par le serveur.
  const reload = useRef(() => {
    getMenu()
      .then((fresh) => latestSet.current(() => fresh))
      .catch(() => undefined);
  });

  useEffect(() => {
    if (!tableToken || !ready) return;
    const socket = connectTable(tableToken);
    let connectedOnce = false;
    socket.on('menu:updated', (update) => {
      latestSet.current((current) => applyMenuUpdate(current, update));
    });
    socket.on('connect', () => {
      // Première connexion : le menu vient d'être chargé.
      if (connectedOnce) reload.current();
      connectedOnce = true;
    });
    const onVisible = () => {
      if (document.visibilityState === 'visible') reload.current();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      socket.disconnect();
    };
  }, [tableToken, ready]);

  useEffect(() => {
    if (!menu) return;
    const timer = setTimeout(() => reload.current(), nextRefreshDelay(menu, new Date()));
    return () => clearTimeout(timer);
  }, [menu]);
}
