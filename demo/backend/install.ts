// Branche la démo dans une app : les appels `/api/…` vont au faux serveur (server.ts), rien ne
// part sur le réseau, et un bandeau rappelle que les données sont fictives.
import { handle } from './server';
import { resetState } from './state';

const TEXT = {
  customer: {
    label: 'Démo — données fictives',
    hint: 'Commandez, puis confirmez dans l’app staff',
    link: 'App staff →',
  },
  staff: {
    label: 'Démo — données fictives',
    hint: 'serveur · barista · cuisinier · manager — mot de passe demo',
    link: 'Menu QR →',
  },
};

function patchFetch() {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      window.location.href,
    );
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) {
      return realFetch(input, init);
    }
    const headers = new Headers(init?.headers);
    const auth = headers.get('Authorization');
    const text = typeof init?.body === 'string' ? init.body : null;
    // Un petit délai, comme un vrai réseau : les états « chargement » restent visibles.
    await new Promise((resolve) => setTimeout(resolve, 120));
    const res = handle({
      method: (init?.method ?? 'GET').toUpperCase(),
      path: url.pathname.slice('/api'.length),
      query: url.searchParams,
      body: text ? (JSON.parse(text) as unknown) : undefined,
      token: auth?.startsWith('Bearer ') ? auth.slice(7) : null,
    });
    return new Response(res.status === 204 ? null : JSON.stringify(res.body), {
      status: res.status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

function banner(app: 'customer' | 'staff', otherAppUrl: string) {
  const text = TEXT[app];
  const bar = document.createElement('div');
  bar.setAttribute('role', 'note');
  bar.className = 'demo-banner';
  bar.innerHTML = `<strong></strong><span></span><a></a><button type="button">Réinitialiser</button>`;
  const [strong, span, a, button] = bar.children as unknown as [
    HTMLElement,
    HTMLElement,
    HTMLAnchorElement,
    HTMLButtonElement,
  ];
  strong.textContent = text.label;
  span.textContent = text.hint;
  a.textContent = text.link;
  a.href = otherAppUrl;
  a.target = '_blank';
  a.rel = 'noopener';
  button.addEventListener('click', () => {
    resetState();
    try {
      localStorage.removeItem('coffee-qr.staff.token');
    } catch {
      // Stockage indisponible.
    }
    window.location.reload();
  });
  const style = document.createElement('style');
  style.textContent = `
    .demo-banner { position: relative; z-index: 1000; display: flex; flex-wrap: wrap;
      align-items: baseline; gap: 2px 10px; padding: 5px 16px; font: 12px/1.35 system-ui, sans-serif;
      background: #1d3b33; color: #f4efe6; }
    .demo-banner strong { font-weight: 650; }
    .demo-banner span { opacity: .85; flex: 1 1 auto; }
    .demo-banner a { color: #f6c177; font-weight: 600; text-decoration: none; margin-left: auto; }
    .demo-banner button { font: inherit; color: inherit; background: transparent; cursor: pointer;
      border: 0; padding: 0; text-decoration: underline; opacity: .8; }
  `;
  document.head.append(style);
  document.body.prepend(bar);
}

/**
 * À appeler avant le premier rendu. `otherAppUrl` : lien du bandeau vers l'autre app.
 * Menu QR : sans jeton de table dans l'adresse, la démo ouvre la table 7.
 */
export function installDemo(app: 'customer' | 'staff', otherAppUrl: string) {
  patchFetch();
  if (app === 'customer') {
    const base = import.meta.env.BASE_URL;
    const rest = window.location.pathname.slice(base.length - 1);
    if (!/^\/t\/[^/]+\/?$/.test(rest)) {
      window.history.replaceState(null, '', `${base}t/demo-7`);
    }
  }
  banner(app, otherAppUrl);
}
