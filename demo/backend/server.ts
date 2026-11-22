// Faux serveur de la démo : les mêmes routes et les mêmes formes que docs/api.md, calculées dans
// le navigateur. Comme le vrai serveur, il calcule tous les prix (millimes) et ignore ceux du client.
import type {
  MenuItem,
  MenuResponse,
  Order,
  OrderLine,
  Table,
  User,
} from '../../staff-app/src/api/types';
import { publish } from './bus';
import {
  DEMO_PASSWORD,
  baseTables,
  itemById,
  loadState,
  menuCustomer,
  menuStaff,
  saveState,
  tableNumberOf,
  type DemoState,
  type DemoUser,
} from './state';

export interface DemoRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
  token: string | null;
}
export interface DemoResponse {
  status: number;
  body?: unknown;
}

class Fail extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

const now = () => new Date().toISOString();
const ok = (body: unknown, status = 200): DemoResponse => ({ status, body });
const noContent: DemoResponse = { status: 204 };

type LineInput = {
  menuItemId: number;
  quantity: number;
  note: string | null;
  choices?: { group: string; menuItemId: number }[];
};

/** Disponibilité de la démo : horloge figée pendant l'ouverture, seules les ruptures comptent. */
function withAvailability(menu: MenuResponse, state: DemoState): MenuResponse {
  return {
    ...menu,
    categories: menu.categories.map((c) => ({
      ...c,
      items: c.items.map((i): MenuItem => ({
        ...i,
        available: !state.soldOut.includes(i.id),
        unavailableReason: state.soldOut.includes(i.id) ? 'sold_out' : null,
      })),
    })),
  };
}

function userOf(state: DemoState, token: string | null): DemoUser {
  const match = /^demo-token-(\d+)$/.exec(token ?? '');
  const user = match ? state.users.find((u) => u.id === Number(match[1])) : undefined;
  if (!user) throw new Fail(401, 'UNAUTHORIZED');
  if (!user.active) throw new Fail(403, 'ACCOUNT_DISABLED');
  return user;
}

const shiftOf = (state: DemoState, user: DemoUser) =>
  state.shifts.find((s) => s.userId === user.id);

function requireOnShift(state: DemoState, user: DemoUser, roles: DemoUser['role'][]) {
  if (!roles.includes(user.role)) throw new Fail(403, 'FORBIDDEN');
  if (!shiftOf(state, user)) throw new Fail(403, 'NOT_ON_SHIFT');
}

const toUser = (u: DemoUser): User => ({
  id: u.id,
  name: u.name,
  login: u.login,
  role: u.role,
  title: u.title,
  active: u.active,
  mustChangePassword: false,
  locked: false,
  lastLoginAt: u.lastLoginAt,
  createdAt: u.createdAt,
});

function buildLines(state: DemoState, lines: LineInput[]): OrderLine[] {
  if (!Array.isArray(lines) || lines.length === 0) throw new Fail(400, 'VALIDATION_ERROR');
  return lines.map((input) => {
    const item = itemById(input.menuItemId);
    if (!item) throw new Fail(400, 'VALIDATION_ERROR', { field: 'menuItemId' });
    if (state.soldOut.includes(item.id)) {
      throw new Fail(409, 'ITEM_UNAVAILABLE', { menuItemId: item.id });
    }
    const quantity = Math.min(20, Math.max(1, Math.trunc(input.quantity)));
    const line: OrderLine = {
      id: state.nextId++,
      menuItemId: item.id,
      name: item.name,
      quantity,
      note: input.note?.trim() ? input.note.trim().slice(0, 200) : null,
      unitPrice: item.price,
      discountPercent: 0,
      lineTotal: item.price * quantity,
      status: 'active',
      station: item.station,
    };
    const choices = (input.choices ?? []).map((c) => {
      const option = itemById(c.menuItemId);
      if (!option) throw new Fail(400, 'VALIDATION_ERROR', { field: 'choices' });
      return { group: c.group, menuItemId: option.id, name: option.name };
    });
    if (choices.length > 0) line.choices = choices;
    return line;
  });
}

