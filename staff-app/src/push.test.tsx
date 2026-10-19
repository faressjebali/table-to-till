import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PushPrompt } from './components/PushPrompt';
import { fr } from './i18n/fr';
import { keyBytes, pushState } from './push';

const PUBLIC_KEY =
  'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM';
const SUBSCRIPTION = {
  endpoint: 'https://push.example.com/telephone',
  expirationTime: null,
  keys: { p256dh: 'cle', auth: 'auth' },
};

/** Navigateur avec push : service worker prêt, autorisation `permission`. */
function mockPushBrowser(permission: NotificationPermission, existing = false) {
  const subscribe = vi.fn(() => Promise.resolve({ toJSON: () => SUBSCRIPTION }));
  const pushManager = {
    getSubscription: () => Promise.resolve(existing ? { toJSON: () => SUBSCRIPTION } : null),
    subscribe,
  };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve({ pushManager }) },
  });
  vi.stubGlobal('PushManager', function PushManager() {});
  const requestPermission = vi.fn(() => Promise.resolve<NotificationPermission>('granted'));
  vi.stubGlobal('Notification', { permission, requestPermission });
  const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
  vi.stubGlobal('fetch', fetchMock);
  return { subscribe, requestPermission, fetchMock };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

describe('pushState', () => {
  it('unsupported : version de développement, clé absente ou navigateur sans push', () => {
    mockPushBrowser('default');
    expect(pushState({ publicKey: PUBLIC_KEY, enabled: false })).toBe('unsupported');
    expect(pushState({ publicKey: '', enabled: true })).toBe('unsupported');
    vi.stubGlobal('PushManager', undefined);
    Reflect.deleteProperty(window, 'PushManager');
    expect(pushState({ publicKey: PUBLIC_KEY, enabled: true })).toBe('unsupported');
  });

  it.each([
    ['default', 'ask'],
    ['granted', 'on'],
    ['denied', 'denied'],
  ] as const)('autorisation %s → %s', (permission, state) => {
    mockPushBrowser(permission);
    expect(pushState({ publicKey: PUBLIC_KEY, enabled: true })).toBe(state);
  });
});

it('keyBytes : clé VAPID base64url → 65 octets', () => {
  const bytes = keyBytes(PUBLIC_KEY);
  expect(bytes).toHaveLength(65);
  expect(bytes[0]).toBe(0x04);
});

describe('PushPrompt', () => {
  it('au tap : demande l’autorisation, abonne et envoie au serveur, puis disparaît', async () => {
    const { subscribe, requestPermission, fetchMock } = mockPushBrowser('default');
    localStorage.setItem('coffee-qr.staff.token', 'jeton');
    render(<PushPrompt initial="ask" />);

    await userEvent.click(screen.getByRole('button', { name: fr['push.button'] }));

    expect(requestPermission).toHaveBeenCalledOnce();
    expect(subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/push/subscribe',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(SUBSCRIPTION) }),
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('autorisation refusée : explique comment réactiver', () => {
    render(<PushPrompt initial="denied" />);
    expect(screen.getByText(fr['push.denied'])).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('déjà acceptée : réabonne en silence, sans bouton', async () => {
    const { subscribe, fetchMock } = mockPushBrowser('granted', true);
    render(<PushPrompt initial="on" />);
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledOnce();
    });
    expect(subscribe).not.toHaveBeenCalled();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('sans push : rien à l’écran', () => {
    const { container } = render(<PushPrompt initial="unsupported" />);
    expect(container).toBeEmptyDOMElement();
  });
});
