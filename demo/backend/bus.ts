// Faux temps réel : remplace socket.io-client dans la démo (alias Vite). Les événements passent
// entre les onglets du même site par BroadcastChannel ; chaque faux socket ne reçoit que ce que
// le vrai serveur lui enverrait (serveurs en shift, bar, cuisine, clients d'une table…).
import { loadState } from './state';

export type Audience =
  | { to: 'waiters' }
  | { to: 'station'; station: 'bar' | 'kitchen' }
  | { to: 'staff' }
  | { to: 'clients' };

type Listener = (data: unknown) => void;
type Message = { event: string; data: unknown; audience: Audience };

const sockets = new Set<FakeSocket>();
let channel: BroadcastChannel | null = null;
try {
  channel = new BroadcastChannel('cafe-olivine-demo');
  channel.onmessage = (e: MessageEvent<Message>) => {
    deliver(e.data);
  };
} catch {
  // Navigateur sans BroadcastChannel : le temps réel reste dans l'onglet.
}

const userIdOf = (token: string | undefined) => {
  const match = /^demo-token-(\d+)$/.exec(token ?? '');
  return match ? Number(match[1]) : null;
};

function receives(socket: FakeSocket, audience: Audience): boolean {
  if (audience.to === 'clients') return socket.kind === 'customer';
  if (socket.kind !== 'staff') return false;
  const state = loadState();
  const user = state.users.find((u) => u.id === userIdOf(socket.token));
  if (!user) return false;
  if (audience.to === 'staff') return true;
  const onShift = state.shifts.some((s) => s.userId === user.id);
  if (!onShift) return false;
  if (audience.to === 'waiters') return user.role === 'waiter';
  return (audience.station === 'bar' ? 'barista' : 'chef') === user.role;
}

function deliver(message: Message) {
  for (const socket of sockets) {
    if (socket.connected && receives(socket, message.audience)) {
      socket.dispatch(message.event, message.data);
    }
  }
}

/** Envoie un événement aux faux sockets de cet onglet et des autres onglets de la démo. */
export function publish(event: string, data: unknown, audience: Audience) {
  const message = { event, data, audience };
  deliver(message);
  channel?.postMessage(message);
}

class FakeSocket {
  connected = false;
  readonly kind: 'customer' | 'staff';
  readonly token: string | undefined;
  private listeners = new Map<string, Set<Listener>>();

  constructor(opts: { autoConnect?: boolean; auth?: { token?: string; tableToken?: string } }) {
    this.kind = opts.auth?.tableToken ? 'customer' : 'staff';
    this.token = opts.auth?.token;
    if (opts.autoConnect !== false) this.connect();
  }

  connect() {
    if (this.connected) return this;
    this.connected = true;
    sockets.add(this);
    setTimeout(() => {
      this.dispatch('connect', undefined);
    }, 0);
    return this;
  }

  disconnect() {
    this.connected = false;
    sockets.delete(this);
    return this;
  }

  on(event: string, listener: Listener) {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
    return this;
  }

  off(event: string, listener?: Listener) {
    if (listener) this.listeners.get(event)?.delete(listener);
    else this.listeners.delete(event);
    return this;
  }

  emit() {
    return this;
  }

  dispatch(event: string, data: unknown) {
    for (const listener of this.listeners.get(event) ?? []) listener(data);
  }
}

export function io(opts: ConstructorParameters<typeof FakeSocket>[0] = {}) {
  return new FakeSocket(opts);
}

export type { FakeSocket as Socket };
