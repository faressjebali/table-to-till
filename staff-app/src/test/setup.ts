import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { sockets } from './fakeSocket';

// Temps réel simulé partout : voir fakeSocket.ts.
vi.mock('socket.io-client', () => import('./fakeSocket'));

afterEach(() => {
  cleanup();
  sockets.length = 0;
});
