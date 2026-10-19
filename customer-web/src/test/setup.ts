import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { FakeSocket, sockets } from './fake-socket';

// Aucun test ne se connecte au vrai serveur temps réel.
vi.mock('../realtime', () => ({
  connectTable: (tableToken: string) => {
    const socket = new FakeSocket(tableToken);
    sockets.push(socket);
    return socket;
  },
}));

afterEach(() => {
  cleanup();
  localStorage.clear();
  sockets.length = 0;
});
