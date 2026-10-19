import type { Me } from './api/types';

// Écrans de l'app staff. Chacun arrive avec son issue ; en attendant, un écran « bientôt ».
export type Destination =
  | 'tables' // plan des tables
  | 'orders' // commandes entrantes et saisie
  | 'offers' // tables d'offre (serveur), commandes offertes (manager, comptable)
  | 'menu' // carte et ruptures
  | 'till' // caisse du principal : dépenses, clôture
  | 'bar' // écran bar
  | 'kitchen' // écran cuisine
  | 'directSale' // vente directe au comptoir
  | 'staffOffers' // liste « Offres staff »
  | 'purchases' // demandes d'achat : envoyées (barista, cuisinier) ou reçues (manager)
  | 'reports' // CA, articles sortis, clôtures
  | 'menuEdit' // édition du menu
  | 'accounts' // comptes et rôles
  | 'me'; // nom, rôle, shift, déconnexion

export interface Navigation {
  /** Onglets de la barre du bas (5 au plus), « Moi » en dernier. */
  tabs: Destination[];
  /** Écrans ouverts depuis « Moi », faute de place dans la barre. */
  more: Destination[];
}

/**
 * Ce que chacun voit (docs/product.md § 5) : `null` pour un serveur, un barista ou un cuisinier
 * hors shift, qui voit seulement « Démarrer mon shift ». Le renfort n'a jamais la caisse ; la
 * manager et le comptable n'ont jamais le plan des tables ni les commandes des clients.
 */
export function navigationFor(me: Me): Navigation | null {
  switch (me.role) {
    case 'waiter':
      if (!me.onShift) return null;
      // Devenir principal ajoute la Caisse sans rien déplacer : la Carte reste dans « Moi ».
      return me.principal
        ? { tabs: ['tables', 'orders', 'offers', 'till', 'me'], more: ['menu'] }
        : { tabs: ['tables', 'orders', 'offers', 'me'], more: ['menu'] };
    case 'barista':
      if (!me.onShift) return null;
      return { tabs: ['bar', 'directSale', 'staffOffers', 'menu', 'me'], more: ['purchases'] };
    case 'chef':
      if (!me.onShift) return null;
      return { tabs: ['kitchen', 'staffOffers', 'menu', 'me'], more: ['purchases'] };
    case 'manager':
      return { tabs: ['reports', 'menuEdit', 'accounts', 'offers', 'me'], more: ['purchases'] };
    case 'accountant':
      return { tabs: ['reports', 'offers', 'me'], more: [] };
  }
}
