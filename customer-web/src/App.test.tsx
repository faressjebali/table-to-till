import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MenuResponse } from './api/types';
import { App } from './App';
import { linesFromSelection, linesTotal } from './cart';
import { formatPrice } from './format';
import { en } from './i18n/en';
import { fr } from './i18n/fr';
import { LanguageProvider } from './i18n/LanguageProvider';
import { itemsById } from './menu-view';
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

  it('affiche la carte sans numéro de table, avec « Pressé ? » dès le haut', async () => {
    const fetchMock = mockApi({ '/api/tables/k3J9x': table7, '/api/menu': menuReply() });
    renderAt('/t/k3J9x');

    expect(screen.getByRole('status')).toHaveTextContent(fr['menu.loading']);
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(fr['menu.title']);
    expect(screen.queryByText(/Table 7/)).toBeNull();
    // « Pressé ? » est avant la première catégorie.
    const hint = screen.getByText(fr['menu.counterHint']);
    const firstCategory = screen.getAllByRole('heading', { level: 2 })[0];
    if (!firstCategory) throw new Error('aucune catégorie');
    expect(hint.compareDocumentPosition(firstCategory)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
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
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
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
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(fr['menu.title']);
  });
});

const outside = { available: false, unavailableReason: 'outside_hours' as const };

/** La carte factice avec les catégories `names` entièrement hors horaire. */
function menuWithout(...names: string[]): MenuResponse {
  return {
    ...mockMenu,
    categories: mockMenu.categories.map((c) =>
      names.includes(c.name.fr) ? { ...c, items: c.items.map((i) => ({ ...i, ...outside })) } : c,
    ),
  };
}

const categoryTitles = () => screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);

