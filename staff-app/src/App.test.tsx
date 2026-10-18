import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { fr } from './i18n/fr';
import { installGate, iosBrowser, iosVersion, isIos, type DeviceInfo } from './install';
import manifestText from '../public/manifest.webmanifest?raw';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';

const device = (over: Partial<DeviceInfo>): DeviceInfo => ({
  userAgent: ANDROID,
  platform: 'Linux armv8l',
  maxTouchPoints: 5,
  standalone: false,
  secure: true,
  ...over,
});

/** Téléphone simulé pour l'app : navigateur, plateforme, et ouverte ou non depuis l'écran d'accueil. */
function mockDevice(info: DeviceInfo) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(info.userAgent);
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue(info.platform);
  // jsdom n'a pas maxTouchPoints : propriété ajoutée pour le test.
  Object.defineProperty(navigator, 'maxTouchPoints', {
    configurable: true,
    get: () => info.maxTouchPoints,
  });
  vi.stubGlobal('isSecureContext', info.secure);
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({ matches: info.standalone && query.includes('standalone') })),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  // Retire la propriété ajoutée par mockDevice : le test suivant repart du navigateur de jsdom.
  Reflect.deleteProperty(navigator, 'maxTouchPoints');
  localStorage.clear();
});

type Reply = { status: number; body?: unknown } | 'network-error';
type Route = Reply | ((body: unknown, headers: Record<string, string>) => Reply);