function tableView(state: DemoState, base: Table): Table {
  const session = state.sessions.find((s) => s.tableId === base.id);
  const orders = state.orders.filter((o) => o.table.id === base.id);
  return {
    ...base,
    state: session ? 'occupied' : 'free',
    openSessionId: session?.id ?? null,
    openTotal: session
      ? orders
          .filter((o) => o.tableSessionId === session.id && o.status === 'confirmed')
          .reduce((s, o) => s + o.total, 0)
      : 0,
    pendingOrders: orders.filter((o) => o.status === 'pending').length,
    principalId: session?.principalId ?? null,
  };
}

const tableById = (state: DemoState, id: number) => {
  const base = baseTables.find((t) => t.id === id);
  return base ? tableView(state, base) : undefined;
};

function stationView(order: Order, station: 'bar' | 'kitchen'): Order {
  return {
    ...order,
    lines: order.lines.filter((l) => l.station === station || l.station === 'both'),
  };
}

const hasLinesFor = (order: Order, station: 'bar' | 'kitchen') =>
  order.lines.some((l) => l.status === 'active' && (l.station === station || l.station === 'both'));

function announceConfirmed(state: DemoState, order: Order) {
  const table = tableById(state, order.table.id);
  publish('order:updated', order, { to: 'waiters' });
  if (table) publish('table:updated', table, { to: 'waiters' });
  for (const station of ['bar', 'kitchen'] as const) {
    if (hasLinesFor(order, station)) {
      publish('station:order', stationView(order, station), { to: 'station', station });
    }
  }
  // L'agent caisse « saisit » la commande un peu plus tard.
  setTimeout(() => {
    const later = loadState();
    const saved = later.orders.find((o) => o.id === order.id);
    if (!saved || saved.pos?.status !== 'queued') return;
    saved.pos = { status: 'entered', error: null };
    saveState(later);
    publish('order:updated', saved, { to: 'waiters' });
  }, 1500);
}

function openSession(state: DemoState, tableId: number, principalId: number | null) {
  let session = state.sessions.find((s) => s.tableId === tableId);
  if (!session) {
    session = { id: state.nextId++, tableId, openedAt: now(), principalId };
    state.sessions.push(session);
  }
  return session;
}

const principalId = (state: DemoState) => state.shifts.find((s) => s.principal)?.userId ?? null;

type Handler = (state: DemoState, req: DemoRequest, params: string[]) => DemoResponse;

