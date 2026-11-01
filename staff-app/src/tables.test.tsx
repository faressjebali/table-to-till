import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Me, Order, OrderLine, Table, TableSessionDetail } from './api/types';
import { StaffShell } from './components/StaffShell';
import { formatAmount, formatPrice } from './format';
import { fr } from './i18n/fr';
import { drawRoom, ofName, PLAN, placeTables, tableDescription, upsertTable } from './tablePlan';
import { serverEmit } from './test/fakeSocket';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const table = (over: Partial<Table> = {}): Table => ({
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
  ...over,
});

const occupied = (over: Partial<Table> = {}) =>
  table({ state: 'occupied', openSessionId: 61, openTotal: 43500, principalId: 4, ...over });

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
  pos: { status: 'entered', error: null },
  ...over,
});

const session = (orders: Order[], total = 11000): TableSessionDetail => ({
  session: {
    id: 61,
    tableId: 7,
    openedAt: '2026-10-20T08:05:00Z',
    closedAt: null,
    status: 'open',
    total,
    orderIds: orders.map((o) => o.id),
    principal: { id: 4, name: 'Amira' },
  },
  orders,
  gifts: [],
});

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
      new Response(JSON.stringify(reply.body), {
        status: reply.status,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const AMIRA: Me = { id: 4, name: 'Amira', role: 'waiter', onShift: true, principal: true };
const SHIFTS = {
  waiters: [
    { id: 4, name: 'Amira', startedAt: '2026-10-20T07:00:00Z', principal: true },
    { id: 5, name: 'Sami Trabelsi', startedAt: '2026-10-20T13:30:00Z', principal: true },
  ],
  stations: [],
};

async function openPlan(
  tables: Table[] | (() => Reply),
  routes: Record<string, Reply | (() => Reply)> = {},
  me: Me = AMIRA,
) {
  localStorage.setItem('coffee-qr.staff.token', 'jeton');
  const fetchMock = mockApi({
    '/api/tables': typeof tables === 'function' ? tables : { status: 200, body: { tables } },
    '/api/shifts/current': { status: 200, body: SHIFTS },
    ...routes,
  });
  render(<StaffShell me={me} onLogout={() => undefined} onShiftChange={() => Promise.resolve()} />);
  await screen.findByRole('heading', { name: fr['screen.tables'] });
  return fetchMock;
}

// Texte affiché d'un prix : jest-dom ramène l'espace insécable à une espace simple.
const shown = (millimes: number) =>
  formatPrice(millimes).replaceAll(String.fromCharCode(0xa0), ' ');
// Total de la table, en haut à droite.
const tableTotal = () => document.querySelector('.table-head__total');

const planTable = (number: number) =>
  within(screen.getByRole('group', { name: fr['tables.plan'] })).getByRole('button', {
    name: new RegExp(`^Table ${String(number)},`),
  });

describe('placement sur le plan', () => {
  it('place chaque table à sa case, sans les bords vides, tables sans case exclues', () => {
    const { placed, columns, rows } = placeTables([
      table({ id: 1, layout: { room: 'inside', x: 2, y: 1, w: 1, h: 1, shape: 'square' } }),
      table({ id: 2, layout: { room: 'inside', x: 14, y: 9, w: 2, h: 1, shape: 'round' } }),
      table({ id: 3, layout: null }),
    ]);
    expect(placed.map((p) => [p.table.id, p.column, p.row, p.round])).toEqual([
      [1, 1, 1, false],
      [2, 13, 9, true],
    ]);
    expect({ columns, rows }).toEqual({ columns: 14, rows: 9 });
  });

  it('remplace une table mise à jour, ajoute une table inconnue', () => {
    const list = [table({ id: 1 }), table({ id: 2 })];
    expect(upsertTable(list, occupied({ id: 2 }))[1]).toMatchObject({ state: 'occupied' });
    expect(upsertTable(list, table({ id: 3 }))).toHaveLength(3);
  });

  it('caisse d’un principal et description pour le lecteur d’écran', () => {
    expect(ofName('Sami Trabelsi')).toBe('de Sami Trabelsi');
    expect(ofName('Amira')).toBe('d’Amira');
    expect(tableDescription(occupied({ pendingOrders: 2 }), 'Sami')).toBe(
      `Table 7, occupée, ${formatPrice(43500)}, 2 commandes à confirmer, caisse de Sami`,
    );
    expect(tableDescription(table(), null)).toBe('Table 7, libre');
  });
});

describe('plan des tables', () => {
  it('montre chaque table avec son état, son montant et ses commandes à confirmer', async () => {
    await openPlan([
      occupied({ id: 7, number: 7 }),
      table({
        id: 8,
        number: 8,
        pendingOrders: 1,
        layout: { room: 'inside', x: 4, y: 3, w: 1, h: 1, shape: 'round' },
      }),
      table({
        id: 9,
        number: 9,
        layout: { room: 'inside', x: 14, y: 9, w: 1, h: 1, shape: 'square' },
      }),
    ]);

    const seven = planTable(7);
    expect(seven).toHaveClass('table-tile--occupied');
    expect(seven).toHaveTextContent(formatAmount(43500));
    expect(seven).toHaveAccessibleName(`Table 7, occupée, ${formatPrice(43500)}`);

    // Une commande en attente ne rend pas la table occupée.
    const eight = planTable(8);
    expect(eight).not.toHaveClass('table-tile--occupied');
    expect(eight).toHaveClass('table-tile--pending', 'table-tile--round');
    expect(eight).toHaveAccessibleName('Table 8, libre, 1 commande à confirmer');

    const legend = screen.getByRole('list', { name: fr['tables.summary'] });
    expect(legend).toHaveTextContent('1 occupées');
    expect(legend).toHaveTextContent('2 libres');
    expect(legend).toHaveTextContent('1 à confirmer');
  });

  it('suit table:updated sans recharger', async () => {
    await openPlan([table()]);
    act(() => {
      serverEmit('table:updated', occupied({ openTotal: 7000 }));
    });
    expect(planTable(7)).toHaveTextContent(formatAmount(7000));
  });

  it('relit le plan à la reconnexion', async () => {
    let calls = 0;
    await openPlan(() => ({
      status: 200,
      body: { tables: [++calls === 1 ? table() : occupied()] },
    }));
    act(() => {
      serverEmit('connect');
    });
    expect(await screen.findByRole('button', { name: /^Table 7, occupée/ })).toBeInTheDocument();
  });

  it('passation : les tables de l’autre principal portent son icône, son nom est au résumé', async () => {
    await openPlan([
      occupied({ id: 7, number: 7, principalId: 4 }),
      occupied({
        id: 8,
        number: 8,
        principalId: 5,
        layout: { room: 'inside', x: 4, y: 3, w: 1, h: 1, shape: 'square' },
      }),
    ]);
    expect(planTable(7)).not.toHaveClass('table-tile--other');
    const eight = planTable(8);
    expect(eight).toHaveClass('table-tile--other');
    expect(eight.querySelector('.table-tile__other svg')).not.toBeNull();
    expect(screen.getByRole('list', { name: fr['tables.summary'] })).toHaveTextContent(
      'Sami Trabelsi : 1 table',
    );
    expect(eight).toHaveAccessibleName(/caisse de Sami Trabelsi$/);
  });

  it('un seul principal : aucune icône d’autre principal', async () => {
    await openPlan([occupied({ principalId: 4 })]);
    expect(planTable(7)).not.toHaveClass('table-tile--other');
  });

  it('réseau coupé au chargement : message et Réessayer', async () => {
    let calls = 0;
    await openPlan(() =>
      ++calls === 1 ? 'network-error' : { status: 200, body: { tables: [table()] } },
    );
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(fr['tables.error']);
    await userEvent.click(within(alert).getByRole('button', { name: fr['session.retry'] }));
    expect(await screen.findByRole('button', { name: /^Table 7,/ })).toBeInTheDocument();
  });
});

describe('commandes d’une table', () => {
  it('ouvre les commandes : lignes, choix, notes, annulées, état caisse et total', async () => {
    const detail = session(
      [
        order({
          lines: [
            line(),
            line({
              id: 902,
              name: { fr: 'Classic Start', en: 'Classic Start' },
              quantity: 1,
              lineTotal: 20500,
              note: 'sans sucre',
              choices: [
                { group: 'hot_drink', menuItemId: 20, name: { fr: 'Espresso', en: 'Espresso' } },
              ],
            }),
            line({
              id: 903,
              name: { fr: 'Cookie', en: 'Cookie' },
              status: 'cancelled',
              quantity: 1,
            }),
          ],
          total: 36500,
        }),
        order({ id: 155, source: 'waiter', pos: { status: 'failed', error: 'SCREEN_MISMATCH' } }),
      ],
      50000,
    );
    await openPlan([occupied({ pendingOrders: 1 })], {
      '/api/tables/7/session': { status: 200, body: detail },
    });
    await userEvent.click(planTable(7));

    expect(await screen.findByRole('heading', { name: 'Table 7', level: 1 })).toBeInTheDocument();
    expect(
      screen.getByText(`${fr['table.cash']} d’Amira, ${fr['table.openedAt'].toLowerCase()} 09:05`),
    ).toBeInTheDocument();
    expect(screen.getByText('1 commande à confirmer')).toBeInTheDocument();
    expect(tableTotal()).toHaveTextContent(`${fr['table.total']}${shown(36000)}`);

    const [first, second] = screen.getAllByRole('article');
    if (!first || !second) throw new Error('deux commandes attendues');
    expect(first).toHaveTextContent('QR, 09:05');
    expect(first).toHaveTextContent(fr['table.pos.entered']);
    expect(first).toHaveTextContent('Espresso');
    expect(first).toHaveTextContent('« sans sucre »');
    expect(first).toHaveTextContent(fr['station.cancelled']);
    expect(second).toHaveTextContent(fr['table.pos.failed']);
  });

  it('table libre : aucune commande', async () => {
    await openPlan([table()], {
      '/api/tables/7/session': {
        status: 404,
        body: { error: { code: 'NOT_FOUND', message: 'x' } },
      },
    });
    await userEvent.click(planTable(7));
    expect(await screen.findByText(fr['table.freeBody'])).toBeInTheDocument();
  });

  it('relit les commandes quand la table change, et Retour ramène au plan', async () => {
    let calls = 0;
    await openPlan([occupied()], {
      '/api/tables/7/session': () => ({
        status: 200,
        body: ++calls === 1 ? session([order()]) : session([order(), order({ id: 155 })], 28000),
      }),
    });
    await userEvent.click(planTable(7));
    expect(await screen.findAllByRole('article')).toHaveLength(1);

    act(() => {
      serverEmit('table:updated', occupied({ id: 8, number: 8 }));
    });
    expect(calls).toBe(1);
    act(() => {
      serverEmit('table:updated', occupied({ openTotal: 31500 }));
    });
    await vi.waitFor(() => {
      expect(screen.getAllByRole('article')).toHaveLength(2);
    });
    expect(tableTotal()).toHaveTextContent(shown(31500));

    await userEvent.click(screen.getByRole('button', { name: `‹ ${fr['table.back']}` }));
    expect(screen.getByRole('group', { name: fr['tables.plan'] })).toBeInTheDocument();
  });

  it('seulement « Saisir une commande », aucune action d’argent pour l’instant', async () => {
    await openPlan([occupied()], {
      '/api/tables/7/session': { status: 200, body: session([order()]) },
    });
    await userEvent.click(planTable(7));
    await screen.findByRole('article');
    const main = screen.getByRole('heading', { name: 'Table 7', level: 1 }).closest('.shell');
    if (!(main instanceof HTMLElement)) throw new Error('pas d’écran');
    const buttons = within(main)
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(buttons).toEqual([`‹ ${fr['table.back']}`, fr['entry.start']]);
  });
});

describe('deux salles (docs/tables.csv, docs/design.md)', () => {
  // Les tables réelles du CSV, avec leur salle, leur forme et leur case.
  const csv = readFileSync('../docs/tables.csv', 'utf8').trim().split(/\r?\n/).slice(1);
  const real = csv
    .map((line) => line.split(','))
    .filter(([, kind]) => kind === 'real')
    .map(([number, , salle, forme, x, y]) =>
      table({
        id: Number(number),
        number: Number(number),
        layout: {
          room: salle === 'terrasse' ? 'terrace' : 'inside',
          x: Number(x),
          y: Number(y),
          w: forme === 'longue' ? 2 : 1,
          h: 1,
          shape: forme === 'ronde' ? 'round' : 'square',
        },
      }),
    );
  const room = (r: 'inside' | 'terrace') => drawRoom(real.filter((t) => t.layout?.room === r));

  it.each(['inside', 'terrace'] as const)(
    '%s : tient dans 328 px et garde 8 px entre deux tables',
    (r) => {
      const plan = room(r);
      expect(plan.width).toBeLessThanOrEqual(328);
      const boxes = plan.tables;
      for (const a of boxes) {
        for (const b of boxes) {
          if (a === b) continue;
          const apartX = Math.max(b.left - (a.left + a.width), a.left - (b.left + b.width));
          const apartY = Math.max(b.top - (a.top + a.height), a.top - (b.top + b.height));
          expect(Math.max(apartX, apartY)).toBeGreaterThanOrEqual(PLAN.gap);
        }
      }
    },
  );

  it('18 tables dedans, 6 en terrasse ; rondes de 56 px, la 19 longue sur deux cases', () => {
    const inside = room('inside');
    const terrace = room('terrace');
    expect(inside.tables).toHaveLength(18);
    expect(terrace.tables).toHaveLength(6);
    const at = (plan: typeof inside, n: number) => plan.tables.find((d) => d.table.number === n);
    expect(at(inside, 17)).toMatchObject({ round: true, width: 56, height: 56 });
    expect(at(terrace, 19)).toMatchObject({ long: true, width: 2 * PLAN.tile + PLAN.gap });
    // Positions relatives de la salle : 17 à gauche de 18, 5 à gauche de 12, 9 tout en bas.
    expect(at(inside, 17)?.left).toBeLessThan(at(inside, 18)?.left ?? 0);
    expect(at(inside, 5)?.left).toBeLessThan(at(inside, 12)?.left ?? 0);
    expect(at(inside, 9)?.top).toBe(Math.max(...inside.tables.map((d) => d.top)));
    // Terrasse : 22 sous 20, 23 sous 21, 100 à gauche de 22.
    expect(at(terrace, 22)?.left).toBe(at(terrace, 20)?.left);
    expect(at(terrace, 23)?.left).toBe(at(terrace, 21)?.left);
    expect(at(terrace, 100)?.left).toBeLessThan(at(terrace, 22)?.left ?? 0);
  });
});

describe('choix de la salle', () => {
  const terrace = (over: Partial<Table> = {}) =>
    table({
      id: 20,
      number: 20,
      layout: { room: 'terrace', x: 1, y: 0, w: 1, h: 1, shape: 'square' },
      ...over,
    });
  const roomRadio = (name: string) => screen.getByRole('radio', { name: new RegExp(`^${name}`) });

  it('intérieur par défaut ; la terrasse en un tap, gardée au prochain lancement', async () => {
    await openPlan([table(), terrace()]);
    expect(roomRadio(fr['room.inside'])).toBeChecked();
    expect(screen.queryByRole('button', { name: /^Table 20,/ })).toBeNull();
    await userEvent.click(roomRadio(fr['room.terrace']));
    expect(planTable(20)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Table 7,/ })).toBeNull();

    cleanup();
    await openPlan([table(), terrace()]);
    expect(roomRadio(fr['room.terrace'])).toBeChecked();
  });

  it('une table de l’autre salle à confirmer : pastille sur son onglet, pas sur celui affiché', async () => {
    await openPlan([table({ pendingOrders: 1 }), terrace({ pendingOrders: 2 })]);
    const terraceTab = roomRadio(fr['room.terrace']).closest('label');
    expect(terraceTab?.querySelector('.segmented__badge')).toHaveTextContent('1');
    const insideTab = roomRadio(fr['room.inside']).closest('label');
    expect(insideTab?.querySelector('.segmented__badge')).toBeNull();
  });

  it('une puce dont les tables ne sont que dans l’autre salle y emmène', async () => {
    await openPlan([table(), terrace({ pendingOrders: 1 })]);
    const summary = screen.getByRole('list', { name: fr['tables.summary'] });
    await userEvent.click(
      within(summary).getByRole('button', { name: `1 ${fr['tables.pending']}` }),
    );
    expect(roomRadio(fr['room.terrace'])).toBeChecked();
    expect(planTable(20).parentElement).not.toHaveClass('room__cell--dim');
  });
});

