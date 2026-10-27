import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CurrentShifts, Me, Order, OrderLine } from './api/types';
import { StaffShell } from './components/StaffShell';
import { fr } from './i18n/fr';
import { orderFromUrl, unstaffedStations, upsertPending } from './pendingOrders';
import { playChime } from './sound';
import { serverEmit } from './test/fakeSocket';

vi.mock('./sound', () => ({ playChime: vi.fn(), unlockSoundOnFirstTouch: vi.fn() }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(playChime).mockClear();
  localStorage.clear();
  history.replaceState(null, '', '/');
});

const line = (over: Partial<OrderLine> = {}): OrderLine => ({
  id: 901,
  menuItemId: 3,
  name: { fr: 'Cheese Burger', en: 'Cheese Burger' },
  quantity: 1,
  note: 'sans oignon',
  unitPrice: 28500,
  discountPercent: 0,
  lineTotal: 28500,
  status: 'active',
  station: 'kitchen',
  ...over,
});

const order = (over: Partial<Order> = {}): Order => ({
  id: 154,
  table: { id: 7, number: 7 },
  tableSessionId: null,
  source: 'qr',
  status: 'pending',
  lines: [line()],
  total: 28500,
  createdAt: '2026-10-20T08:04:00Z',
  confirmedAt: null,
  confirmedBy: null,
  offer: null,
  ready: { bar: null, kitchen: null },
  pos: null,
  ...over,
});

const shifts = (stations: CurrentShifts['stations'] = []): CurrentShifts => ({
  waiters: [{ id: 4, name: 'Amira', startedAt: '2026-10-20T07:00:00Z', principal: true }],
  stations,
});
const BARISTA = { id: 8, name: 'Nour', role: 'barista' as const, startedAt: '' };
const CHEF = { id: 9, name: 'Yassine', role: 'chef' as const, startedAt: '' };

type Reply = { status: number; body?: unknown } | 'network-error';