// Faux serveur : « POST /api/auth/login » pour un POST, chemin seul pour un GET.
function mockApi(routes: Record<string, Route>) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const path = method === 'GET' ? String(input) : `${method} ${String(input)}`;
    const route = routes[path];
    if (route === undefined) throw new Error(`appel inattendu : ${path}`);
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    const reply =
      typeof route === 'function'
        ? route(body, (init?.headers ?? {}) as Record<string, string>)
        : route;
    if (reply === 'network-error') return Promise.reject(new TypeError('Failed to fetch'));
    return Promise.resolve(
      reply.body === undefined
        ? new Response(null, { status: reply.status })
        : new Response(JSON.stringify(reply.body), {
            status: reply.status,
            headers: { 'Content-Type': 'application/json' },
          }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const apiError = (status: number, code: string, details?: object): Reply => ({
  status,
  body: { error: { code, message: code, ...(details ? { details } : {}) } },
});
const ME = { id: 7, name: 'Sami', role: 'waiter', onShift: false, principal: false };
const loggedIn = (mustChangePassword = false): Reply => ({
  status: 200,
  body: { token: 'jeton-1', user: { ...ME, mustChangePassword } },
});

describe('installation', () => {
  it('reconnaît un iPhone et un iPad récent (Mac tactile)', () => {
    expect(isIos(device({ userAgent: IPHONE, platform: 'iPhone' }))).toBe(true);
    expect(isIos(device({ userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel' }))).toBe(
      true,
    );
    expect(
      isIos(
        device({ userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 0 }),
      ),
    ).toBe(false);
    expect(isIos(device({}))).toBe(false);
  });

  it('bloque seulement un iPhone pas installé, en production', () => {
    const iphone = device({ userAgent: IPHONE, platform: 'iPhone' });
    expect(installGate(iphone, true)).toBe('install-ios');
    expect(installGate({ ...iphone, standalone: true }, true)).toBe('none');
    expect(installGate(iphone, false)).toBe('none');
    expect(installGate(device({}), true)).toBe('none');
  });

  it('ne bloque pas quand l’installation est impossible (adresse http)', () => {
    const iphone = device({ userAgent: IPHONE, platform: 'iPhone', secure: false });
    expect(installGate(iphone, true)).toBe('none');
  });

  it('iPhone avant iOS 16.4 : demande la mise à jour (pas de notifications)', () => {
    const old = device({ userAgent: IPHONE.replace('17_5', '16_3'), platform: 'iPhone' });
    expect(iosVersion(old)).toEqual([16, 3]);
    expect(installGate(old, true)).toBe('update-ios');
    expect(installGate({ ...old, userAgent: IPHONE.replace('17_5', '16_4') }, true)).toBe(
      'install-ios',
    );
    // iPad récent : pas de version dans le navigateur, on ne bloque pas pour la version.
    const ipad = device({ userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel' });
    expect(iosVersion(ipad)).toBeNull();
    expect(installGate(ipad, true)).toBe('install-ios');

    mockDevice(old);
    render(<App requireInstall />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(fr['install.update.title']);
  });

  it('iPhone dans Safari : écran « Installez l’app » avec les étapes', () => {
    mockDevice(device({ userAgent: IPHONE, platform: 'iPhone' }));
    render(<App requireInstall />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(fr['install.title']);
    const steps = screen.getAllByRole('listitem');
    expect(steps).toHaveLength(3);
    expect(steps[0]).toHaveTextContent(fr['install.step1.safari']);
    expect(screen.getByRole('img', { name: fr['install.shareIcon'] })).toBeInTheDocument();
    expect(screen.getByText(fr['install.noOption'])).toBeInTheDocument();
  });

  it('Chrome sur iPhone : le bouton Partager est en haut, dans la barre d’adresse', () => {
    mockDevice(
      device({ userAgent: IPHONE.replace('Version/17.5', 'CriOS/129.0'), platform: 'iPhone' }),
    );
    render(<App requireInstall />);
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent(fr['install.step1.other']);
  });

  it('navigateur intégré (Facebook…) : d’abord ouvrir dans Safari, avec « Copier le lien »', async () => {
    mockDevice(device({ userAgent: `${IPHONE} [FBAN/FBIOS;FBAV/480.0]`, platform: 'iPhone' }));
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal(
      'navigator',
      Object.assign(Object.create(navigator) as Navigator, { clipboard: { writeText } }),
    );
    render(<App requireInstall />);
    const steps = screen.getAllByRole('listitem');
    expect(steps[0]).toHaveTextContent(fr['install.openSafari']);

    await userEvent.click(screen.getByRole('button', { name: fr['install.copy'] }));
    expect(writeText).toHaveBeenCalledWith(window.location.href);
    expect(screen.getByRole('status')).toHaveTextContent(fr['install.copied']);
  });

  it('copie refusée : l’adresse complète reste affichée, à recopier', async () => {
    mockDevice(device({ userAgent: `${IPHONE} [FBAN/FBIOS;FBAV/480.0]`, platform: 'iPhone' }));
    const writeText = vi.fn(() => Promise.reject(new Error('refusé')));
    vi.stubGlobal(
      'navigator',
      Object.assign(Object.create(navigator) as Navigator, { clipboard: { writeText } }),
    );
    render(<App requireInstall />);
    await userEvent.click(screen.getByRole('button', { name: fr['install.copy'] }));
    expect(screen.getByRole('status')).toHaveTextContent(window.location.href);
  });

  it('iPhone ouvert depuis l’écran d’accueil : l’app s’ouvre', () => {
    mockDevice(device({ userAgent: IPHONE, platform: 'iPhone', standalone: true }));
    render(<App requireInstall />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(fr['login.title']);
  });

  it('Android : bouton « Installer l’app » quand le navigateur le propose, sans bloquer', async () => {
    mockDevice(device({}));
    render(<App requireInstall />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(fr['login.title']);
    expect(screen.queryByRole('button', { name: fr['install.button'] })).toBeNull();

    const prompt = vi.fn(() => Promise.resolve());
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt,
      userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    });
    act(() => {
      window.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);

    await userEvent.dblClick(screen.getByRole('button', { name: fr['install.button'] }));
    // Double tap : une seule proposition, et le bouton disparaît.
    expect(prompt).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: fr['install.button'] })).toBeNull();
  });

  it('Android : proposition refusée par le navigateur, le bouton disparaît sans erreur', async () => {
    mockDevice(device({}));
    render(<App requireInstall />);
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: vi.fn(() => Promise.reject(new DOMException('déjà utilisée', 'InvalidStateError'))),
      userChoice: new Promise(() => undefined),
    });
    act(() => {
      window.dispatchEvent(event);
    });
    await userEvent.click(screen.getByRole('button', { name: fr['install.button'] }));
    expect(screen.queryByRole('button', { name: fr['install.button'] })).toBeNull();
  });

  it('reconnaît le navigateur de l’iPhone', () => {
    const iphone = device({ userAgent: IPHONE, platform: 'iPhone' });
    expect(iosBrowser(iphone)).toBe('safari');
    expect(iosBrowser({ ...iphone, userAgent: `${IPHONE} EdgiOS/129` })).toBe('other');
    expect(iosBrowser({ ...iphone, userAgent: `${IPHONE} Instagram 300.0` })).toBe('in-app');
    expect(iosBrowser({ ...iphone, userAgent: `${IPHONE} [LinkedInApp]` })).toBe('in-app');
  });
});

describe('connexion', () => {
  // Téléphone Android ordinaire : pas d'écran d'installation.
  beforeEach(() => {
    mockDevice(device({}));
  });

  const fill = async (login: string, password: string) => {
    await userEvent.type(screen.getByLabelText(fr['login.login']), login);
    await userEvent.type(screen.getByLabelText(fr['login.password']), password);
    await userEvent.click(screen.getByRole('button', { name: fr['login.submit'] }));
  };

  it('se connecte, garde la session sur le téléphone et affiche le nom et le rôle', async () => {
    const fetchMock = mockApi({
      'POST /api/auth/login': loggedIn(),
      '/api/me': (_body, headers) =>
        headers['Authorization'] === 'Bearer jeton-1'
          ? { status: 200, body: ME }
          : apiError(401, 'UNAUTHORIZED'),
    });
    const { unmount } = render(<App />);
    await fill('  sami ', 'secret123');

    expect(
      await screen.findByRole('heading', { name: `${fr['home.hello']}, Sami` }),
    ).toBeInTheDocument();
    expect(screen.getByText(fr['role.waiter'])).toBeInTheDocument();
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body))).toEqual({ login: 'sami', password: 'secret123' });

    // Rechargement : pas de nouvelle connexion, la session est vérifiée par GET /me.
    unmount();
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: `${fr['home.hello']}, Sami` }),
    ).toBeInTheDocument();
  });

  it('affiche le titre du compte avec le rôle', async () => {
    mockApi({
      'POST /api/auth/login': loggedIn(),
      '/api/me': { status: 200, body: { ...ME, role: 'manager', title: 'Patronne' } },
    });
    render(<App />);
    await fill('rania', 'secret123');
    expect(await screen.findByText(`${fr['role.manager']} · Patronne`)).toBeInTheDocument();
  });

  it.each([
    ['UNAUTHORIZED', apiError(401, 'UNAUTHORIZED'), fr['login.error.credentials']],
    ['ACCOUNT_LOCKED', apiError(423, 'ACCOUNT_LOCKED'), fr['login.error.locked']],
    ['ACCOUNT_DISABLED', apiError(403, 'ACCOUNT_DISABLED'), fr['login.error.disabled']],
    ['TOO_MANY_REQUESTS', apiError(429, 'TOO_MANY_REQUESTS'), fr['login.error.tooMany']],
    ['réseau', 'network-error' as const, fr['login.error.network']],
  ])('%s : message clair, on reste sur la connexion', async (_name, reply, message) => {
    mockApi({ 'POST /api/auth/login': reply });
    render(<App />);
    await fill('sami', 'mauvais');
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('button', { name: fr['login.submit'] })).toBeEnabled();
  });

  it('champs vides : rien n’est envoyé', async () => {
    const fetchMock = mockApi({});
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: fr['login.submit'] }));
    expect(screen.getByRole('alert')).toHaveTextContent(fr['login.error.credentials']);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('« Afficher le mot de passe » montre ce qui est tapé', async () => {
    render(<App />);
    const password = screen.getByLabelText(fr['login.password']);
    expect(password).toHaveAttribute('type', 'password');
    await userEvent.click(screen.getByRole('button', { name: fr['login.show'] }));
    expect(password).toHaveAttribute('type', 'text');
  });

  it('se déconnecte : la session est effacée du téléphone', async () => {
    const fetchMock = mockApi({
      'POST /api/auth/login': loggedIn(),
      '/api/me': { status: 200, body: ME },
      'POST /api/auth/logout': { status: 204 },
    });
    render(<App />);
    await fill('sami', 'secret123');
    await userEvent.click(await screen.findByRole('button', { name: fr['session.logout'] }));
    expect(await screen.findByRole('heading', { name: fr['login.title'] })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/auth/logout')).toBe(true);
    expect(localStorage.length).toBe(0);
  });

  it('session expirée au démarrage : retour à la connexion avec un message', async () => {
    localStorage.setItem('coffee-qr.staff.token', 'vieux-jeton');
    mockApi({ '/api/me': apiError(401, 'UNAUTHORIZED') });
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent(fr['login.expired']);
    expect(localStorage.getItem('coffee-qr.staff.token')).toBeNull();
  });

  it('compte désactivé pendant la session : retour à la connexion', async () => {
    localStorage.setItem('coffee-qr.staff.token', 'jeton');
    mockApi({ '/api/me': apiError(403, 'ACCOUNT_DISABLED') });
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent(fr['login.error.disabled']);
  });

  it('serveur injoignable au démarrage : « Réessayer » garde la session', async () => {
    localStorage.setItem('coffee-qr.staff.token', 'jeton');
    let calls = 0;
    mockApi({ '/api/me': () => (++calls === 1 ? 'network-error' : { status: 200, body: ME }) });
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent(fr['session.offline.title']);
    await userEvent.click(screen.getByRole('button', { name: fr['session.retry'] }));
    expect(
      await screen.findByRole('heading', { name: `${fr['home.hello']}, Sami` }),
    ).toBeInTheDocument();
  });
});

