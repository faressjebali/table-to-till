// Service worker de l'app staff : rend l'app installable et affiche les notifications push.
// Il ne met rien en cache : le staff doit toujours voir l'état réel des commandes et des tables.

self.addEventListener('install', () => {
  // Nouvelle version active tout de suite, sans attendre la fermeture de l'app.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Message du serveur : { type, tag, title, body, url }. Toujours affiché (iPhone coupe les
// notifications d'une app qui reçoit un push sans rien montrer). Le tag remplace la notification
// du même événement au lieu d'en empiler une seconde.
self.addEventListener('push', (event) => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch {
    // Contenu illisible : notification générique.
  }
  const title = message.title || 'Olivine Staff';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: message.body || '',
      tag: message.tag,
      icon: '/icons/icon-192.png',
      data: { url: message.url || '/' },
    }),
  );
});

// Toucher la notification : ouvre l'app à son adresse (ex. `/?order=154`, la commande dans
// l'onglet Commandes). App déjà ouverte : elle revient au premier plan et reçoit l'adresse par un
// message, sans recharger la page (src/components/StaffShell.tsx).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => client.url.startsWith(self.location.origin));
      if (!open) return self.clients.openWindow(url);
      open.postMessage({ type: 'open', url });
      return open.focus();
    }),
  );
});
