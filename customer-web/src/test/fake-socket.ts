import type { MenuUpdate } from '../menu-view';

// Faux Socket.IO pour les tests : aucune connexion réseau, le test joue le serveur.
type Handler = (data?: unknown) => void;

export class FakeSocket {
  readonly handlers = new Map<string, Handler[]>();
  disconnected = false;

  constructor(readonly tableToken: string) {}

  on(event: string, handler: Handler) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    return this;
  }

  disconnect() {
    this.disconnected = true;
    return this;
  }

  /** Le serveur envoie un événement à ce téléphone. */
  receive(event: 'connect'): void;
  receive(event: 'menu:updated', data: MenuUpdate): void;
  receive(event: string, data?: unknown) {
    for (const handler of this.handlers.get(event) ?? []) handler(data);
  }
}

export const sockets: FakeSocket[] = [];

export function lastSocket(): FakeSocket {
  const socket = sockets.at(-1);
  if (!socket) throw new Error('aucune connexion temps réel');
  return socket;
}