// Faux serveur : une réponse par chemin, ou une fonction pour compter les appels.
function mockApi(routes: Record<string, Reply | (() => Reply)>) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const path = String(input);
    const route = routes[path];
    if (route === undefined) throw new Error(`appel inattendu : ${path}`);
    const reply = typeof route === 'function' ? route() : route;
    if (reply === 'network-error') return Promise.reject(new TypeError('Failed to fetch'));
    return Promise.resolve(
      new Response(reply.status === 204 ? null : JSON.stringify(reply.body), {
        status: reply.status,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const AMIRA: Me = { id: 4, name: 'Amira', role: 'waiter', onShift: true, principal: false };
const PENDING = '/api/orders?status=pending&limit=100';

function routesFor(
  pending: Order[] | (() => Reply),
  routes: Record<string, Reply | (() => Reply)> = {},
) {
  return {
    [PENDING]:
      typeof pending === 'function'
        ? pending
        : { status: 200, body: { items: pending, nextCursor: null } },
    '/api/shifts/current': { status: 200, body: shifts() },
    '/api/tables': { status: 200, body: { tables: [] } },
    ...routes,
  };
}

function renderShell(me: Me = AMIRA) {
  localStorage.setItem('coffee-qr.staff.token', 'jeton');
  render(<StaffShell me={me} onLogout={() => undefined} onShiftChange={() => Promise.resolve()} />);
}

async function openOrders(
  pending: Order[] | (() => Reply),
  routes: Record<string, Reply | (() => Reply)> = {},
) {
  const fetchMock = mockApi(routesFor(pending, routes));
  renderShell();
  await screen.findByRole('heading', { name: fr['screen.tables'] });
  await userEvent.click(ordersTab());
  await screen.findByRole('heading', { name: fr['screen.orders'] });
  return fetchMock;
}

const ordersTab = () =>
  within(screen.getByRole('navigation', { name: fr['nav.label'] })).getByRole('button', {
    name: /^Commandes/,
  });
const card = (name: RegExp) => screen.getByRole('article', { name });

describe('liste des commandes à confirmer', () => {
  it('ajoute une commande en attente, sort une commande traitée, range par heure d’envoi', () => {
    const early = order({ id: 1, createdAt: '2026-10-20T08:00:00Z' });
    const late = order({ id: 2, createdAt: '2026-10-20T09:00:00Z' });
    expect(upsertPending([late], early).map((o) => o.id)).toEqual([1, 2]);
    expect(upsertPending([early, late], order({ id: 1, status: 'expired' }))).toEqual([late]);
    expect(upsertPending([], order({ status: 'confirmed' }))).toEqual([]);
  });

  it('postes sans personne : bar, cuisine, et `both` seulement si personne aux deux', () => {
    const mixed = order({
      lines: [line({ station: 'bar' }), line({ id: 902, station: 'kitchen' })],
    });
    expect(unstaffedStations(mixed, shifts())).toEqual(['bar', 'kitchen']);
    expect(unstaffedStations(mixed, shifts([BARISTA]))).toEqual(['kitchen']);
    expect(unstaffedStations(mixed, shifts([BARISTA, CHEF]))).toEqual([]);

    const cake = order({ lines: [line({ station: 'both' })] });
    expect(unstaffedStations(cake, shifts([CHEF]))).toEqual([]);
    expect(unstaffedStations(cake, shifts())).toEqual(['bar', 'kitchen']);
  });

  it('lit le numéro de commande de l’adresse d’une notification', () => {
    expect(orderFromUrl('/?order=154')).toBe(154);
    expect(orderFromUrl('https://staff.example.com/?order=154')).toBe(154);
    expect(orderFromUrl('/')).toBeNull();
    expect(orderFromUrl('/?order=abc')).toBeNull();
  });
});

describe('écran Commandes', () => {
  it('montre table, heure, lignes, note, choix et total ; offerte : qui l’a demandée', async () => {
    await openOrders([
      order({
        lines: [
          line(),
          line({
            id: 902,
            menuItemId: 2,
            name: { fr: 'Classic Start', en: 'Classic Start' },
            note: null,
            station: 'both',
            choices: [
              { group: 'hot_drink', menuItemId: 57, name: { fr: 'Capuccino', en: 'Cappuccino' } },
            ],
          }),
        ],
      }),
      order({
        id: 155,
        table: { id: 103, number: 103 },
        source: 'offer',
        createdAt: '2026-10-20T08:10:00Z',
        total: 0,
        lines: [line({ unitPrice: 0, lineTotal: 0 })],
        offer: {
          label: 'Nour Ben Salem',
          forClient: true,
          requestedBy: { id: 2, name: 'Nour Ben Salem', title: 'Patronne' },
        },
      }),
    ]);

    const seven = card(/^Table 7, 09:04/);
    expect(seven).toHaveTextContent('Cheese Burger');
    expect(seven).toHaveTextContent('« sans oignon »');
    expect(seven).toHaveTextContent('Capuccino');
    expect(seven).toHaveTextContent('28,5 DT');

    const offered = card(/^103 Nour Ben Salem/);
    expect(offered).toHaveTextContent('Offert à un client par Nour Ben Salem (Patronne)');

    // Les plus anciennes en haut.
    const names = screen.getAllByRole('article').map((a) => a.getAttribute('aria-label'));
    expect(names).toEqual(['Table 7, 09:04', '103 Nour Ben Salem, 09:10']);
  });

  it('nouvelle commande : son, pastille sur l’onglet, même depuis le plan des tables', async () => {
    mockApi(routesFor([]));
    renderShell();
    await screen.findByRole('heading', { name: fr['screen.tables'] });
    expect(ordersTab()).toHaveAccessibleName('Commandes');

    act(() => {
      serverEmit('order:new', order());
    });
    expect(playChime).toHaveBeenCalledWith('new');
    expect(ordersTab()).toHaveAccessibleName('Commandes, 1 à confirmer');
    expect(ordersTab().querySelector('.tabbar__badge')).toHaveTextContent('1');

    // Confirmée sur un autre téléphone : elle disparaît.
    act(() => {
      serverEmit('order:updated', order({ status: 'confirmed' }));
    });
    expect(ordersTab()).toHaveAccessibleName('Commandes');
  });

  it('Confirmer : la commande sort de la liste', async () => {
    const fetchMock = await openOrders([order()], {
      '/api/orders/154/confirm': { status: 200, body: order({ status: 'confirmed' }) },
    });
    await userEvent.click(within(card(/^Table 7/)).getByRole('button', { name: 'Confirmer' }));
    expect(await screen.findByText(fr['orders.empty'])).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/orders/154/confirm',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('personne en cuisine : prévenu sur la carte et après la confirmation', async () => {
    await openOrders([order()], {
      '/api/shifts/current': { status: 200, body: shifts([BARISTA]) },
      '/api/orders/154/confirm': { status: 200, body: order({ status: 'confirmed' }) },
    });
    expect(card(/^Table 7/)).toHaveTextContent('Personne en cuisine : prévenez à l’oral.');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Table 7 confirmée. Personne en cuisine : prévenez à l’oral.',
    );
  });

  it('Rejeter demande une confirmation', async () => {
    const fetchMock = await openOrders([order()], {
      '/api/orders/154/reject': { status: 200, body: order({ status: 'rejected' }) },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Rejeter' }));
    expect(fetchMock).not.toHaveBeenCalledWith('/api/orders/154/reject', expect.anything());
    await userEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    await userEvent.click(screen.getByRole('button', { name: 'Rejeter' }));
    await userEvent.click(screen.getByRole('button', { name: 'Oui, rejeter la commande' }));
    expect(await screen.findByText(fr['orders.empty'])).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/orders/154/reject',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('article en rupture : le nom de l’article, et on propose de rejeter', async () => {
    await openOrders([order()], {
      '/api/orders/154/confirm': {
        status: 409,
        body: {
          error: { code: 'ITEM_UNAVAILABLE', message: '', details: { menuItemId: 3 } },
        },
      },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Confirmer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '« Cheese Burger » est en rupture : rejetez la commande',
    );
    expect(card(/^Table 7/)).toBeInTheDocument();
  });

  it('déjà traitée par un autre serveur ou expirée : retirée, avec un message', async () => {
    let calls = 0;
    await openOrders(
      () => ({ status: 200, body: { items: ++calls === 1 ? [order()] : [], nextCursor: null } }),
      {
        '/api/orders/154/confirm': {
          status: 409,
          body: { error: { code: 'INVALID_STATUS', message: '' } },
        },
      },
    );
    await userEvent.click(screen.getByRole('button', { name: 'Confirmer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Table 7 : déjà traitée par un autre serveur, ou expirée.',
    );
    expect(screen.queryByRole('article')).toBeNull();
  });

  it('réseau coupé : la commande reste, message pour réessayer', async () => {
    await openOrders([order()], { '/api/orders/154/confirm': 'network-error' });
    await userEvent.click(screen.getByRole('button', { name: 'Confirmer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(fr['orders.sendError']);
    expect(screen.getByRole('button', { name: 'Confirmer' })).toBeEnabled();
  });

  it('relit la liste à la reconnexion', async () => {
    let calls = 0;
    await openOrders(() => ({
      status: 200,
      body: { items: ++calls === 1 ? [] : [order()], nextCursor: null },
    }));
    act(() => {
      serverEmit('connect');
    });
    expect(await screen.findByRole('article', { name: /^Table 7/ })).toBeInTheDocument();
  });
});

describe('ouverture depuis une notification', () => {
  it('adresse /?order=154 : ouvre l’onglet Commandes sur la commande, puis nettoie l’adresse', async () => {
    history.replaceState(null, '', '/?order=154');
    mockApi(routesFor([order({ id: 153, table: { id: 8, number: 8 } }), order()]));
    renderShell();
    const target = await screen.findByRole('article', { name: /^Table 7/ });
    // Le focus est posé par un effet, juste après l'affichage de la carte : l'attendre.
    await waitFor(() => {
      expect(target).toHaveFocus();
    });
    expect(location.search).toBe('');
  });

  it('app déjà ouverte : le message du service worker ouvre la commande', async () => {
    const worker = new EventTarget();
    vi.stubGlobal(
      'navigator',
      Object.assign(Object.create(navigator) as Navigator, {
        serviceWorker: worker,
      }),
    );
    mockApi(routesFor([order()]));
    renderShell();
    await screen.findByRole('heading', { name: fr['screen.tables'] });

    act(() => {
      worker.dispatchEvent(
        new MessageEvent('message', { data: { type: 'open', url: '/?order=154' } }),
      );
    });
    const target = await screen.findByRole('article', { name: /^Table 7/ });
    await waitFor(() => {
      expect(target).toHaveFocus();
    });
  });

  it('commande déjà traitée : l’écran le dit', async () => {
    history.replaceState(null, '', '/?order=999');
    mockApi(routesFor([]));
    renderShell();
    expect(await screen.findByText(fr['orders.focusGone'])).toBeInTheDocument();
  });
});
