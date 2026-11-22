import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

// En développement, l'API vient du serveur (server/, port 3000), via Vite pour que le téléphone
// passe aussi par le Wi-Fi. Port 5174 : le menu QR (customer-web) est sur 5173.
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
  // Chemin de l'app : `/` par défaut ; STAFF_BASE_PATH (ex. `/staff/`) quand le serveur sert les
  // deux apps à la même adresse (SERVE_WEB). Lu dans le .env de la racine ou l'environnement.
  base: loadEnv(mode, '..', '').STAFF_BASE_PATH || '/',
  // Le .env de la racine, comme le serveur : VITE_VAPID_PUBLIC_KEY à côté de la paire VAPID.
  // Vite n'expose à l'app que les variables VITE_*.
  envDir: '..',
  server: {
    port: 5174,
    // Tunnel HTTPS pour tester sur un vrai téléphone (cloudflared). `preview`
    // reprend ce réglage et le proxy ci-dessous.
    allowedHosts: ['.trycloudflare.com'],
    // /socket.io : temps réel (docs/api.md § 8).
    proxy: {
      '/api': SERVER,
      '/uploads': SERVER,
      '/socket.io': { target: SERVER, ws: true },
    },
  },
  preview: { port: 5174 },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
}));