describe('carte', () => {
  async function renderMenu(menu: MenuResponse = mockMenu) {
    mockApi({ '/api/tables/k3J9x': table7, '/api/menu': menuReply(menu) });
    renderAt('/t/k3J9x');
    await screen.findByRole('tablist');
  }

  it('ouvre sur l’onglet Food, dans l’ordre du menu papier, avec la barre des catégories', async () => {
    await renderMenu();
    expect(screen.getByRole('tab', { name: 'Food' })).toHaveAttribute('aria-selected', 'true');
    expect(categoryTitles()).toEqual(['Formules petit-déjeuner', 'Œufs', 'Extras', 'Salades']);

    const nav = screen.getByRole('navigation', { name: fr['menu.categories'] });
    const links = within(nav).getAllByRole('link');
    expect(links.map((a) => a.textContent)).toEqual(categoryTitles());
    expect(links[2]).toHaveAttribute('href', '#categorie-3');
    expect(document.getElementById('categorie-3')).toHaveTextContent('Extras');
  });

  it('l’onglet Boissons montre seulement les boissons', async () => {
    await renderMenu();
    await userEvent.click(screen.getByRole('tab', { name: fr['menu.section.drinks'] }));
    expect(screen.getByRole('tab', { name: fr['menu.section.drinks'] })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(categoryTitles()).toEqual(['Cafés']);
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Espresso premium');
  });

  it('change d’onglet avec les flèches du clavier', async () => {
    await renderMenu();
    screen.getByRole('tab', { name: 'Food' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    const drinks = screen.getByRole('tab', { name: fr['menu.section.drinks'] });
    expect(drinks).toHaveAttribute('aria-selected', 'true');
    expect(drinks).toHaveFocus();
  });

  it('affiche nom, description et prix de chaque article', async () => {
    await renderMenu();
    expect(
      screen.getByText('Café ou thé, pain toasté, confiture, miel, Eau 0,5L'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Salade classique' }).closest('li'),
    ).toHaveTextContent('11,5 DT');
  });

  it('affiche les Extras en tableau nom + prix, une rupture grisée', async () => {
    await renderMenu();
    const extras = document.getElementById('categorie-3');
    if (!extras) throw new Error('pas de section Extras');
    const cells = within(extras).getAllByRole('listitem');
    expect(cells.map((c) => c.textContent)).toEqual([
      'Épinards6\u00a0DT',
      `Avocat${fr['menu.soldOut']}`,
      'Œuf2,5\u00a0DT',
    ]);
    expect(cells[1]).toHaveClass('extra--sold-out');
  });

  it('après 15h, les Extras passent sous les Salades : la carte ne commence pas par eux', async () => {
    await renderMenu(menuWithout('Formules petit-déjeuner', 'Œufs'));
    expect(categoryTitles()).toEqual(['Salades', 'Extras']);
  });

  it('montre les extras suggérés sous un article, une rupture grisée', async () => {
    await renderMenu();
    const salad = screen.getByRole('heading', { name: 'Salade classique' }).closest('li');
    if (!salad) throw new Error('pas de Salade classique');
    const suggestions = within(salad).getByRole('list', { name: fr['menu.suggestions'] });
    const lines = within(suggestions).getAllByRole('listitem');
    expect(lines.map((l) => l.textContent)).toEqual([
      '+Œuf 2,5\u00a0DT',
      `+Avocat ${fr['menu.soldOut']}`,
    ]);
    expect(lines[1]).toHaveClass('suggestion--sold-out');
  });

  it('grise un article en rupture, masque un article hors horaire et une catégorie vide', async () => {
    const [breakfast, eggs, ...rest] = mockMenu.categories;
    if (!breakfast || !eggs) throw new Error('menu factice incomplet');
    await renderMenu({
      ...mockMenu,
      categories: [
        // Toutes les formules hors horaire (après 12h) : la catégorie disparaît.
        { ...breakfast, items: breakfast.items.map((i) => ({ ...i, ...outside })) },
        {
          ...eggs,
          items: eggs.items.map((i, n) =>
            n === 0
              ? { ...i, ...outside }
              : { ...i, available: false, unavailableReason: 'sold_out' as const },
          ),
        },
        ...rest,
      ],
    });

    expect(screen.queryByRole('heading', { name: 'Formules petit-déjeuner' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Formules petit-déjeuner' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Omelette nature' })).toBeNull();

    const scrambled = screen.getByRole('heading', { name: 'Œufs brouillés' }).closest('li');
    expect(scrambled).toHaveClass('item--sold-out');
    expect(scrambled).toHaveTextContent(fr['menu.soldOut']);
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
    expect(screen.getByText(en['menu.counterHint'])).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Salads' })).toBeInTheDocument();
    expect(screen.getByText('Spinach').closest('li')).toHaveTextContent('6 DT');
    await userEvent.click(screen.getByRole('tab', { name: en['menu.section.drinks'] }));
    expect(screen.getByRole('heading', { name: 'Coffees' })).toBeInTheDocument();
  });
});

describe('fiche article', () => {
  async function openItem(
    name: string | RegExp,
    { menu = mockMenu, drinks = false }: { menu?: MenuResponse; drinks?: boolean } = {},
  ) {
    mockApi({ '/api/tables/k3J9x': table7, '/api/menu': menuReply(menu) });
    renderAt('/t/k3J9x');
    await screen.findByRole('tablist');
    if (drinks) {
      await userEvent.click(screen.getByRole('tab', { name: fr['menu.section.drinks'] }));
    }
    await userEvent.click(screen.getByRole('button', { name }));
    return screen.getByRole('dialog');
  }

  const cartBar = () => screen.getByRole('status');

  it('s’ouvre au tap sur un article et se ferme avec ✕ ou Échap', async () => {
    const sheet = await openItem('Salade classique');
    expect(sheet).toHaveAccessibleName('Salade classique');
    expect(sheet).toHaveTextContent('Laitue, tomates cerises');
    expect(within(sheet).getByRole('button', { name: fr['sheet.close'] })).toHaveFocus();

    await userEvent.click(within(sheet).getByRole('button', { name: fr['sheet.close'] }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Salade classique' })).toHaveFocus();

    await userEvent.click(screen.getByRole('button', { name: 'Salade classique' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('ajoute l’article et chaque extra coché en lignes séparées (1 extra), avec le total', async () => {
    const sheet = await openItem('Salade classique');
    const add = () => within(sheet).getByRole('button', { name: /^Ajouter/ });
    expect(add()).toHaveTextContent('11,5 DT');

    await userEvent.click(within(sheet).getByRole('button', { name: fr['sheet.increase'] }));
    await userEvent.click(within(sheet).getByRole('checkbox', { name: /Œuf/ }));
    // 2 salades à 11,5 DT + 1 œuf à 2,5 DT
    expect(add()).toHaveTextContent('20,5 DT');
    // Avocat en rupture : ne peut pas être coché.
    expect(within(sheet).getByRole('checkbox', { name: /Avocat/ })).toBeDisabled();

    await userEvent.click(add());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(cartBar()).toHaveTextContent('3 articles · 20,5 DT');
  });

  it('un second tap décoche un extra', async () => {
    const sheet = await openItem('Salade classique');
    const egg = within(sheet).getByRole('checkbox', { name: /Œuf/ });
    await userEvent.click(egg);
    await userEvent.click(egg);
    expect(egg).not.toBeChecked();
    expect(within(sheet).getByRole('button', { name: /^Ajouter/ })).toHaveTextContent('11,5 DT');
  });

  it('quantité entre 1 et 20', async () => {
    const sheet = await openItem('Salade classique');
    const less = within(sheet).getByRole('button', { name: fr['sheet.decrease'] });
    const more = within(sheet).getByRole('button', { name: fr['sheet.increase'] });
    expect(less).toBeDisabled();
    for (let i = 1; i < 20; i += 1) await userEvent.click(more);
    expect(within(sheet).getByRole('status')).toHaveTextContent('20');
    expect(more).toBeDisabled();
  });

  it('formule : un choix par liste avant d’ajouter ; option en rupture grisée ; pas de prix d’option', async () => {
    const sheet = await openItem('Sunrise Plate');
    const add = within(sheet).getByRole('button', { name: /^Ajouter/ });
    expect(add).toBeDisabled();
    expect(sheet).toHaveTextContent(fr['sheet.chooseFirst']);

    const drinks = within(sheet).getByRole('group', { name: 'Café ou thé' });
    expect(within(drinks).getByRole('radio', { name: /Capuccino/ })).toBeDisabled();
    expect(drinks).not.toHaveTextContent('DT');
    await userEvent.click(within(drinks).getByRole('radio', { name: 'Espresso' }));
    expect(add).toBeDisabled();

    const eggs = within(sheet).getByRole('group', { name: 'Omelette ou œufs brouillés' });
    await userEvent.click(within(eggs).getByRole('radio', { name: 'Œufs brouillés' }));
    expect(add).toBeEnabled();
    await userEvent.click(add);
    expect(cartBar()).toHaveTextContent('1 article · 20,5 DT');
  });

  it('note limitée à 200 caractères, avec l’aide de l’article au-dessus', async () => {
    const sheet = await openItem('Espresso', { drinks: true });
    expect(sheet).toHaveTextContent('Sans sucre ?');
    const note = within(sheet).getByRole('textbox', { name: fr['sheet.note'] });
    expect(note).toHaveAttribute('maxLength', '200');
    await userEvent.type(note, 'sans sucre');
    expect(sheet).toHaveTextContent('10/200');
  });

  it('un article en rupture ne peut pas être ajouté', async () => {
    const sheet = await openItem('Capuccino', { drinks: true });
    expect(within(sheet).getByRole('button', { name: /^Ajouter/ })).toBeDisabled();
  });

  it('un extra du tableau s’ouvre et s’ajoute seul', async () => {
    const sheet = await openItem(/^Épinards/);
    expect(sheet).toHaveAccessibleName('Épinards');
    await userEvent.click(within(sheet).getByRole('button', { name: /^Ajouter/ }));
    expect(cartBar()).toHaveTextContent('1 article · 6 DT');
  });

  it('fiche en anglais', async () => {
    mockBrowserLanguage('en-US');
    const sheet = await openItem('Classic salad');
    expect(within(sheet).getByRole('button', { name: /^Add/ })).toBeInTheDocument();
    expect(within(sheet).getByRole('checkbox', { name: /Egg/ })).toBeInTheDocument();
  });
});

describe('panier', () => {
  it('lignes au format de POST /orders : article, puis un extra par ligne', () => {
    const [salad] = mockMenu.categories[3]?.items ?? [];
    if (!salad) throw new Error('pas de salade');
    const lines = linesFromSelection({
      item: salad,
      quantity: 2,
      note: '  sans oignon ',
      choices: [],
      extraIds: [12],
    });
    expect(lines.map(({ key: _key, ...line }) => line)).toEqual([
      { menuItemId: 40, quantity: 2, note: 'sans oignon', choices: [] },
      { menuItemId: 12, quantity: 1, note: null, choices: [] },
    ]);
    expect(linesTotal(lines, itemsById(mockMenu))).toBe(20500);
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
