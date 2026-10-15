import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Les fichiers de test partagent la même base : un fichier à la fois.
    fileParallelism: false,
  },
});
