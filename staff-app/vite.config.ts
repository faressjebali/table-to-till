import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// En développement, l'API vient du serveur (server/, port 3000), via Vite pour que le téléphone
// passe aussi par le Wi-Fi. Port 5174 : le menu QR (customer-web) est sur 5173.
const SERVER = 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
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
});
