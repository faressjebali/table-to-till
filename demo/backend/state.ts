// État de la démo : un faux café qui vit dans le navigateur (localStorage), partagé entre le menu
// QR et l'app staff ouverts dans des onglets du même site. Aucune donnée ne quitte le navigateur.
import type {
  MenuItem,
  MenuResponse,
  Order,
  OrderLine,
  Role,
  Table,
} from '../../staff-app/src/api/types';
import menuCustomerJson from '../data/menu-customer.json';
import menuStaffJson from '../data/menu-staff.json';
import tablesJson from '../data/tables.json';

export const menuCustomer = menuCustomerJson as unknown as MenuResponse;
export const menuStaff = menuStaffJson as unknown as MenuResponse;
export const baseTables = (tablesJson as unknown as { tables: Table[] }).tables;

export const DEMO_PASSWORD = 'demo';

export interface DemoUser {
  id: number;
  name: string;
  login: string;
  role: Role;
  title: string | null;
  active: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface DemoShift {
  userId: number;
  startedAt: string;
  principal: boolean;
}

export interface DemoSession {
  id: number;
  tableId: number;
  openedAt: string;
  principalId: number | null;
}

export interface DemoState {
  version: number;
  nextId: number;
  users: DemoUser[];
  shifts: DemoShift[];
  sessions: DemoSession[];
  orders: Order[];
  soldOut: number[];
}

const KEY = 'cafe-olivine.demo.state';
const VERSION = 1;

export const allItems = (menu: MenuResponse): MenuItem[] => menu.categories.flatMap((c) => c.items);
const staffItems = new Map(allItems(menuStaff).map((i) => [i.id, i]));
export const itemById = (id: number) => staffItems.get(id);

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

function line(id: number, itemId: number, quantity: number, note: string | null = null): OrderLine {
  const item = itemById(itemId);
  if (!item) throw new Error(`article ${String(itemId)} absent des données de la démo`);
  return {
    id,
    menuItemId: item.id,
    name: item.name,
    quantity,
    note,
    unitPrice: item.price,
    discountPercent: 0,
    lineTotal: item.price * quantity,
    status: 'active',
    station: item.station,
  };
}

const idOf = (fr: string) => {
  const item = allItems(menuStaff).find((i) => i.name.fr === fr);
  if (!item) throw new Error(`article « ${fr} » absent des données de la démo`);
  return item.id;
};

export const tableNumberOf = (tableId: number) =>
  baseTables.find((t) => t.id === tableId)?.number ?? tableId;

/** Café du matin : deux tables occupées, une commande QR à confirmer, le bar et la cuisine au travail. */
function initialState(): DemoState {
  const users: DemoUser[] = [
    ['Sara Ayari', 'serveur', 'waiter', null],
    ['Youssef Jaziri', 'barista', 'barista', null],
    ['Amira Dridi', 'cuisinier', 'chef', null],
    ['Ines Khelifi', 'manager', 'manager', 'Manager'],
    ['Omar Saidi', 'comptable', 'accountant', 'Comptable'],
  ].map(([name, login, role, title], i) => ({
    id: i + 1,
    name: name as string,
    login: login as string,
    role: role as Role,
    title: title as string | null,
    active: true,
    createdAt: ago(60 * 24 * 30),
    lastLoginAt: ago(60 * 3),
  }));
  const waiter = { id: 1, name: 'Sara Ayari' };
  const order = (
    id: number,
    tableId: number,
    session: number | null,
    status: Order['status'],
    source: Order['source'],
    minutes: number,
    lines: OrderLine[],
  ): Order => ({
    id,
    table: { id: tableId, number: tableNumberOf(tableId) },
    tableSessionId: session,
    source,
    status,
    lines,
    total: lines.reduce((s, l) => s + l.lineTotal, 0),
    createdAt: ago(minutes),
    confirmedAt: status === 'confirmed' ? ago(minutes - 1) : null,
    confirmedBy: status === 'confirmed' ? waiter : null,
    offer: null,
    ready: { bar: null, kitchen: null },
    pos: status === 'confirmed' ? { status: 'entered', error: null } : null,
  });
  const orders: Order[] = [
    order(1, 3, 1, 'confirmed', 'qr', 34, [
      line(1, idOf('Full Morning'), 2),
      line(2, idOf('Capuccino'), 1, 'lait d’avoine'),
    ]),
    order(2, 9, 2, 'confirmed', 'waiter', 12, [
      line(3, idOf('Cheese Burger'), 1, 'sans oignon'),
      line(4, idOf('Frites maison'), 1),
      line(5, idOf('Citrus Boost'), 2),
    ]),
    order(3, 12, null, 'pending', 'qr', 1, [
      line(6, idOf('Iced Latte'), 2),
      line(7, idOf('Carrot cake'), 1),
    ]),
  ];
  // Les formules ont des choix : la commande 1 dit au bar et à la cuisine ce qui a été choisi.
  const first = orders[0]?.lines[0];
  if (first) {
    first.choices = [
      {
        group: 'hot_drink',
        menuItemId: idOf('Espresso'),
        name: { fr: 'Espresso', en: 'Espresso' },
      },
      {
        group: 'eggs',
        menuItemId: idOf('Œufs brouillés'),
        name: { fr: 'Œufs brouillés', en: 'Scrambled eggs' },
      },
      {
        group: 'seasonal_juice',
        menuItemId: idOf('Grenade'),
        name: { fr: 'Grenade', en: 'Pomegranate' },
      },
    ];
  }
  const done = orders[0];
  if (done) done.ready.bar = { at: ago(25), by: { id: 2, name: 'Youssef Jaziri' } };
  return {
    version: VERSION,
    nextId: 100,
    users,
    shifts: [
      { userId: 1, startedAt: ago(150), principal: true },
      { userId: 2, startedAt: ago(155), principal: false },
      { userId: 3, startedAt: ago(140), principal: false },
    ],
    sessions: [
      { id: 1, tableId: 3, openedAt: ago(33), principalId: 1 },
      { id: 2, tableId: 9, openedAt: ago(11), principalId: 1 },
    ],
    orders,
    soldOut: [idOf('Avocat')],
  };
}

let memory: DemoState | null = null;

export function loadState(): DemoState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const state = JSON.parse(raw) as DemoState;
      if (state.version === VERSION) return state;
    }
    const fresh = initialState();
    localStorage.setItem(KEY, JSON.stringify(fresh));
    return fresh;
  } catch {
    // Stockage indisponible (navigation privée) : la démo vit le temps de la page.
    memory ??= initialState();
    return memory;
  }
}

export function saveState(state: DemoState): void {
  memory = state;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Gardé en mémoire seulement.
  }
}

export function resetState(): void {
  memory = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Rien à effacer.
  }
}

export const STATE_KEY = KEY;
