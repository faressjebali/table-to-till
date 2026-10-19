import { describe, expect, it } from 'vitest';
import type { Me, Role } from './api/types';
import { navigationFor } from './navigation';

const me = (role: Role, over: Partial<Me> = {}): Me => ({
  id: 1,
  name: 'Test',
  role,
  onShift: false,
  principal: false,
  ...over,
});
const everything = (m: Me) => {
  const nav = navigationFor(m);
  return nav ? [...nav.tabs, ...nav.more] : [];
};

describe('navigationFor', () => {
  it.each(['waiter', 'barista', 'chef'] as const)('%s hors shift : rien que le shift', (role) => {
    expect(navigationFor(me(role))).toBeNull();
  });

  it('renfort : plan, commandes, tables d’offre ; carte dans « Moi » ; jamais la caisse', () => {
    expect(navigationFor(me('waiter', { onShift: true }))).toEqual({
      tabs: ['tables', 'orders', 'offers', 'me'],
      more: ['menu'],
    });
  });

  it('principal : la caisse en plus, rien d’autre ne bouge', () => {
    expect(navigationFor(me('waiter', { onShift: true, principal: true }))).toEqual({
      tabs: ['tables', 'orders', 'offers', 'till', 'me'],
      more: ['menu'],
    });
  });

  it('barista en shift : bar, vente directe, offres staff, carte ; achats dans « Moi »', () => {
    expect(navigationFor(me('barista', { onShift: true }))).toEqual({
      tabs: ['bar', 'directSale', 'staffOffers', 'menu', 'me'],
      more: ['purchases'],
    });
  });

  it('cuisinier en shift : cuisine, offres staff, carte ; pas de vente directe', () => {
    expect(navigationFor(me('chef', { onShift: true }))).toEqual({
      tabs: ['kitchen', 'staffOffers', 'menu', 'me'],
      more: ['purchases'],
    });
  });

  it('manager : rapports, menu, comptes, commandes offertes, demandes d’achat reçues', () => {
    expect(navigationFor(me('manager'))).toEqual({
      tabs: ['reports', 'menuEdit', 'accounts', 'offers', 'me'],
      more: ['purchases'],
    });
  });

  it('comptable : rapports et sa table d’offre, rien d’autre', () => {
    expect(navigationFor(me('accountant'))).toEqual({
      tabs: ['reports', 'offers', 'me'],
      more: [],
    });
  });

  it('jamais le plan ni les commandes pour la manager et le comptable', () => {
    for (const role of ['manager', 'accountant'] as const) {
      expect(everything(me(role))).not.toContain('tables');
      expect(everything(me(role))).not.toContain('orders');
    }
  });

  it('jamais plus de 5 onglets', () => {
    const all = [
      me('waiter', { onShift: true }),
      me('waiter', { onShift: true, principal: true }),
      me('barista', { onShift: true }),
      me('chef', { onShift: true }),
      me('manager'),
      me('accountant'),
    ];
    for (const m of all) expect(navigationFor(m)?.tabs.length).toBeLessThanOrEqual(5);
  });
});
