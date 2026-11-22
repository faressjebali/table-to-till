import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MenuItem, MenuResponse } from './api/types';
import { App } from './App';
import { fr } from './i18n/fr';
import { LanguageProvider } from './i18n/LanguageProvider';
import { applyMenuUpdate, BOUNDARY_MARGIN_MS, nextRefreshDelay } from './menu-view';
import { mockMenu } from './mocks/menu';
import { lastSocket, sockets } from './test/fake-socket';

// Menu QR à jour sans recharger : ruptures en temps réel, horaires relus au serveur.

const ESPRESSO = 20;
const CAPUCCINO = 22;
const EGG = 12;

/** Le menu avec une autre disponibilité pour certains articles. */
function withAvailability(
  menu: MenuResponse,
  changes: Record<number, MenuItem['unavailableReason']>,
): MenuResponse {
  return Object.entries(changes).reduce(
    (current, [id, reason]) =>
      applyMenuUpdate(current, {
        menuItemId: Number(id),
        available: reason === null,
        unavailableReason: reason,
      }),
    menu,
  );
}

// Faux serveur : /api/menu renvoie les menus donnés l'un après l'autre (le dernier ensuite).
function mockApi(menus: MenuResponse[]) {
  let menuCalls = 0;
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const path = String(input);
    let body: unknown;
    if (path === '/api/tables/k3J9x') body = { id: 3, number: 7 };
    else if (path === '/api/menu') body = menus[Math.min(menuCalls++, menus.length - 1)];
    else throw new Error(`appel inattendu : ${path}`);
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return { menuCalls: () => menuCalls };
}

async function renderMenu(...menus: MenuResponse[]) {
  const api = mockApi(menus.length > 0 ? menus : [mockMenu]);
  window.history.pushState({}, '', '/t/k3J9x');
  const view = render(
    <LanguageProvider>
      <App />
    </LanguageProvider>,
  );
  await screen.findByRole('tablist');
  // La connexion temps réel s'ouvre juste après l'affichage de la carte.
  await vi.waitFor(() => {
    expect(sockets).toHaveLength(1);
  });
  return { ...api, unmount: view.unmount };
}

const itemRow = (name: string) => {
  const row = screen.getByRole('button', { name }).closest('li');
  if (!row) throw new Error(`pas de ligne ${name}`);
  return row;
};

const update = (menuItemId: number, reason: MenuItem['unavailableReason']) =>
  act(() => {
    lastSocket().receive('menu:updated', {
      menuItemId,
      available: reason === null,
      unavailableReason: reason,
    });
  });

beforeEach(() => {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['fr-FR']);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('connexion temps réel', () => {
  it('se connecte avec le jeton de la table, et se déconnecte en quittant', async () => {
    const { unmount } = await renderMenu();
    expect(sockets).toHaveLength(1);
    expect(lastSocket().tableToken).toBe('k3J9x');
    unmount();
    expect(lastSocket().disconnected).toBe(true);
  });

  it('ne se connecte pas pour une table inconnue', () => {
    window.history.pushState({}, '', '/');
    render(
      <LanguageProvider>
        <App />
      </LanguageProvider>,
    );
    expect(sockets).toHaveLength(0);
  });
});

describe('rupture en temps réel', () => {
  it('grise un article tout de suite, et le dégrise au retour en stock', async () => {
    await renderMenu();
    await userEvent.click(screen.getByRole('tab', { name: fr['menu.section.drinks'] }));
    expect(itemRow('Espresso')).not.toHaveTextContent(fr['menu.soldOut']);

    update(ESPRESSO, 'sold_out');
    expect(itemRow('Espresso')).toHaveTextContent(fr['menu.soldOut']);

    update(CAPUCCINO, null);
    expect(itemRow('Capuccino')).not.toHaveTextContent(fr['menu.soldOut']);
  });

  it('la fiche ouverte suit : plus d’ajout possible, puis de nouveau', async () => {
    await renderMenu();
    await userEvent.click(screen.getByRole('tab', { name: fr['menu.section.drinks'] }));
    await userEvent.click(screen.getByRole('button', { name: 'Espresso' }));
    const sheet = screen.getByRole('dialog');
    const add = () => within(sheet).getByRole('button', { name: /^Ajouter/ });
    expect(add()).toBeEnabled();

    update(ESPRESSO, 'sold_out');
    expect(add()).toBeDisabled();
    update(ESPRESSO, null);
    expect(add()).toBeEnabled();
  });

  it('un extra coché qui passe en rupture n’est plus ajouté', async () => {
    await renderMenu();
    await userEvent.click(screen.getByRole('button', { name: 'Salade classique' }));
    const sheet = screen.getByRole('dialog');
    const egg = within(sheet).getByRole('checkbox', { name: /Œuf/ });
    await userEvent.click(egg);
    expect(within(sheet).getByRole('button', { name: /^Ajouter/ })).toHaveTextContent('14 DT');

    update(EGG, 'sold_out');
    expect(egg).toBeDisabled();
    expect(egg).not.toBeChecked();
    expect(within(sheet).getByRole('button', { name: /^Ajouter/ })).toHaveTextContent('11,5 DT');
  });

  it('un choix de formule qui passe en rupture doit être refait', async () => {
    await renderMenu(withAvailability(mockMenu, { [CAPUCCINO]: null }));
    await userEvent.click(screen.getByRole('button', { name: 'Early Bird' }));
    const sheet = screen.getByRole('dialog');
    await userEvent.click(within(sheet).getByRole('radio', { name: 'Capuccino' }));
    const add = () => within(sheet).getByRole('button', { name: /^Ajouter/ });
    expect(add()).toBeEnabled();

    update(CAPUCCINO, 'sold_out');
    expect(add()).toBeDisabled();
    expect(sheet).toHaveTextContent(fr['sheet.chooseFirst']);
  });

  it('une ligne du panier devenue indisponible est signalée avant l’envoi', async () => {
    await renderMenu();
    await userEvent.click(screen.getByRole('button', { name: 'Salade classique' }));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: /^Ajouter/ }),
    );

    update(40, 'sold_out');
    await userEvent.click(screen.getByRole('button', { name: /^Panier/ }));
    const cart = screen.getByRole('dialog', { name: fr['cart.heading'] });
    const salad = within(cart).getByRole('heading', { name: 'Salade classique' }).closest('li');
    expect(salad).toHaveTextContent(fr['cart.lineUnavailable']);
    expect(
      within(cart).getByRole('button', { name: new RegExp(`^${fr['cart.send']}`) }),
    ).toBeDisabled();

    update(40, null);
    expect(salad).not.toHaveTextContent(fr['cart.lineUnavailable']);
  });
});

