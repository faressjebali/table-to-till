import './styles/tokens.css';
import './styles/global.css';
import './styles/app.css';
import './styles/components.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { unlockSoundOnFirstTouch } from './sound';
import { applyTheme, loadTheme } from './theme';

const root = document.getElementById('root');
if (!root) throw new Error('#root introuvable dans index.html');

applyTheme(loadTheme());
unlockSoundOnFirstTouch();

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Service worker : installation de l'app, puis notifications push. Seulement dans la version
// construite : en développement, il resterait dans le navigateur avec une ancienne version.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // Chemin de l'app (`/`, ou `/staff/` sur un hébergement) : le service worker ne gère que
    // l'app staff, jamais le menu QR ni l'API.
    const base = import.meta.env.BASE_URL;
    navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => {
      // Sans service worker (navigateur ancien, http sur le Wi-Fi) : l'app marche, sans installation.
    });
  });
}
