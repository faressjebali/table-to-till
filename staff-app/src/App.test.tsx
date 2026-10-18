import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { fr } from './i18n/fr';
import { installGate, iosBrowser, isIos, type DeviceInfo } from './install';
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

  it('iPhone ouvert depuis l’écran d’accueil : l’app s’ouvre', () => {
    mockDevice(device({ userAgent: IPHONE, platform: 'iPhone', standalone: true }));
    render(<App requireInstall />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(fr['home.title']);
  });

  it('Android : bouton « Installer l’app » quand le navigateur le propose, sans bloquer', async () => {
    mockDevice(device({}));
    render(<App requireInstall />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(fr['home.title']);
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
  });
});

describe('manifeste', () => {
  const manifest = JSON.parse(manifestText) as {
    display: string;
    start_url: string;
    icons: { src: string; sizes: string; purpose: string }[];
  };
  // Fichiers présents dans public/icons/ (chemins publiés : /icons/…).
  const iconFiles = Object.keys(import.meta.glob('../public/icons/*.png')).map((file) =>
    file.replace('../public', ''),
  );

  it('rend l’app installable : plein écran, icônes 192, 512 et maskable', () => {
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
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
