// Faux socket.io-client pour les tests (branché dans setup.ts) : rien ne part sur le réseau, le
// test joue le serveur avec `serverEmit`.
type Listener = (...args: unknown[]) => void;

export class FakeSocket {
  connected = false;
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(readonly options: { auth?: unknown }) {}

  on(event: string, listener: Listener) {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener);
    this.listeners.set(event, set);
    return this;
  }

  off(event: string, listener: Listener) {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  connect() {
    this.connected = true;
    return this;
  }

  disconnect() {
    this.connected = false;
    return this;
  }

  fire(event: string, ...args: unknown[]) {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }
}

export const sockets: FakeSocket[] = [];

export function io(options: { auth?: unknown }) {
  const socket = new FakeSocket(options);
  sockets.push(socket);
  return socket;
}

/** Le serveur envoie un événement sur la connexion ouverte (`connect` : (re)connexion). */
export function serverEmit(event: string, ...args: unknown[]) {
  const socket = [...sockets].reverse().find((s) => s.connected);
  if (!socket) throw new Error('aucune connexion temps réel ouverte');
  socket.fire(event, ...args);
}
