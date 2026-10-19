import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Me, Order, OrderLine } from './api/types';
import { StaffShell } from './components/StaffShell';
import { fr } from './i18n/fr';
import { newlyCancelled, placeLabel, timeLabel, upsertOrder } from './stationOrders';
import { serverEmit, sockets } from './test/fakeSocket';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const line = (over: Partial<OrderLine> = {}): OrderLine => ({
  id: 901,
  menuItemId: 57,
  name: { fr: 'Capuccino', en: 'Cappuccino' },
  quantity: 2,
  note: null,
  unitPrice: 8500,
  discountPercent: 0,
  lineTotal: 11000,
  status: 'active',
  station: 'bar',
  ...over,
});

const order = (over: Partial<Order> = {}): Order => ({
  id: 154,
  table: { id: 7, number: 7 },
  tableSessionId: 61,
  source: 'qr',
  status: 'confirmed',
  lines: [line()],
  total: 11000,
  createdAt: '2026-10-20T08:04:00Z',
  confirmedAt: '2026-10-20T08:05:00Z',
  confirmedBy: { id: 4, name: 'Amira' },
  offer: null,
  ready: { bar: null, kitchen: null },
  pos: { status: 'queued', error: null },
  ...over,
});

describe('liste à préparer', () => {
  it('range par heure de confirmation, remplace une commande déjà là', () => {
    const early = order({ id: 1, confirmedAt: '2026-10-20T08:00:00Z' });
    const late = order({ id: 2, confirmedAt: '2026-10-20T09:00:00Z' });
    expect(upsertOrder([late], early, 'bar').map((o) => o.id)).toEqual([1, 2]);

    const updated = order({ id: 2, confirmedAt: late.confirmedAt, table: { id: 9, number: 9 } });
    expect(upsertOrder([early, late], updated, 'bar')).toEqual([early, updated]);
  });

  it('une commande prête à ce poste sort ; prête à l’autre poste, elle reste', () => {
    const ready = { at: '2026-10-20T08:10:00Z', by: { id: 3, name: 'Yassine' } };
    const list = [order()];
    expect(upsertOrder(list, order({ ready: { bar: ready, kitchen: null } }), 'bar')).toEqual([]);
    expect(upsertOrder(list, order({ ready: { bar: null, kitchen: ready } }), 'bar')).toHaveLength(
      1,
    );
  });

  it('tout annulé : reste affichée si elle y était, n’entre pas sinon', () => {
    const cancelled = order({ lines: [line({ status: 'cancelled' })] });
    expect(upsertOrder([order()], cancelled, 'bar')).toEqual([cancelled]);
    expect(upsertOrder([], cancelled, 'bar')).toEqual([]);
  });

  it('repère les lignes qui viennent d’être annulées', () => {
    const before = order({ lines: [line(), line({ id: 902, status: 'cancelled' })] });
    const after = order({
      lines: [line({ status: 'cancelled' }), line({ id: 902, status: 'cancelled' })],
    });
    expect(newlyCancelled(before, after).map((l) => l.id)).toEqual([901]);
  });

  it('libellés : table, vente directe, table d’offre ; heure de Tunis', () => {
    expect(placeLabel(order())).toBe('Table 7');
    expect(placeLabel(order({ source: 'direct', table: { id: 30, number: 333 } }))).toBe(
      'Vente directe 333',
    );
    expect(
      placeLabel(
        order({
          source: 'offer',
          table: { id: 40, number: 103 },
          offer: {
            label: 'Nour Ben Salem',
            forClient: false,
            requestedBy: { id: 2, name: 'Nour' },
          },
        }),
      ),
    ).toBe('103 Nour Ben Salem');
    // 08:05 UTC = 09:05 à Tunis (UTC+1, sans heure d'été)
    expect(timeLabel(order())).toBe('09:05');
  });
});

type Reply = { status: number; body?: unknown };

