import { afterEach } from 'vitest';
import { settleBackground } from '../../src/background.js';

// Après chaque test, attendre les notifications push encore en cours avant le TRUNCATE du test
// suivant : sinon leurs lectures et le TRUNCATE se bloquent mutuellement (deadlock).
afterEach(async () => {
  await settleBackground();
});
