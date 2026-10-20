import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TableTile } from './components/TableTile';
import { ThemeChoice } from './components/ThemeChoice';
import { fr } from './i18n/fr';
import { applyTheme, loadTheme, saveTheme } from './theme';

const KEY = 'coffee-qr.staff.theme';

function addThemeMetas() {
  for (const scheme of ['light', 'dark']) {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.media = `(prefers-color-scheme: ${scheme})`;
    document.head.append(meta);
  }
}

const metaColors = () =>
  [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map((m) => m.content);

describe('thème', () => {
  beforeEach(() => {
    addThemeMetas();
  });
  afterEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    document.head.innerHTML = '';
  });

  it('suit le téléphone par défaut', () => {
    expect(loadTheme()).toBe('auto');
    applyTheme(loadTheme());
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(metaColors()).toEqual(['#fbf7ee', '#1c1b16']);
  });

  it('Sombre imposé : mémorisé, appliqué, barre d’état sombre dans les deux cas', () => {
    saveTheme('dark');
    expect(localStorage.getItem(KEY)).toBe('dark');
    expect(loadTheme()).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(metaColors()).toEqual(['#1c1b16', '#1c1b16']);
  });

  it('retour à Auto : plus rien de mémorisé', () => {
    saveTheme('light');
    saveTheme('auto');
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('valeur inconnue dans le stockage : Auto', () => {
    localStorage.setItem(KEY, 'violet');
    expect(loadTheme()).toBe('auto');
  });

  it('« Moi » : Auto, Clair, Sombre ; le choix est appliqué', async () => {
    render(<ThemeChoice />);
    expect(screen.getByRole('radio', { name: fr['theme.auto'] })).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: fr['theme.light'] }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem(KEY)).toBe('light');
    expect(screen.queryByText(fr['theme.autoHint'])).not.toBeInTheDocument();
  });

  it('tokens.css : les deux blocs du thème sombre sont identiques', () => {
    // Lu sur le disque : Vitest ne charge pas le contenu des fichiers CSS.
    const css = readFileSync('src/styles/tokens.css', 'utf8');
    const block = (selector: string) => {
      const start = css.indexOf(`${selector} {`);
      expect(start).toBeGreaterThan(-1);
      const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
      return body.replace(/\s+/g, ' ').trim();
    };
    expect(block(":root:not([data-theme='light'])")).toBe(block(":root[data-theme='dark']"));
  });
});

describe('carte de table', () => {
  it('un seul bouton, nommé par sa phrase complète ; l’état n’est pas que dans la couleur', () => {
    render(
      <TableTile
        number={14}
        amount="41,5"
        failed
        pending={1}
        ready={['bar']}
        label="Table 14, occupée, 31 DT, échec caisse"
      />,
    );
    const tile = screen.getByRole('button', { name: 'Table 14, occupée, 31 DT, échec caisse' });
    expect(tile).toHaveClass('table-tile--occupied', 'table-tile--failed');
    // Échec caisse prioritaire : pas de bord « à confirmer » ni de pastille chiffrée par-dessus.
    expect(tile).not.toHaveClass('table-tile--pending');
    expect(tile.querySelector('.table-tile__badge--failed svg')).not.toBeNull();
    expect(tile).toHaveClass('table-tile--ready');
    expect(tile.querySelectorAll('.table-tile__ready svg')).toHaveLength(1);
  });

  it('bar et cuisine prêts : une seule bande, deux icônes', () => {
    render(<TableTile number={3} amount="16" ready={['bar', 'kitchen']} label="Table 3" />);
    const bands = screen
      .getByRole('button', { name: 'Table 3' })
      .querySelectorAll('.table-tile__ready');
    expect(bands).toHaveLength(1);
    expect(bands[0]?.querySelectorAll('svg')).toHaveLength(2);
  });

  it('libre : ni montant ni pastille', () => {
    render(<TableTile number={21} label="Table 21, libre" />);
    const tile = screen.getByRole('button', { name: 'Table 21, libre' });
    expect(tile.className).toBe('table-tile');
    expect(tile.querySelector('.table-tile__amount')).toBeNull();
  });
});