const routes: [string, RegExp, Handler][] = [
  // --- Menu QR (sans connexion) ---
  [
    'GET',
    /^\/menu$/,
    (state, req) => ok(withAvailability(req.token ? menuStaff : menuCustomer, state)),
  ],
  [
    'GET',
    /^\/tables\/(demo-[0-9]+)$/,
    (_state, _req, [token]) => {
      const number = Number(token?.slice(5));
      const table = baseTables.find((t) => t.number === number && t.kind === 'real');
      if (!table) throw new Fail(404, 'TABLE_NOT_FOUND');
      return ok({ id: table.id, number: table.number });
    },
  ],
  [
    'POST',
    /^\/orders$/,
    (state, req) => {
      const body = req.body as { tableToken: string; lines: LineInput[] };
      const number = Number(String(body.tableToken).replace(/^demo-/, ''));
      const table = baseTables.find((t) => t.number === number && t.kind === 'real');
      if (!table) throw new Fail(404, 'TABLE_NOT_FOUND');
      if (
        !state.shifts.some((s) => state.users.find((u) => u.id === s.userId)?.role === 'waiter')
      ) {
        throw new Fail(409, 'NO_WAITER_ON_SHIFT');
      }
      const lines = buildLines(state, body.lines);
      const order: Order = {
        id: state.nextId++,
        table: { id: table.id, number: table.number },
        tableSessionId: null,
        source: 'qr',
        status: 'pending',
        lines,
        total: lines.reduce((s, l) => s + l.lineTotal, 0),
        createdAt: now(),
        confirmedAt: null,
        confirmedBy: null,
        offer: null,
        ready: { bar: null, kitchen: null },
        pos: null,
      };
      state.orders.push(order);
      publish('order:new', order, { to: 'waiters' });
      const view = tableById(state, table.id);
      if (view) publish('table:updated', view, { to: 'waiters' });
      return ok(
        {
          orderId: order.id,
          status: 'pending',
          total: order.total,
          expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        },
        201,
      );
    },
  ],
  [
    'GET',
    /^\/orders\/(\d+)$/,
    (state, _req, [id]) => {
      const order = state.orders.find((o) => o.id === Number(id));
      if (!order) throw new Fail(404, 'NOT_FOUND');
      return ok({ orderId: order.id, status: order.status });
    },
  ],

  // --- Connexion ---
  [
    'POST',
    /^\/auth\/login$/,
    (state, req) => {
      const { login, password } = req.body as { login: string; password: string };
      const user = state.users.find((u) => u.login === String(login).trim().toLowerCase());
      if (!user || password !== DEMO_PASSWORD) throw new Fail(401, 'UNAUTHORIZED');
      if (!user.active) throw new Fail(403, 'ACCOUNT_DISABLED');
      user.lastLoginAt = now();
      return ok({
        token: `demo-token-${String(user.id)}`,
        user: {
          id: user.id,
          name: user.name,
          role: user.role,
          title: user.title,
          mustChangePassword: false,
        },
      });
    },
  ],
  ['POST', /^\/auth\/logout$/, () => noContent],
  ['POST', /^\/auth\/change-password$/, () => noContent],
  [
    'GET',
    /^\/me$/,
    (state, req) => {
      const user = userOf(state, req.token);
      const shift = shiftOf(state, user);
      return ok({
        id: user.id,
        name: user.name,
        role: user.role,
        title: user.title,
        onShift: Boolean(shift),
        principal: Boolean(shift?.principal),
      });
    },
  ],
  ['POST', /^\/push\/subscribe$/, () => noContent],

  // --- Shifts ---
  [
    'GET',
    /^\/shifts\/current$/,
    (state, req) => {
      userOf(state, req.token);
      const people = state.shifts.map((s) => ({
        s,
        u: state.users.find((u) => u.id === s.userId),
      }));
      return ok({
        waiters: people
          .filter(({ u }) => u?.role === 'waiter')
          .map(({ s, u }) => ({
            id: s.userId,
            name: u?.name ?? '',
            startedAt: s.startedAt,
            principal: s.principal,
          })),
        stations: people
          .filter(({ u }) => u?.role === 'barista' || u?.role === 'chef')
          .map(({ s, u }) => ({
            id: s.userId,
            name: u?.name ?? '',
            role: u?.role,
            startedAt: s.startedAt,
          })),
      });
    },
  ],
  [
    'POST',
    /^\/shifts\/start$/,
    (state, req) => {
      const user = userOf(state, req.token);
      if (!['waiter', 'barista', 'chef'].includes(user.role)) throw new Fail(403, 'FORBIDDEN');
      let shift = shiftOf(state, user);
      if (!shift) {
        const principal = user.role === 'waiter' && !state.shifts.some((s) => s.principal);
        shift = { userId: user.id, startedAt: now(), principal };
        state.shifts.push(shift);
      }
      return ok({ shiftId: user.id, startedAt: shift.startedAt, principal: shift.principal });
    },
  ],
  [
    'POST',
    /^\/shifts\/end$/,
    (state, req) => {
      const user = userOf(state, req.token);
      state.shifts = state.shifts.filter((s) => s.userId !== user.id);
      return noContent;
    },
  ],

  // --- Plan des tables et commandes (serveur en shift) ---
  [
    'GET',
    /^\/tables$/,
    (state, req) => {
      requireOnShift(state, userOf(state, req.token), ['waiter']);
      return ok({
        tables: baseTables.filter((t) => t.kind === 'real').map((t) => tableView(state, t)),
      });
    },
  ],
  [
    'GET',
    /^\/tables\/(\d+)\/session$/,
    (state, req, [id]) => {
      requireOnShift(state, userOf(state, req.token), ['waiter']);
      const session = state.sessions.find((s) => s.tableId === Number(id));
      if (!session) throw new Fail(404, 'NOT_FOUND');
      const orders = state.orders.filter(
        (o) => o.tableSessionId === session.id && o.status === 'confirmed',
      );
      const principal = state.users.find((u) => u.id === session.principalId);
      return ok({
        session: {
          id: session.id,
          tableId: session.tableId,
          openedAt: session.openedAt,
          closedAt: null,
          status: 'open',
          total: orders.reduce((s, o) => s + o.total, 0),
          orderIds: orders.map((o) => o.id),
          principal: principal ? { id: principal.id, name: principal.name } : null,
        },
        orders,
        gifts: [],
      });
    },
  ],
  [
    'GET',
    /^\/orders$/,
    (state, req) => {
      requireOnShift(state, userOf(state, req.token), ['waiter']);
      const status = req.query.get('status') ?? 'pending';
      return ok({ items: state.orders.filter((o) => o.status === status), nextCursor: null });
    },
  ],
  [
    'POST',
    /^\/orders\/(\d+)\/(confirm|reject)$/,
    (state, req, [id, action]) => {
      const user = userOf(state, req.token);
      requireOnShift(state, user, ['waiter']);
      const order = state.orders.find((o) => o.id === Number(id));
      if (!order) throw new Fail(404, 'NOT_FOUND');
      if (order.status !== 'pending') throw new Fail(409, 'INVALID_STATUS');
      if (action === 'reject') {
        order.status = 'rejected';
        publish('order:updated', order, { to: 'waiters' });
        const view = tableById(state, order.table.id);
        if (view) publish('table:updated', view, { to: 'waiters' });
        return ok(order);
      }
      const soldOut = order.lines.find((l) => state.soldOut.includes(l.menuItemId));
      if (soldOut) throw new Fail(409, 'ITEM_UNAVAILABLE', { menuItemId: soldOut.menuItemId });
      const session = openSession(state, order.table.id, principalId(state));
      Object.assign(order, {
        status: 'confirmed',
        tableSessionId: session.id,
        confirmedAt: now(),
        confirmedBy: { id: user.id, name: user.name },
        pos: { status: 'queued', error: null },
      });
      announceConfirmed(state, order);
      return ok(order);
    },
  ],
  [
    'POST',
    /^\/staff-orders$/,
    (state, req) => {
      const user = userOf(state, req.token);
      requireOnShift(state, user, ['waiter']);
      const body = req.body as { tableId: number; lines: LineInput[] };
      const table = tableById(state, Number(body.tableId));
      if (!table || table.kind !== 'real') throw new Fail(404, 'NOT_FOUND');
      const lines = buildLines(state, body.lines);
      const session = openSession(state, table.id, principalId(state));
      const order: Order = {
        id: state.nextId++,
        table: { id: table.id, number: table.number },
        tableSessionId: session.id,
        source: 'waiter',
        status: 'confirmed',
        lines,
        total: lines.reduce((s, l) => s + l.lineTotal, 0),
        createdAt: now(),
        confirmedAt: now(),
        confirmedBy: { id: user.id, name: user.name },
        offer: null,
        ready: { bar: null, kitchen: null },
        pos: { status: 'queued', error: null },
      };
      state.orders.push(order);
      announceConfirmed(state, order);
      return ok(order, 201);
    },
  ],

  // --- Écran bar / cuisine ---
  [
    'GET',
    /^\/station-orders$/,
    (state, req) => {
      const user = userOf(state, req.token);
      requireOnShift(state, user, ['barista', 'chef']);
      const station = user.role === 'barista' ? 'bar' : 'kitchen';
      const items = state.orders
        .filter((o) => o.status === 'confirmed' && !o.ready[station] && hasLinesFor(o, station))
        .sort((a, b) => (a.confirmedAt ?? '').localeCompare(b.confirmedAt ?? ''))
        .map((o) => stationView(o, station));
      return ok({ items });
    },
  ],
  [
    'POST',
    /^\/orders\/(\d+)\/ready$/,
    (state, req, [id]) => {
      const user = userOf(state, req.token);
      requireOnShift(state, user, ['barista', 'chef']);
      const station = user.role === 'barista' ? 'bar' : 'kitchen';
      const order = state.orders.find((o) => o.id === Number(id));
      if (!order) throw new Fail(404, 'NOT_FOUND');
      if (order.status !== 'confirmed' || order.ready[station] || !hasLinesFor(order, station)) {
        throw new Fail(409, 'INVALID_STATUS');
      }
      order.ready[station] = { at: now(), by: { id: user.id, name: user.name } };
      const view = stationView(order, station);
      publish('station:updated', view, { to: 'station', station });
      publish('order:ready', { orderId: order.id, table: order.table, station }, { to: 'waiters' });
      return ok(view);
    },
  ],

  // --- Comptes (manager) ---
  [
    'GET',
    /^\/users$/,
    (state, req) => {
      if (userOf(state, req.token).role !== 'manager') throw new Fail(403, 'FORBIDDEN');
      return ok({ users: state.users.map(toUser) });
    },
  ],
  [
    'POST',
    /^\/users$/,
    (state, req) => {
      if (userOf(state, req.token).role !== 'manager') throw new Fail(403, 'FORBIDDEN');
      const body = req.body as {
        name: string;
        login: string;
        role: DemoUser['role'];
        title?: string;
      };
      const login = String(body.login).trim().toLowerCase();
      if (!login || state.users.some((u) => u.login === login)) {
        throw new Fail(400, 'VALIDATION_ERROR', { fields: { login: 'taken' } });
      }
      const user: DemoUser = {
        id: state.nextId++,
        name: String(body.name).trim(),
        login,
        role: body.role,
        title: body.title?.trim() ? body.title.trim() : null,
        active: true,
        createdAt: now(),
        lastLoginAt: null,
      };
      state.users.push(user);
      return ok({ user: toUser(user), temporaryPassword: DEMO_PASSWORD }, 201);
    },
  ],
  [
    'PATCH',
    /^\/users\/(\d+)$/,
    (state, req, [id]) => {
      const me = userOf(state, req.token);
      if (me.role !== 'manager') throw new Fail(403, 'FORBIDDEN');
      const user = state.users.find((u) => u.id === Number(id));
      if (!user) throw new Fail(404, 'NOT_FOUND');
      const body = req.body as { role?: DemoUser['role']; title?: string | null; active?: boolean };
      if (user.id === me.id && (body.active === false || (body.role && body.role !== 'manager'))) {
        throw new Fail(409, 'INVALID_STATUS');
      }
      if (body.role) user.role = body.role;
      if (body.title !== undefined) user.title = body.title?.trim() ? body.title.trim() : null;
      if (body.active !== undefined) user.active = body.active;
      return ok(toUser(user));
    },
  ],
  [
    'POST',
    /^\/users\/(\d+)\/reset-password$/,
    (state, req, [id]) => {
      if (userOf(state, req.token).role !== 'manager') throw new Fail(403, 'FORBIDDEN');
      const user = state.users.find((u) => u.id === Number(id));
      if (!user) throw new Fail(404, 'NOT_FOUND');
      return ok({ user: toUser(user), temporaryPassword: DEMO_PASSWORD });
    },
  ],
];

/** Traite une requête de l'app comme le ferait le serveur. */
export function handle(req: DemoRequest): DemoResponse {
  const state = loadState();
  for (const [method, pattern, handler] of routes) {
    if (method !== req.method) continue;
    const match = pattern.exec(req.path);
    if (!match) continue;
    try {
      const res = handler(state, req, match.slice(1));
      if (req.method !== 'GET') saveState(state);
      return res;
    } catch (err) {
      if (err instanceof Fail) {
        return {
          status: err.status,
          body: { error: { code: err.code, message: err.code, details: err.details } },
        };
      }
      throw err;
    }
  }
  return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not in the demo' } } };
}

export { tableNumberOf };