// Faux serveur : « POST /api/orders/154/ready » pour un POST, chemin seul pour un GET.
function mockApi(routes: Record<string, Reply | (() => Reply)>) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const path = method === 'GET' ? String(input) : `${method} ${String(input)}`;
    const route = routes[path];
    if (route === undefined) throw new Error(`appel inattendu : ${path}`);
    const reply = typeof route === 'function' ? route() : route;
    return Promise.resolve(
      reply.body === undefined
        ? new Response(null, { status: reply.status })
        : new Response(JSON.stringify(reply.body), {
            status: reply.status,
            headers: { 'Content-Type': 'application/json' },
          }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const BARISTA: Me = { id: 3, name: 'Yassine', role: 'barista', onShift: true, principal: false };

async function openBar(items: Order[], routes: Record<string, Reply | (() => Reply)> = {}) {
  localStorage.setItem('coffee-qr.staff.token', 'jeton');
  const fetchMock = mockApi({
    '/api/station-orders': { status: 200, body: { items } },
    ...routes,
  });
  render(
    <StaffShell me={BARISTA} onLogout={() => undefined} onShiftChange={() => Promise.resolve()} />,
  );
  await screen.findByRole('heading', { name: fr['screen.bar'] });
  return fetchMock;
}

describe('écran bar', () => {
  it('montre la table, l’heure, la quantité, les choix et la note', async () => {
    await openBar([
      order({
        lines: [
          line({
            name: { fr: 'Classic Start', en: 'Classic Start' },
            quantity: 1,
            station: 'both',
            note: 'sans sucre',
            choices: [
              { group: 'hot_drink', menuItemId: 57, name: { fr: 'Capuccino', en: 'Cappuccino' } },
            ],
          }),
        ],
      }),
    ]);
    const ticket = await screen.findByRole('article', { name: 'Table 7' });
    expect(within(ticket).getByText('09:05')).toBeInTheDocument();
    expect(within(ticket).getByText('1 ×')).toBeInTheDocument();
    expect(within(ticket).getByText('Classic Start')).toBeInTheDocument();
    expect(within(ticket).getByText('Capuccino')).toBeInTheDocument();
    expect(within(ticket).getByText('« sans sucre »')).toBeInTheDocument();
    expect(sockets.at(-1)?.options.auth).toEqual({ token: 'jeton' });
  });

  it('rien à préparer : le dit', async () => {
    await openBar([]);
    expect(await screen.findByText(fr['station.empty'])).toBeInTheDocument();
  });

  it('Prêt : la commande disparaît', async () => {
    const fetchMock = await openBar([order()], {
      'POST /api/orders/154/ready': {
        status: 200,
        body: order({
          ready: { bar: { at: '...', by: { id: 3, name: 'Yassine' } }, kitchen: null },
        }),
      },
    });
    await userEvent.click(await screen.findByRole('button', { name: fr['station.ready'] }));
    expect(await screen.findByText(fr['station.empty'])).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/orders/154/ready', expect.anything());
  });

  it('Prêt déjà fait sur un autre téléphone : la liste est rechargée, sans message', async () => {
    let items = [order()];
    await openBar([], {
      '/api/station-orders': () => ({ status: 200, body: { items } }),
      'POST /api/orders/154/ready': {
        status: 409,
        body: { error: { code: 'INVALID_STATUS', message: 'Already ready' } },
      },
    });
    const button = await screen.findByRole('button', { name: fr['station.ready'] });
    items = [];
    await userEvent.click(button);
    expect(await screen.findByText(fr['station.empty'])).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('nouvelle commande en temps réel ; reconnexion : liste rechargée', async () => {
    let items: Order[] = [];
    const fetchMock = await openBar([], {
      '/api/station-orders': () => ({ status: 200, body: { items } }),
    });
    await screen.findByText(fr['station.empty']);

    act(() => {
      serverEmit('station:order', order({ id: 155, table: { id: 3, number: 3 } }));
    });
    expect(screen.getByRole('article', { name: 'Table 3' })).toBeInTheDocument();

    items = [order({ id: 156, table: { id: 12, number: 12 } })];
    act(() => {
      serverEmit('connect');
    });
    expect(await screen.findByRole('article', { name: 'Table 12' })).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'Table 3' })).toBeNull();
    expect(fetchMock.mock.calls.filter(([path]) => path === '/api/station-orders')).toHaveLength(2);
  });

  it('annulation : ligne barrée « ANNULÉ » et alerte ; tout annulé → Vu', async () => {
    await openBar([order()]);
    await screen.findByRole('article', { name: 'Table 7' });

    act(() => {
      serverEmit('station:updated', {
        ...order({ lines: [line({ status: 'cancelled' })] }),
        alert: true,
      });
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Table 7 : 2 × Capuccino annulé');
    const ticket = screen.getByRole('article', { name: 'Table 7' });
    expect(within(ticket).getByText(fr['station.cancelled'])).toBeInTheDocument();
    expect(within(ticket).queryByRole('button', { name: fr['station.ready'] })).toBeNull();

    await userEvent.click(within(ticket).getByRole('button', { name: fr['station.seen'] }));
    expect(screen.queryByRole('article')).toBeNull();
  });

  it('changement de table : le numéro est mis à jour', async () => {
    await openBar([order()]);
    await screen.findByRole('article', { name: 'Table 7' });
    act(() => {
      serverEmit('station:updated', order({ table: { id: 9, number: 9 } }));
    });
    expect(screen.getByRole('article', { name: 'Table 9' })).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'Table 7' })).toBeNull();
  });

  it('table d’offre pour un client : le nom et « Offert à un client »', async () => {
    await openBar([
      order({
        source: 'offer',
        table: { id: 40, number: 103 },
        offer: { label: 'Nour Ben Salem', forClient: true, requestedBy: { id: 2, name: 'Nour' } },
      }),
    ]);
    const ticket = await screen.findByRole('article', { name: '103 Nour Ben Salem' });
    expect(within(ticket).getByText(fr['station.forClient'])).toBeInTheDocument();
  });
});

