import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MenuResponse } from './api/types';
import { App } from './App';
import { formatPrice } from './format';
import { en } from './i18n/en';
import { fr } from './i18n/fr';
import { LanguageProvider } from './i18n/LanguageProvider';
import { mockMenu } from './mocks/menu';
import { tableTokenFromPath } from './table-link';

type Reply = { status: number; body: unknown } | 'network-error';

// Faux serveur : une réponse par chemin d'API.
function mockApi(routes: Record<string, Reply>) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const path = String(input);
    const reply = routes[path];
    if (reply === undefined) throw new Error(`appel inattendu : ${path}`);
    if (reply === 'network-error') return Promise.reject(new TypeError('Failed to fetch'));
    return Promise.resolve(
      new Response(JSON.stringify(reply.body), {
        status: reply.status,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const table7: Reply = { status: 200, body: { id: 3, number: 7 } };
const menuReply = (menu: MenuResponse = mockMenu): Reply => ({ status: 200, body: menu });

function renderAt(path: string) {
  window.history.pushState({}, '', path);
  return render(
    <LanguageProvider>
      <App />
    </LanguageProvider>,
  );
}

function mockBrowserLanguage(language: string) {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue([language]);
}

beforeEach(() => {
  mockBrowserLanguage('fr-FR');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('lien du QR', () => {
  it('lit le jeton de /t/<jeton>', () => {
    expect(tableTokenFromPath('/t/k3J9x')).toBe('k3J9x');
    expect(tableTokenFromPath('/t/k3J9x/')).toBe('k3J9x');
    expect(tableTokenFromPath('/')).toBeNull();
    expect(tableTokenFromPath('/t/')).toBeNull();
    expect(tableTokenFromPath('/t/a/b')).toBeNull();
  });

  it('affiche le numéro de la table et la carte', async () => {
    const fetchMock = mockApi({ '/api/tables/k3J9x': table7, '/api/menu': menuReply() });
    renderAt('/t/k3J9x');

    expect(screen.getByRole('status')).toHaveTextContent(fr['menu.loading']);
    expect(await screen.findByText('Table 7')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(fr['menu.title']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('jeton inconnu : « demandez au serveur », sans carte', async () => {
    mockApi({
      '/api/tables/faux': {
        status: 404,
        body: { error: { code: 'TABLE_NOT_FOUND', message: 'Unknown table' } },
      },
      '/api/menu': menuReply(),
    });
    renderAt('/t/faux');

    expect(await screen.findByText(fr['table.unknown.body'])).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
  });

  it('sans jeton : même message, sans appeler le serveur', () => {
    const fetchMock = mockApi({});
    renderAt('/');
    expect(screen.getByText(fr['table.unknown.body'])).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('erreur réseau : message et « Réessayer » qui recharge', async () => {
    const routes: Record<string, Reply> = {
      '/api/tables/k3J9x': 'network-error',
      '/api/menu': menuReply(),
    };
    mockApi(routes);
    renderAt('/t/k3J9x');

    expect(await screen.findByRole('alert')).toHaveTextContent(fr['error.body']);
    routes['/api/tables/k3J9x'] = table7;
    await userEvent.click(screen.getByRole('button', { name: fr['error.retry'] }));
    expect(await screen.findByText('Table 7')).toBeInTheDocument();
  });
});

describe('carte', () => {
  async function renderMenu(menu: MenuResponse = mockMenu) {
    mockApi({ '/api/tables/k3J9x': table7, '/api/menu': menuReply(menu) });
    renderAt('/t/k3J9x');
    await screen.findByText('Table 7');
  }

  it('montre les catégories dans l’ordre du menu papier, avec la barre de navigation', async () => {
    await renderMenu();
    const titles = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(titles).toEqual(['Formules petit-déjeuner', 'Extras', 'Œufs', 'Cafés']);

    const nav = screen.getByRole('navigation', { name: fr['menu.categories'] });
    const links = within(nav).getAllByRole('link');
    expect(links.map((a) => a.textContent)).toEqual(titles);
    expect(links[1]).toHaveAttribute('href', '#categorie-2');
    expect(document.getElementById('categorie-2')).toHaveTextContent('Extras');
  });

  it('affiche nom, description et prix de chaque article', async () => {
    await renderMenu();
    const espresso = screen.getByRole('heading', { name: 'Espresso premium' }).closest('li');
    expect(espresso).toHaveTextContent('7 DT');
    expect(
      screen.getByText('Café ou thé, pain toasté, confiture, miel, Eau 0,5L'),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Épinards' }).closest('li')).toHaveTextContent(
      '6 DT',
    );
  });

  it('grise un article en rupture, masque un article hors horaire et une catégorie vide', async () => {
    const [breakfast, extras, eggs, coffees] = mockMenu.categories;
    if (!breakfast || !extras || !eggs || !coffees) throw new Error('menu factice incomplet');
    const outside = { available: false, unavailableReason: 'outside_hours' as const };
    await renderMenu({
      ...mockMenu,
      categories: [
        // Toutes les formules hors horaire (après 12h) : la catégorie disparaît.
        { ...breakfast, items: breakfast.items.map((i) => ({ ...i, ...outside })) },
        extras,
        { ...eggs, items: eggs.items.map((i, n) => (n === 0 ? { ...i, ...outside } : i)) },
        coffees,
      ],
    });

    expect(screen.queryByRole('heading', { name: 'Formules petit-déjeuner' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Formules petit-déjeuner' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Omelette nature' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Œufs brouillés' })).toBeInTheDocument();

    const avocado = screen.getByRole('heading', { name: 'Avocat' }).closest('li');
    expect(avocado).toHaveClass('item--sold-out');
    expect(avocado).toHaveTextContent(fr['menu.soldOut']);
  });

  it('montre la photo en chargement différé, rien sans photo', async () => {
    const [first, ...rest] = mockMenu.categories;
    if (!first) throw new Error('menu factice incomplet');
    await renderMenu({
      ...mockMenu,
      categories: [
        {
          ...first,
          items: first.items.map((i, n) =>
            n === 0 ? { ...i, photoUrl: '/uploads/soft-morning-800.webp' } : i,
          ),
        },
        ...rest,
      ],
    });
    const photos = document.querySelectorAll('img');
    expect(photos).toHaveLength(1);
    expect(photos[0]).toHaveAttribute('src', '/uploads/soft-morning-800.webp');
    expect(photos[0]).toHaveAttribute('loading', 'lazy');
  });

  it('passe toute la carte en anglais', async () => {
    await renderMenu();
    await userEvent.click(screen.getByRole('button', { name: 'English' }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(en['menu.title']);
    expect(screen.getByRole('heading', { name: 'Coffees' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Spinach' }).closest('li')).toHaveTextContent(
      '6 DT',
    );
  });
});

describe('formatPrice', () => {
  it('écrit les prix comme le menu papier, sans flottant', () => {
    expect(formatPrice(10500, 'fr')).toBe('10,5\u00a0DT');
    expect(formatPrice(6000, 'fr')).toBe('6\u00a0DT');
    expect(formatPrice(6000, 'en')).toBe('6\u00a0DT');
    expect(formatPrice(5250, 'fr')).toBe('5,25\u00a0DT');
    expect(formatPrice(125, 'fr')).toBe('0,125\u00a0DT');
  });
});

describe('langue', () => {
  it('suit la langue du navigateur au premier passage', () => {
    mockBrowserLanguage('en-US');
    mockApi({});
    renderAt('/');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(en['table.unknown.title']);
    expect(document.documentElement.lang).toBe('en');
  });

  it('prend le français pour toute autre langue du navigateur', () => {
    mockBrowserLanguage('ar-TN');
    mockApi({});
    renderAt('/');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(fr['table.unknown.title']);
  });

  it('change la langue et mémorise le choix', async () => {
    mockApi({});
    const { unmount } = renderAt('/');

    await userEvent.click(screen.getByRole('button', { name: 'English' }));

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(en['table.unknown.title']);
    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true');
    expect(document.documentElement.lang).toBe('en');

    unmount();
    renderAt('/');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(en['table.unknown.title']);
  });

  it('fonctionne quand le stockage est bloqué', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqué');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqué');
    });
    mockApi({});
    renderAt('/');

    await userEvent.click(screen.getByRole('button', { name: 'English' }));

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(en['table.unknown.title']);
  });
});

describe('traductions', () => {
  it('ont les mêmes clés en français et en anglais, sans texte vide', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(fr).sort());
    for (const text of [...Object.values(fr), ...Object.values(en)]) {
      expect(text.trim()).not.toBe('');
    }
  });
});