describe('premier changement de mot de passe', () => {
  // Téléphone Android ordinaire : pas d'écran d'installation.
  beforeEach(() => {
    mockDevice(device({}));
  });

  async function toChangeScreen(routes: Record<string, Route> = {}) {
    const fetchMock = mockApi({
      'POST /api/auth/login': loggedIn(true),
      '/api/me': { status: 200, body: ME },
      ...routes,
    });
    render(<App />);
    await userEvent.type(screen.getByLabelText(fr['login.login']), 'sami');
    await userEvent.type(screen.getByLabelText(fr['login.password']), 'abc2def3gh');
    await userEvent.click(screen.getByRole('button', { name: fr['login.submit'] }));
    await screen.findByRole('heading', { name: fr['password.title'] });
    return fetchMock;
  }
  const fillChange = async (current: string, next: string, confirm: string) => {
    if (current) await userEvent.type(screen.getByLabelText(fr['password.current']), current);
    if (next) await userEvent.type(screen.getByLabelText(fr['password.new']), next);
    if (confirm) await userEvent.type(screen.getByLabelText(fr['password.confirm']), confirm);
    await userEvent.click(screen.getByRole('button', { name: fr['password.submit'] }));
  };

  it('obligatoire à la première connexion, puis l’app s’ouvre', async () => {
    const fetchMock = await toChangeScreen({ 'POST /api/auth/change-password': { status: 204 } });
    await fillChange('abc2def3gh', 'monNouveau9', 'monNouveau9');
    expect(
      await screen.findByRole('heading', { name: `${fr['home.hello']}, Sami` }),
    ).toBeInTheDocument();
    const call = fetchMock.mock.calls.find(([url]) => String(url) === '/api/auth/change-password');
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      currentPassword: 'abc2def3gh',
      newPassword: 'monNouveau9',
    });
  });

  it('au démarrage, PASSWORD_CHANGE_REQUIRED mène au même écran', async () => {
    localStorage.setItem('coffee-qr.staff.token', 'jeton');
    mockApi({ '/api/me': apiError(401, 'PASSWORD_CHANGE_REQUIRED') });
    render(<App />);
    expect(await screen.findByRole('heading', { name: fr['password.title'] })).toBeInTheDocument();
  });

  it('vérifie sur le téléphone : 8 caractères, confirmation identique', async () => {
    const fetchMock = await toChangeScreen();
    await fillChange('abc2def3gh', 'court', 'autre');
    expect(screen.getByText(fr['password.error.tooShort'])).toBeInTheDocument();
    expect(screen.getByText(fr['password.error.mismatch'])).toBeInTheDocument();
    expect(screen.getByLabelText(fr['password.new'])).toHaveAttribute('aria-invalid', 'true');
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('change-password'))).toBe(
      false,
    );
  });

  it.each([
    [
      'currentPassword',
      'Current password is incorrect',
      fr['password.current'],
      fr['password.error.current'],
    ],
    [
      'newPassword',
      'New password must differ from the login',
      fr['password.new'],
      fr['password.error.login'],
    ],
  ])(
    'erreur du serveur sur %s : affichée sous le bon champ',
    async (field, message, label, text) => {
      await toChangeScreen({
        'POST /api/auth/change-password': apiError(400, 'VALIDATION_ERROR', {
          fields: [{ field, message }],
        }),
      });
      await fillChange('abc2def3gh', 'monNouveau9', 'monNouveau9');
      expect(await screen.findByText(text)).toBeInTheDocument();
      expect(screen.getByLabelText(label)).toHaveAttribute('aria-invalid', 'true');
    },
  );
});

describe('manifeste', () => {
  const manifest = JSON.parse(manifestText) as {
    display: string;
    start_url: string;
    orientation?: string;
    icons: { src: string; sizes: string; purpose: string }[];
  };
  // Fichiers présents dans public/icons/ (chemins publiés : /icons/…).
  const iconFiles = Object.keys(import.meta.glob('../public/icons/*.png')).map((file) =>
    file.replace('../public', ''),
  );

  it('rend l’app installable : plein écran, icônes 192, 512 et maskable', () => {
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    // Pas de verrou : une tablette au comptoir peut passer en paysage.
    expect(manifest.orientation).toBeUndefined();
    const icons = manifest.icons.map((i) => `${i.sizes} ${i.purpose}`);
    expect(icons).toEqual(
      expect.arrayContaining(['192x192 any', '512x512 any', '512x512 maskable']),
    );
  });

  it('pointe vers des icônes qui existent, avec l’icône iPhone', () => {
    expect(iconFiles).toEqual(expect.arrayContaining(manifest.icons.map((i) => i.src)));
    expect(iconFiles).toContain('/icons/apple-touch-icon.png');
  });
});