describe('relecture du menu', () => {
  // Formules jusqu'à 12h00, heure de Tunis (UTC+1).
  const BEFORE_NOON = new Date('2026-10-19T11:59:00+01:00');
  const afterNoon = withAvailability(mockMenu, { 1: 'outside_hours', 2: 'outside_hours' });

  it('juste après l’heure limite : les formules disparaissent', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(BEFORE_NOON);
    const api = await renderMenu(mockMenu, afterNoon);
    expect(screen.getByRole('button', { name: 'Early Bird' })).toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(60_000 + BOUNDARY_MARGIN_MS));
    expect(api.menuCalls()).toBe(2);
    expect(screen.queryByRole('button', { name: 'Early Bird' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Formules petit-déjeuner' })).toBeNull();
  });

  it('la fiche d’un article devenu hors horaire se ferme', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(BEFORE_NOON);
    await renderMenu(mockMenu, afterNoon);
    await userEvent.click(screen.getByRole('button', { name: 'Early Bird' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(60_000 + BOUNDARY_MARGIN_MS));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('relit le menu à la reconnexion, pas à la première connexion', async () => {
    const api = await renderMenu(mockMenu, afterNoon);
    act(() => lastSocket().receive('connect'));
    expect(api.menuCalls()).toBe(1);

    act(() => lastSocket().receive('connect'));
    expect(await screen.findByRole('heading', { name: 'Œufs' })).toBeInTheDocument();
    expect(api.menuCalls()).toBe(2);
    expect(screen.queryByRole('button', { name: 'Early Bird' })).toBeNull();
  });

  it('relit le menu quand le téléphone revient sur la page', async () => {
    const api = await renderMenu(mockMenu, afterNoon);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await vi.waitFor(() => expect(api.menuCalls()).toBe(2));
    expect(await screen.findByRole('heading', { name: 'Œufs' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Early Bird' })).toBeNull();
  });

  it('une relecture ratée garde le menu affiché', async () => {
    await renderMenu();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    act(() => lastSocket().receive('connect'));
    act(() => lastSocket().receive('connect'));
    await act(() => Promise.resolve());
    expect(screen.getByRole('button', { name: 'Early Bird' })).toBeInTheDocument();
  });
});

describe('nextRefreshDelay', () => {
  const at = (iso: string) => nextRefreshDelay(mockMenu, new Date(iso));

  it('vise la prochaine heure limite des articles, à l’heure de Tunis', () => {
    // 11h59 → 12h00 (fin des formules).
    expect(at('2026-10-19T11:59:00+01:00')).toBe(60_000 + BOUNDARY_MARGIN_MS);
    // 12h30 → 15h00 (fin des œufs).
    expect(at('2026-10-19T12:30:00+01:00')).toBe(150 * 60_000 + BOUNDARY_MARGIN_MS);
  });

  it('vise la fermeture à 22h00, puis minuit, puis l’ouverture', () => {
    expect(at('2026-10-19T21:00:00+01:00')).toBe(60 * 60_000 + BOUNDARY_MARGIN_MS);
    expect(at('2026-10-19T23:00:00+01:00')).toBe(60 * 60_000 + BOUNDARY_MARGIN_MS);
    expect(at('2026-10-20T07:30:00+01:00')).toBe(30 * 60_000 + BOUNDARY_MARGIN_MS);
  });

  it('pile à l’heure limite : la suivante', () => {
    expect(at('2026-10-19T12:00:00+01:00')).toBe(3 * 3600_000 + BOUNDARY_MARGIN_MS);
  });
});
