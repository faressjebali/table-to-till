import { timingSafeEqual } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { findSession } from './auth/sessions.js';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { errorBody } from './errors.js';
import type { Order } from './orders/view.js';
import { isOnShift, isShiftRole, SHIFT_ROLES, type ShiftRole } from './shifts/on-shift.js';
import type { Table } from './tables/view.js';

// Événements temps réel de docs/api.md § 8. Après reconnexion, chaque client recharge via REST :
// le serveur ne garde rien en mémoire pour lui.

export type MenuUpdate = {
  menuItemId: number;
  available: boolean;
  unavailableReason: string | null;
};
export type RevokeReason = 'ACCOUNT_DISABLED' | 'LOGGED_OUT';

export type Realtime = {
  orderNew(order: Order): void;
  orderUpdated(order: Order): void;
  tableUpdated(table: Table): void;
  // Le staff et les clients ne calculent pas la disponibilité de la même façon (café fermé).
  menuUpdated(update: { staff: MenuUpdate; customer: MenuUpdate }): void;
  principalChanged(data: {
    principals: { id: number; name: string; currentPrincipal: boolean }[];
  }): void;
  posJob(jobId: number): void;
  posFailed(data: { jobId: number; orderId: number | null; error: string }): void;
  posWaiting(data: { jobId: number; tableNumber: number; orderLineId: number }): void;
  posStatus(data: { state: string; lastSeenAt: Date | null }): void;
  reportUpdated(): void;
  // Ce téléphone seulement (déconnexion) : session:revoked puis connexions coupées.
  sessionRevoked(sessionId: number, reason: RevokeReason): void;
  // Tous les téléphones du compte : session:revoked (désactivation) ou sans événement
  // (mot de passe réinitialisé, ; rôle changé : la reconnexion donne les nouvelles rooms).
  disconnectUser(userId: number, reason?: RevokeReason): void;
  // Autres sessions coupées par un changement de mot de passe : sans événement.
  disconnectOtherSessions(userId: number, keepSessionId: number): void;
  // Shift démarré ou terminé : abonné ou désabonné sans se reconnecter.
  shiftStarted(userId: number, role: ShiftRole): void;
  shiftEnded(userId: number): void;
  close(): Promise<void>;
};

// Pour createApp sans serveur temps réel (tests REST).
export const noopRealtime: Realtime = {
  orderNew: () => undefined,
  orderUpdated: () => undefined,
  tableUpdated: () => undefined,
  menuUpdated: () => undefined,
  principalChanged: () => undefined,
  posJob: () => undefined,
  posFailed: () => undefined,
  posWaiting: () => undefined,
  posStatus: () => undefined,
  reportUpdated: () => undefined,
  sessionRevoked: () => undefined,
  disconnectUser: () => undefined,
  disconnectOtherSessions: () => undefined,
  shiftStarted: () => undefined,
  shiftEnded: () => undefined,
  close: () => Promise.resolve(),
};

const room = {
  staff: 'staff',
  clients: 'clients',
  agent: 'agent',
  // Staff en shift, par rôle : serveurs, baristas, cuisiniers.
  onShift: (role: ShiftRole) => `on-shift:${role}`,
  waitersOnShift: 'on-shift:waiter',
  role: (role: string) => `role:${role}`,
  user: (id: number) => `user:${String(id)}`,
  session: (id: number) => `session:${String(id)}`,
  table: (id: number) => `table:${String(id)}`,
};

type SocketData =
  | { kind: 'client'; tableId: number }
  | { kind: 'staff'; userId: number; sessionId: number }
  | { kind: 'agent' };

