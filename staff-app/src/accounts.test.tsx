import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Me, User } from './api/types';
import { StaffShell } from './components/StaffShell';
import { fr } from './i18n/fr';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const user = (over: Partial<User> = {}): User => ({
  id: 4,
  name: 'Amira',
  login: 'amira',
  role: 'waiter',
  title: null,
  active: true,
  mustChangePassword: false,
  locked: false,
  lastLoginAt: '2026-10-20T07:58:12Z',
  createdAt: '2026-10-15T10:00:00Z',
  ...over,
});

const RANIA: Me = {
  id: 2,
  name: 'Rania',
  role: 'manager',
  title: 'Patronne',
  onShift: false,
  principal: false,
};
const rania = user({ id: 2, name: 'Rania', login: 'rania', role: 'manager', title: 'Patronne' });

type Reply = { status: number; body?: unknown } | 'network-error';
type Call = { path: string; method: string; body: unknown };

// Faux serveur : une réponse par « MÉTHODE chemin » ; garde chaque appel pour vérifier le corps.
function mockApi(routes: Record<string, Reply | (() => Reply)>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      const method = init?.method ?? 'GET';
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ path, method, body });
      const route = routes[`${method} ${path}`];
      if (route === undefined) throw new Error(`appel inattendu : ${method} ${path}`);
      const reply = typeof route === 'function' ? route() : route;
      if (reply === 'network-error') return Promise.reject(new TypeError('Failed to fetch'));
      return Promise.resolve(
        new Response(JSON.stringify(reply.body), {
          status: reply.status,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }),
  );
  return calls;
}

const error = (status: number, code: string, details: unknown = {}): Reply => ({
  status,
  body: { error: { code, message: code, details } },
});

async function openAccounts(users: User[], routes: Record<string, Reply | (() => Reply)> = {}) {
  const calls = mockApi({ 'GET /api/users': { status: 200, body: { users } }, ...routes });
  localStorage.setItem('coffee-qr.staff.token', 'jeton');
  render(
    <StaffShell me={RANIA} onLogout={() => undefined} onShiftChange={() => Promise.resolve()} />,
  );
  const tabs = screen.getByRole('navigation', { name: fr['nav.label'] });
  await userEvent.click(within(tabs).getByRole('button', { name: fr['screen.accounts'] }));
  await screen.findByRole('heading', { name: fr['screen.accounts'] });
  return calls;
}

const openAccount = async (name: RegExp) => {
  await userEvent.click(await screen.findByRole('button', { name }));
  await screen.findByRole('button', { name: fr['accounts.reset'] });
};

describe('liste des comptes', () => {
  it('montre rôle, titre et états ; les comptes désactivés en dernier', async () => {
    await openAccounts([
      user({ id: 9, name: 'Ali', active: false }),
      rania,
      user({ mustChangePassword: true, locked: true }),
    ]);
    const rows = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(rows).toEqual([
      expect.stringContaining('Rania (vous)Manager · Patronne'),
      expect.stringContaining(`AmiraServeur${fr['accounts.locked']}${fr['accounts.mustChange']}`),
      expect.stringContaining(`AliServeur${fr['accounts.disabled']}`),
    ]);
  });

  it('erreur de chargement : Réessayer relit la liste', async () => {
    let fail = true;
    mockApi({
      'GET /api/users': () => (fail ? 'network-error' : { status: 200, body: { users: [user()] } }),
    });
    localStorage.setItem('coffee-qr.staff.token', 'jeton');
    render(
      <StaffShell me={RANIA} onLogout={() => undefined} onShiftChange={() => Promise.resolve()} />,
    );
    const tabs = screen.getByRole('navigation', { name: fr['nav.label'] });
    await userEvent.click(within(tabs).getByRole('button', { name: fr['screen.accounts'] }));
    await screen.findByText(fr['accounts.error']);
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: fr['session.retry'] }));
    expect(await screen.findByRole('button', { name: /Amira/ })).toBeInTheDocument();
  });
});

