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
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Sans service worker (navigateur ancien, http sur le Wi-Fi) : l'app marche, sans installation.
    });
  });
}
