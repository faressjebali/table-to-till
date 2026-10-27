import { defineConfig } from 'vitest/config';

// Processus Node en UTC, comme chez un hébergeur : les horaires doivent être calculés en
// Africa/Tunis par le code, jamais d'après le fuseau de la machine. Hérité par les workers.
process.env.TZ = 'UTC';

export default defineConfig({
  test: {
    // Les fichiers de test partagent la même base : un fichier à la fois.
    fileParallelism: false,
    // Attendre le travail en arrière-plan entre deux tests.
    setupFiles: ['./test/helpers/setup.ts'],
  },
});
