import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// En développement, l'API et les photos viennent du serveur (server/, port 3000) :
// le téléphone passe par Vite (npm run dev --host), même sur le Wi-Fi.
// /socket.io : temps réel (docs/api.md § 8).
const SERVER = 'http://localhost:3000';

// Démo (`vite --mode demo`, demo/README.md) : le faux temps réel remplace socket.io-client et
// aucune clé de notification n'est lue.
// Chemin d'un fichier à côté de cette config (sans les types de Node), sous Windows aussi.
const local = (path: string) =>
  decodeURIComponent(new URL(path, import.meta.url).pathname).replace(/^\/(?=[A-Za-z]:)/, '');
const demo = (mode: string) =>
  mode === 'demo'
    ? {
        resolve: {
          alias: { 'socket.io-client': local('../demo/backend/bus.ts') },
        },
        define: {
          'import.meta.env.VITE_DEMO': JSON.stringify('1'),
          'import.meta.env.VITE_VAPID_PUBLIC_KEY': JSON.stringify(''),
        },
      }
    : {};

export default defineConfig(({ mode }) => ({
  ...demo(mode),
  plugins: [react()],
  server: {
    proxy: {
      '/api': SERVER,
      '/uploads': SERVER,
      '/socket.io': { target: SERVER, ws: true },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
}));
