import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// En développement, l'API et les photos viennent du serveur (server/, port 3000) :
// le téléphone passe par Vite (npm run dev --host), même sur le Wi-Fi.
const SERVER = 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': SERVER, '/uploads': SERVER },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
