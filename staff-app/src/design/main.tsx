import '../styles/tokens.css';
import '../styles/global.css';
import '../styles/app.css';
import '../styles/components.css';
import './gallery.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { applyTheme, loadTheme } from '../theme';
import { Gallery } from './Gallery';

// Galerie du système de design (design.html), en développement seulement.
const root = document.getElementById('root');
if (!root) throw new Error('#root introuvable dans design.html');

applyTheme(loadTheme());

createRoot(root).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