describe('résumé, légende et tables prêtes', () => {
  it('une puce met ses tables en évidence ; un deuxième tap annule', async () => {
    await openPlan([
      occupied({ id: 7, number: 7 }),
      table({
        id: 8,
        number: 8,
        layout: { room: 'inside', x: 4, y: 3, w: 1, h: 1, shape: 'square' },
      }),
    ]);
    const summary = screen.getByRole('list', { name: fr['tables.summary'] });
    const chip = within(summary).getByRole('button', { name: `1 ${fr['tables.occupied']}` });
    await userEvent.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    expect(planTable(8).parentElement).toHaveClass('room__cell--dim');
    expect(planTable(7).parentElement).not.toHaveClass('room__cell--dim');
    await userEvent.click(chip);
    expect(planTable(8).parentElement).not.toHaveClass('room__cell--dim');
  });

  it('légende en un tap : les 7 états avec leur nom', async () => {
    await openPlan([table()]);
    const button = screen.getByRole('button', { name: fr['tables.legend'] });
    await userEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const legend = screen.getByRole('region', { name: fr['tables.legend'] });
    for (const key of [
      'legend.free',
      'legend.occupied',
      'legend.pending',
      'legend.failed',
      'legend.bar',
      'legend.kitchen',
      'legend.other',
    ] as const) {
      expect(within(legend).getByText(fr[key])).toBeInTheDocument();
    }
    await userEvent.click(within(legend).getByRole('button', { name: fr['tables.legendClose'] }));
    expect(screen.queryByRole('region', { name: fr['tables.legend'] })).toBeNull();
  });

  it('prête au bar et en cuisine : une seule bande, gardée après un redémarrage, partie au OK', async () => {
    await openPlan([occupied()]);
    act(() => {
      serverEmit('order:ready', { orderId: 154, table: { id: 7, number: 7 }, station: 'bar' });
      serverEmit('order:ready', { orderId: 154, table: { id: 7, number: 7 }, station: 'kitchen' });
    });
    expect(planTable(7)).toHaveClass('table-tile--ready');
    expect(planTable(7).querySelectorAll('.table-tile__ready')).toHaveLength(1);
    expect(planTable(7)).toHaveAccessibleName(
      `Table 7, occupée, ${formatPrice(43500)}, ${fr['table.readyBar']}, ${fr['table.readyKitchen']}`,
    );

    // L'app redémarre : la bande et le bandeau reviennent sans rien recevoir.
    cleanup();
    await openPlan([occupied()]);
    expect(planTable(7)).toHaveClass('table-tile--ready');
    for (const dismiss of screen.getAllByRole('button', { name: fr['ready.dismiss'] })) {
      await userEvent.click(dismiss);
    }
    expect(planTable(7)).not.toHaveClass('table-tile--ready');
  });

  it('table libérée : plus rien de prêt', async () => {
    await openPlan([occupied()]);
    act(() => {
      serverEmit('order:ready', { orderId: 154, table: { id: 7, number: 7 }, station: 'bar' });
    });
    act(() => {
      serverEmit('table:updated', table());
    });
    expect(planTable(7)).not.toHaveClass('table-tile--ready');
    expect(screen.queryByText('Table 7 : boissons prêtes')).toBeNull();
  });
});
