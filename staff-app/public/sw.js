// Service worker de l'app staff : rend l'app installable et recevra les notifications push.
// Il ne met rien en cache : le staff doit toujours voir l'état réel des commandes et des tables.

self.addEventListener('install', () => {
  // Nouvelle version active tout de suite, sans attendre la fermeture de l'app.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