// Refus de connexion : connect_error avec message = code du contrat (docs/api.md § Erreurs)
// et data = corps d'erreur habituel.
function refuse(code: string, message: string): Error {
  return Object.assign(new Error(code), { data: errorBody(code, message) });
}

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function authenticate(
  db: Db,
  config: Config,
  auth: Record<string, unknown>,
): Promise<{ data: SocketData; rooms: string[] }> {
  const { tableToken, token, agentKey } = auth;

  if (typeof token === 'string' && token !== '') {
    const found = await findSession(db, token, config.sessionDays);
    if (found.status === 'invalid') throw refuse('UNAUTHORIZED', 'Invalid token');
    if (found.status === 'disabled') throw refuse('ACCOUNT_DISABLED', 'Account disabled');
    const { user, sessionId } = found.auth;
    if (user.mustChangePassword) {
      throw refuse('PASSWORD_CHANGE_REQUIRED', 'Password change required');
    }
    const rooms = [room.staff, room.role(user.role), room.user(user.id), room.session(sessionId)];
    if (isShiftRole(user.role) && (await isOnShift(db, user.id))) {
      rooms.push(room.onShift(user.role));
    }
    return { data: { kind: 'staff', userId: user.id, sessionId }, rooms };
  }

  if (typeof tableToken === 'string' && tableToken !== '') {
    const { rows } = await db.query<{ id: number }>(
      `SELECT id FROM tables WHERE qr_token = $1 AND kind = 'real'`,
      [tableToken],
    );
    const table = rows[0];
    if (!table) throw refuse('TABLE_NOT_FOUND', 'Unknown table');
    return {
      data: { kind: 'client', tableId: table.id },
      rooms: [room.clients, room.table(table.id)],
    };
  }

  if (typeof agentKey === 'string' && agentKey !== '') {
    // Pas de clé configurée : aucun agent accepté.
    if (config.agentKey === '' || !sameSecret(agentKey, config.agentKey)) {
      throw refuse('UNAUTHORIZED', 'Invalid agent key');
    }
    return { data: { kind: 'agent' }, rooms: [room.agent] };
  }

  throw refuse('UNAUTHORIZED', 'Missing credentials');
}

export function createRealtime(
  httpServer: HttpServer,
  { db, config }: { db: Db; config: Config },
): Realtime {
  const io = new Server(httpServer, { serveClient: false });

  io.use((socket: Socket, next) => {
    authenticate(db, config, socket.handshake.auth)
      .then(async ({ data, rooms }) => {
        socket.data = data;
        await socket.join(rooms);
        next();
      })
      .catch((err: unknown) => {
        if (err instanceof Error && 'data' in err) {
          next(err);
          return;
        }
        console.error('connexion temps réel :', err);
        next(refuse('INTERNAL_ERROR', 'Internal error'));
      });
  });

  return {
    orderNew(order) {
      io.to(room.waitersOnShift).emit('order:new', order);
    },
    orderUpdated(order) {
      io.to(room.waitersOnShift).emit('order:updated', order);
      // La table qui a commandé ne reçoit que l'état (commandes QR).
      // TODO : la personne qui a commandé une commande offerte depuis l'app.
      if (order.source === 'qr') {
        io.to(room.table(order.table.id)).emit('order:updated', {
          orderId: order.id,
          status: order.status,
        });
      }
    },
    tableUpdated(table) {
      io.to(room.waitersOnShift).emit('table:updated', table);
    },
    menuUpdated({ staff, customer }) {
      io.to(room.staff).emit('menu:updated', staff);
      io.to(room.clients).emit('menu:updated', customer);
    },
    principalChanged(data) {
      io.to([room.waitersOnShift, room.onShift('barista')]).emit('principal:changed', data);
    },
    posJob(jobId) {
      io.to(room.agent).emit('pos:job', { jobId });
    },
    posFailed(data) {
      io.to(room.waitersOnShift).emit('pos:failed', data);
    },
    posWaiting(data) {
      io.to(room.waitersOnShift).emit('pos:waiting', data);
    },
    posStatus(data) {
      io.to([room.role('manager'), room.waitersOnShift]).emit('pos:status', data);
    },
    reportUpdated() {
      // Le comptable aussi quand son rôle existera.
      io.to(room.role('manager')).emit('report:updated', {});
    },
    sessionRevoked(sessionId, reason) {
      io.to(room.session(sessionId)).emit('session:revoked', { reason });
      io.in(room.session(sessionId)).disconnectSockets(true);
    },
    disconnectUser(userId, reason) {
      if (reason) io.to(room.user(userId)).emit('session:revoked', { reason });
      io.in(room.user(userId)).disconnectSockets(true);
    },
    disconnectOtherSessions(userId, keepSessionId) {
      io.in(room.user(userId)).except(room.session(keepSessionId)).disconnectSockets(true);
    },
    shiftStarted(userId, role) {
      io.in(room.user(userId)).socketsJoin(room.onShift(role));
    },
    shiftEnded(userId) {
      io.in(room.user(userId)).socketsLeave(SHIFT_ROLES.map(room.onShift));
    },
    close() {
      return new Promise((resolve) => {
        void io.close(() => {
          resolve();
        });
      });
    },
  };
}
