import '@fontsource/architects-daughter/latin-400.css';
import './styles/tokens.css';
import './styles/global.css';
import './styles/app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { LanguageProvider } from './i18n/LanguageProvider';

const root = document.getElementById('root');
if (!root) throw new Error('#root introuvable dans index.html');

const render = () =>
  createRoot(root).render(
    <StrictMode>
      <LanguageProvider>
        <App />
      </LanguageProvider>
    </StrictMode>,
  );

// Démo (`--mode demo`) : faux serveur dans le navigateur, données fictives (demo/README.md).
// Hors démo, ce bloc disparaît du build.
if (import.meta.env.VITE_DEMO === '1') {
  void import('../../demo/backend/install').then(({ installDemo }) => {
    installDemo('customer', import.meta.env.BASE_URL.replace(/menu\/$/, 'staff/'));
    render();
  });
} else {
  render();
}