describe('créer un compte', () => {
  const fill = async (title = '') => {
    await userEvent.click(screen.getByRole('button', { name: fr['accounts.new'] }));
    await userEvent.type(screen.getByLabelText(fr['accounts.name']), ' Nour ');
    await userEvent.type(screen.getByLabelText(fr['login.login']), 'nour');
    await userEvent.selectOptions(screen.getByLabelText(fr['accounts.role']), 'barista');
    if (title) await userEvent.type(screen.getByLabelText(fr['accounts.title']), title);
    await userEvent.click(screen.getByRole('button', { name: fr['accounts.create'] }));
  };

  it('montre le mot de passe temporaire une seule fois, puis le compte dans la liste', async () => {
    const nour = user({ id: 8, name: 'Nour', login: 'nour', role: 'barista' });
    const calls = await openAccounts([rania], {
      'POST /api/users': {
        status: 201,
        body: { user: { ...nour, mustChangePassword: true }, temporaryPassword: 'k7xm2qp9ad' },
      },
    });
    await fill();

    expect(calls.at(-1)?.body).toEqual({ name: 'Nour', login: 'nour', role: 'barista' });
    expect(
      await screen.findByRole('heading', { name: fr['accounts.password.created'] }),
    ).toBeInTheDocument();
    expect(screen.getByText('k7xm2qp9ad')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: fr['accounts.password.done'] }));
    expect(screen.queryByText('k7xm2qp9ad')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Nour/ })).toHaveTextContent(
      fr['accounts.mustChange'],
    );
  });

  it('envoie le titre seulement s’il est rempli', async () => {
    const calls = await openAccounts([rania], {
      'POST /api/users': {
        status: 201,
        body: { user: user({ id: 8 }), temporaryPassword: 'k7xm2qp9ad' },
      },
    });
    await fill('Patron');
    await screen.findByText('k7xm2qp9ad');
    expect(calls.at(-1)?.body).toEqual({
      name: 'Nour',
      login: 'nour',
      role: 'barista',
      title: 'Patron',
    });
  });

  it('champs vides : rien n’est envoyé', async () => {
    const calls = await openAccounts([rania]);
    await userEvent.click(screen.getByRole('button', { name: fr['accounts.new'] }));
    await userEvent.click(screen.getByRole('button', { name: fr['accounts.create'] }));
    expect(screen.getByText(fr['accounts.error.name'])).toBeInTheDocument();
    expect(screen.getByText(fr['accounts.error.login'])).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'POST')).toEqual([]);
  });

  it('identifiant déjà pris : erreur sous le champ', async () => {
    await openAccounts([rania], {
      'POST /api/users': error(400, 'VALIDATION_ERROR', {
        fields: [{ field: 'login', message: 'Login already taken' }],
      }),
    });
    await fill();
    expect(await screen.findByText(fr['accounts.error.loginTaken'])).toBeInTheDocument();
    expect(screen.getByLabelText(fr['login.login'])).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('fiche d’un compte', () => {
  it('change le rôle : seul le champ modifié part', async () => {
    const calls = await openAccounts([rania, user()], {
      'PATCH /api/users/4': { status: 200, body: user({ role: 'barista' }) },
    });
    await openAccount(/Amira/);
    const save = screen.getByRole('button', { name: fr['accounts.save'] });
    expect(save).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText(fr['accounts.role']), 'barista');
    await userEvent.click(save);
    expect(await screen.findByText(fr['accounts.saved'])).toBeInTheDocument();
    expect(calls.at(-1)).toMatchObject({ method: 'PATCH', body: { role: 'barista' } });
  });

  it('serveur en shift : refus expliqué', async () => {
    await openAccounts([rania, user()], {
      'PATCH /api/users/4': error(409, 'INVALID_STATUS'),
    });
    await openAccount(/Amira/);
    await userEvent.click(screen.getByRole('button', { name: fr['accounts.disable'] }));
    await userEvent.click(screen.getByRole('button', { name: fr['accounts.disableYes'] }));
    expect(await screen.findByRole('alert')).toHaveTextContent(fr['accounts.error.inShift']);
  });

  it('désactiver demande une confirmation, puis le compte est marqué désactivé', async () => {
    const calls = await openAccounts([rania, user()], {
      'PATCH /api/users/4': { status: 200, body: user({ active: false }) },
    });
    await openAccount(/Amira/);
    await userEvent.click(screen.getByRole('button', { name: fr['accounts.disable'] }));
    await userEvent.click(screen.getByRole('button', { name: fr['accounts.cancel'] }));
    expect(calls.filter((c) => c.method === 'PATCH')).toEqual([]);

    await userEvent.click(screen.getByRole('button', { name: fr['accounts.disable'] }));
    await userEvent.click(screen.getByRole('button', { name: fr['accounts.disableYes'] }));
    expect(await screen.findByRole('button', { name: fr['accounts.enable'] })).toBeInTheDocument();
    expect(calls.at(-1)).toMatchObject({ method: 'PATCH', body: { active: false } });
  });

  it('réinitialiser montre le nouveau mot de passe', async () => {
    await openAccounts([rania, user({ locked: true })], {
      'POST /api/users/4/reset-password': {
        status: 200,
        body: { user: user({ mustChangePassword: true }), temporaryPassword: 'h4bn8wq3ze' },
      },
    });
    await openAccount(/Amira/);
    await userEvent.click(screen.getByRole('button', { name: fr['accounts.reset'] }));
    await userEvent.click(screen.getByRole('button', { name: fr['accounts.resetYes'] }));
    expect(
      await screen.findByRole('heading', { name: fr['accounts.password.reset'] }),
    ).toBeInTheDocument();
    expect(screen.getByText('h4bn8wq3ze')).toBeInTheDocument();
  });

  it('son propre compte : ni rôle ni désactivation', async () => {
    await openAccounts([rania]);
    await openAccount(/Rania/);
    expect(screen.queryByLabelText(fr['accounts.role'])).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: fr['accounts.disable'] })).not.toBeInTheDocument();
    expect(screen.getByLabelText(fr['accounts.title'])).toHaveValue('Patronne');
  });
});
