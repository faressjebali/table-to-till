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

const render = () =>
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

// Démo (`--mode demo`) : faux serveur dans le navigateur, données fictives (demo/README.md).
// Hors démo, ce bloc disparaît du build.
if (import.meta.env.VITE_DEMO === '1') {
  void import('../../demo/backend/install').then(({ installDemo }) => {
    installDemo('staff', import.meta.env.BASE_URL.replace(/staff\/$/, 'menu/'));
    render();
  });
} else {
  render();
}

// Service worker : installation de l'app, puis notifications push. Seulement dans la version
// construite : en développement, il resterait dans le navigateur avec une ancienne version.
if (import.meta.env.PROD && import.meta.env.VITE_DEMO !== '1' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // Chemin de l'app (`/`, ou `/staff/` sur un hébergement) : le service worker ne gère que
    // l'app staff, jamais le menu QR ni l'API.
    const base = import.meta.env.BASE_URL;
    navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => {
      // Sans service worker (navigateur ancien, http sur le Wi-Fi) : l'app marche, sans installation.
    });
  });
}