describe('serveur en shift', () => {
  it('« Table 7 : boissons prêtes » jusqu’à OK', async () => {
    localStorage.setItem('coffee-qr.staff.token', 'jeton');
    render(
      <StaffShell
        me={{ id: 4, name: 'Amira', role: 'waiter', onShift: true, principal: true }}
        onLogout={() => undefined}
        onShiftChange={() => Promise.resolve()}
      />,
    );
    act(() => {
      serverEmit('order:ready', { orderId: 154, table: { id: 7, number: 7 }, station: 'bar' });
      serverEmit('order:ready', { orderId: 154, table: { id: 7, number: 7 }, station: 'kitchen' });
    });
    expect(screen.getByText('Table 7 : boissons prêtes')).toBeInTheDocument();
    expect(screen.getByText('Table 7 : plats prêts')).toBeInTheDocument();
    const [dismiss] = screen.getAllByRole('button', { name: fr['ready.dismiss'] });
    if (!dismiss) throw new Error('bouton OK introuvable');
    await userEvent.click(dismiss);
    expect(screen.queryByText('Table 7 : boissons prêtes')).toBeNull();
  });

  it('nouvelle connexion temps réel quand le shift change', () => {
    localStorage.setItem('coffee-qr.staff.token', 'jeton');
    const me: Me = { ...BARISTA, onShift: false };
    const { rerender } = render(
      <StaffShell me={me} onLogout={() => undefined} onShiftChange={() => Promise.resolve()} />,
    );
    mockApi({ '/api/station-orders': { status: 200, body: { items: [] } } });
    const first = sockets.at(-1);
    rerender(
      <StaffShell
        me={{ ...me, onShift: true }}
        onLogout={() => undefined}
        onShiftChange={() => Promise.resolve()}
      />,
    );
    expect(first?.connected).toBe(false);
    expect(sockets.at(-1)).not.toBe(first);
    expect(sockets.at(-1)?.connected).toBe(true);
  });
});
