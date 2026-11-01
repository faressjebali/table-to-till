import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentShifts, Me, MenuItem, MenuResponse, Order, Table } from './api/types';
import { StaffShell } from './components/StaffShell';
import { fr } from './i18n/fr';
import {
  addSelection,
  clearDrafts,
  draftCount,
  draftTotal,
  itemsById,
  matches,
  orderLines,
  quickAdd,
  setQuantity,
} from './staffOrder';
import { serverEmit } from './test/fakeSocket';

// Saisir une commande pour une table (docs/product.md § 5, `POST /staff-orders`).

beforeEach(() => {
  clearDrafts();
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const item = (over: Partial<MenuItem> = {}): MenuItem => ({
  id: 57,
  categoryId: 20,
  name: { fr: 'Capuccino', en: 'Cappuccino' },
  description: null,
  price: 8500,
  photoUrl: null,
  available: true,
  unavailableReason: null,
  availability: { days: [1, 2, 3, 4, 5, 6, 7], from: null, until: null },
  suggestedExtraIds: [],
  choiceGroups: [],
  noteHint: null,
  station: 'bar',
  posCode: '601',
  ...over,
});

const CAPPUCCINO = item();
const ESPRESSO = item({ id: 58, name: { fr: 'Espresso', en: 'Espresso' }, price: 6500 });
const BURGER = item({
  id: 3,
  categoryId: 9,
  name: { fr: 'Cheese Burger', en: 'Cheese Burger' },
  price: 28500,
  station: 'kitchen',
  suggestedExtraIds: [41],
});
const BACON = item({
  id: 41,
  categoryId: 9,
  name: { fr: 'Bacon de bœuf', en: 'Beef bacon' },
  price: 8500,
  station: 'kitchen',
});
const CLASSIC = item({
  id: 2,
  categoryId: 1,
  name: { fr: 'Classic Start', en: 'Classic Start' },
  price: 14500,
  station: 'both',
  choiceGroups: ['hot_drink'],
});
const EGGS = item({
  id: 30,
  categoryId: 2,
  name: { fr: 'Œufs brouillés', en: 'Scrambled eggs' },
  price: 7000,
  station: 'kitchen',
});
const WEEK_DISH = item({
  id: 86,
  categoryId: 9,
  name: { fr: 'Plat de la semaine', en: 'Dish of the week' },
  available: false,
  unavailableReason: 'outside_hours',
});

const menu = (over: (i: MenuItem) => MenuItem = (i) => i): MenuResponse => ({
  categories: [
    {
      id: 1,
      name: { fr: 'Formules', en: 'Breakfast' },
      section: 'food',
      display: 'list',
      sortOrder: 1,
      items: [CLASSIC].map(over),
    },
    {
      id: 2,
      name: { fr: 'Œufs', en: 'Eggs' },
      section: 'food',
      display: 'list',
      sortOrder: 2,
      items: [EGGS].map(over),
    },
    {
      id: 9,
      name: { fr: 'Plats', en: 'Mains' },
      section: 'food',
      display: 'list',
      sortOrder: 3,
      items: [BURGER, BACON, WEEK_DISH].map(over),
    },
    {
      id: 20,
      name: { fr: 'Cafés', en: 'Coffees' },
      section: 'drinks',
      display: 'list',
      sortOrder: 4,
      items: [CAPPUCCINO, ESPRESSO].map(over),
    },
  ],
  choiceGroups: [
    { key: 'hot_drink', name: { fr: 'Café ou thé', en: 'Coffee or tea' }, optionIds: [57, 58] },
  ],
});

describe('brouillon de commande', () => {
  const items = itemsById(menu());

  it('« + » augmente la ligne simple ; une note ou des choix font une autre ligne', () => {
    let lines = quickAdd([], 57);
    lines = quickAdd(lines, 57);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.quantity).toBe(2);

    lines = addSelection(lines, {
      item: CAPPUCCINO,
      quantity: 1,
      note: ' sans sucre ',
      choices: [],
      extraIds: [],
    });
    expect(lines).toHaveLength(2);
    expect(lines[1]?.note).toBe('sans sucre');
    expect(draftCount(lines)).toBe(3);
    expect(draftTotal(lines, items)).toBe(20000);
  });

  it('chaque extra coché devient une ligne de 1, au format du contrat', () => {
    const lines = addSelection([], {
      item: BURGER,
      quantity: 2,
      note: '',
      choices: [],
      extraIds: [41],
    });
    expect(orderLines(lines)).toEqual([
      { menuItemId: 3, quantity: 2, note: null },
      { menuItemId: 41, quantity: 1, note: null },
    ]);
    const formula = addSelection([], {
      item: CLASSIC,
      quantity: 1,
      note: '',
      choices: [{ group: 'hot_drink', menuItemId: 57 }],
      extraIds: [],
    });
    expect(orderLines(formula)).toEqual([
      { menuItemId: 2, quantity: 1, note: null, choices: [{ group: 'hot_drink', menuItemId: 57 }] },
    ]);
  });

  it('quantité bornée à 1–20', () => {
    const lines = quickAdd([], 57);
    const key = lines[0]?.key ?? '';
    expect(setQuantity(lines, key, 0)[0]?.quantity).toBe(1);
    expect(setQuantity(lines, key, 25)[0]?.quantity).toBe(20);
  });

  it('recherche sans accents, par nom français, anglais ou code caisse', () => {
    expect(matches(EGGS, 'oeufs brou')).toBe(true);
    expect(matches(EGGS, 'scrambled')).toBe(true);
    expect(matches(CAPPUCCINO, '601')).toBe(true);
    expect(matches(CAPPUCCINO, 'thé')).toBe(false);
  });
});

const AMIRA: Me = { id: 4, name: 'Amira', role: 'waiter', onShift: true, principal: true };
const BARISTA_ONLY: CurrentShifts = {
  waiters: [{ id: 4, name: 'Amira', startedAt: '2026-10-20T07:00:00Z', principal: true }],
  stations: [{ id: 9, name: 'Nour', role: 'barista', startedAt: '2026-10-20T07:00:00Z' }],
};

const freeTable: Table = {
  id: 7,
  number: 7,
  kind: 'real',
  state: 'free',
  openSessionId: null,
  openTotal: 0,
  pendingOrders: 0,
  layout: { room: 'inside', x: 7, y: 2, w: 1, h: 1, shape: 'square' },
  offer: null,
  principalId: null,
};

const created = (lines: Order['lines']): Order => ({
  id: 160,
  table: { id: 7, number: 7 },
  tableSessionId: 61,
  source: 'waiter',
  status: 'confirmed',
  lines,
  total: lines.reduce((s, l) => s + l.lineTotal, 0),
  createdAt: '2026-10-20T09:00:00Z',
  confirmedAt: '2026-10-20T09:00:00Z',
  confirmedBy: { id: 4, name: 'Amira' },
  offer: null,
  ready: { bar: null, kitchen: null },
  pos: { status: 'queued', error: null },
});

type Reply = { status: number; body?: unknown } | 'network-error';

function mockApi(routes: Record<string, Reply | ((init?: RequestInit) => Reply)>) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const route = routes[String(input)];
    if (route === undefined) return Promise.reject(new TypeError(`inattendu : ${String(input)}`));
    const reply = typeof route === 'function' ? route(init) : route;
    if (reply === 'network-error') return Promise.reject(new TypeError('Failed to fetch'));
    return Promise.resolve(
      new Response(JSON.stringify(reply.body), {
        status: reply.status,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const bodies = (fetchMock: ReturnType<typeof mockApi>) =>
  fetchMock.mock.calls
    .filter(([input]) => String(input) === '/api/staff-orders')
    .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);

/** Plan → table 7 → « Saisir une commande ». */
async function openEntry(
  routes: Record<string, Reply | ((init?: RequestInit) => Reply)> = {},
  shifts: CurrentShifts = BARISTA_ONLY,
) {
  localStorage.setItem('coffee-qr.staff.token', 'jeton');
  const fetchMock = mockApi({
    '/api/tables': { status: 200, body: { tables: [freeTable] } },
    '/api/shifts/current': { status: 200, body: shifts },
    '/api/tables/7/session': { status: 404, body: { error: { code: 'NOT_FOUND', message: 'x' } } },
    '/api/menu': { status: 200, body: menu() },
    ...routes,
  });
  render(
    <StaffShell me={AMIRA} onLogout={() => undefined} onShiftChange={() => Promise.resolve()} />,
  );
  await screen.findByRole('heading', { name: fr['screen.tables'] });
  const plan = screen.getByRole('group', { name: fr['tables.plan'] });
  await userEvent.click(within(plan).getByRole('button', { name: /^Table 7,/ }));
  await userEvent.click(await screen.findByRole('button', { name: fr['entry.start'] }));
  await screen.findByRole('heading', { name: 'Cafés' });
  return fetchMock;
}

const quick = (name: string) =>
  screen.getByRole('button', { name: `${fr['entry.addOne']} ${name}` });

describe('saisir une commande', () => {
  it('ajoute en un tap, envoie au bon format, puis revient à la table', async () => {
    const fetchMock = await openEntry({
      '/api/staff-orders': {
        status: 201,
        body: created([]),
      },
    });
    // Un article hors de ses horaires n'apparaît pas.
    expect(screen.queryByText('Plat de la semaine')).not.toBeInTheDocument();

    await userEvent.click(quick('Capuccino'));
    await userEvent.click(quick('Capuccino'));
    await userEvent.click(quick('Espresso'));
    expect(screen.getByText(/3 articles/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: fr['entry.review'] }));
    expect(
      screen.getByRole('heading', { name: `${fr['entry.reviewTitle']} 7` }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: `${fr['entry.send']} 7` }));

    expect(await screen.findByText(fr['entry.sent'])).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Table 7', level: 1 })).toBeInTheDocument();
    const [body] = bodies(fetchMock);
    expect(body).toMatchObject({
      tableId: 7,
      lines: [
        { menuItemId: 57, quantity: 2, note: null },
        { menuItemId: 58, quantity: 1, note: null },
      ],
    });
    expect(typeof body?.['clientRequestId']).toBe('string');
  });

  it('formule : choix obligatoire avant d’ajouter, puis envoyé avec la ligne', async () => {
    const fetchMock = await openEntry({ '/api/staff-orders': { status: 201, body: created([]) } });
    // Pas de « + » pour une formule : ses choix sont obligatoires.
    expect(
      screen.queryByRole('button', { name: `${fr['entry.addOne']} Classic Start` }),
    ).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /Classic Start/ }));
    const add = screen.getByRole('button', { name: /^Ajouter ·/ });
    expect(add).toBeDisabled();
    expect(screen.getByText(fr['entry.chooseFirst'])).toBeInTheDocument();

    const group = screen.getByRole('group', { name: 'Café ou thé' });
    await userEvent.click(within(group).getByRole('radio', { name: 'Espresso' }));
    await userEvent.type(screen.getByLabelText(fr['entry.note']), 'sans sucre');
    await userEvent.click(screen.getByRole('button', { name: /^Ajouter ·/ }));

    await userEvent.click(screen.getByRole('button', { name: fr['entry.review'] }));
    expect(screen.getByText('« sans sucre »')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: `${fr['entry.send']} 7` }));
    await screen.findByText(fr['entry.sent']);
    expect(bodies(fetchMock)[0]?.['lines']).toEqual([
      {
        menuItemId: 2,
        quantity: 1,
        note: 'sans sucre',
        choices: [{ group: 'hot_drink', menuItemId: 58 }],
      },
    ]);
  });

  it('extras suggérés : chacun sur sa ligne', async () => {
    const fetchMock = await openEntry({ '/api/staff-orders': { status: 201, body: created([]) } });
    await userEvent.click(screen.getByRole('button', { name: /^Cheese Burger/ }));
    await userEvent.click(
      screen.getByRole('button', { name: `${fr['entry.more']} : Cheese Burger` }),
    );
    await userEvent.click(screen.getByRole('checkbox', { name: /Bacon de bœuf/ }));
    await userEvent.click(screen.getByRole('button', { name: /^Ajouter ·/ }));
    await userEvent.click(screen.getByRole('button', { name: fr['entry.review'] }));
    await userEvent.click(screen.getByRole('button', { name: `${fr['entry.send']} 7` }));
    await screen.findByText(fr['entry.sent']);
    expect(bodies(fetchMock)[0]?.['lines']).toEqual([
      { menuItemId: 3, quantity: 2, note: null },
      { menuItemId: 41, quantity: 1, note: null },
    ]);
  });

  it('rupture reçue en direct : l’article est grisé, plus de « + »', async () => {
    await openEntry();
    expect(quick('Espresso')).toBeEnabled();
    act(() => {
      serverEmit('menu:updated', {
        menuItemId: 58,
        available: false,
        unavailableReason: 'sold_out',
      });
    });
    expect(screen.queryByRole('button', { name: `${fr['entry.addOne']} Espresso` })).toBeNull();
    expect(screen.getByRole('button', { name: /^Espresso/ })).toBeDisabled();
  });

  it('personne en cuisine : prévenu avant l’envoi et après', async () => {
    await openEntry({
      '/api/staff-orders': {
        status: 201,
        body: created([
          {
            id: 1,
            menuItemId: 3,
            name: { fr: 'Cheese Burger', en: 'Cheese Burger' },
            quantity: 1,
            note: null,
            unitPrice: 28500,
            discountPercent: 0,
            lineTotal: 28500,
            status: 'active',
            station: 'kitchen',
          },
        ]),
      },
    });
    await userEvent.click(quick('Cheese Burger'));
    await userEvent.click(screen.getByRole('button', { name: fr['entry.review'] }));
    const warning = `${fr['orders.nobodyKitchen']} ${fr['orders.tellThem']}`;
    expect(screen.getByText(warning)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: `${fr['entry.send']} 7` }));
    expect(await screen.findByText(`${fr['entry.sent']} ${warning}`)).toBeInTheDocument();
  });

  it('réseau coupé : la commande est gardée et renvoyée avec le même identifiant', async () => {
    let calls = 0;
    const fetchMock = await openEntry({
      '/api/staff-orders': () => {
        calls += 1;
        return calls === 1 ? 'network-error' : { status: 201, body: created([]) };
      },
    });
    await userEvent.click(quick('Capuccino'));
    await userEvent.click(screen.getByRole('button', { name: fr['entry.review'] }));
    await userEvent.click(screen.getByRole('button', { name: `${fr['entry.send']} 7` }));
    expect(await screen.findByText(fr['entry.error.network'])).toBeInTheDocument();
    expect(screen.getByText('Capuccino')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: `${fr['entry.send']} 7` }));
    await screen.findByText(fr['entry.sent']);
    const [first, second] = bodies(fetchMock);
    expect(second?.['clientRequestId']).toBe(first?.['clientRequestId']);
  });

  it('article refusé (rupture) : nommé, la commande reste à corriger', async () => {
    await openEntry({
      '/api/staff-orders': {
        status: 409,
        body: { error: { code: 'ITEM_UNAVAILABLE', message: 'x', details: { menuItemId: 57 } } },
      },
    });
    await userEvent.click(quick('Capuccino'));
    await userEvent.click(screen.getByRole('button', { name: fr['entry.review'] }));
    await userEvent.click(screen.getByRole('button', { name: `${fr['entry.send']} 7` }));
    expect(
      await screen.findByText(`« Capuccino » ${fr['entry.error.soldOut']}`),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: fr['entry.remove'] }));
    expect(screen.getByText(fr['entry.empty'])).toBeInTheDocument();
  });

  it('brouillon gardé en quittant la saisie, retrouvé en revenant', async () => {
    await openEntry();
    await userEvent.click(quick('Espresso'));
    await userEvent.click(screen.getByRole('button', { name: /‹ Table 7/ }));
    await userEvent.click(screen.getByRole('button', { name: fr['entry.start'] }));
    await screen.findByRole('heading', { name: 'Cafés' });
    expect(screen.getByText(/1 article ·/)).toBeInTheDocument();
  });
});
