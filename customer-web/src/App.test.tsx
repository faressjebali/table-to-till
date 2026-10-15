import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { en } from './i18n/en';
import { fr } from './i18n/fr';
import { LanguageProvider } from './i18n/LanguageProvider';

function renderApp() {
  return render(
    <LanguageProvider>
      <App />
    </LanguageProvider>,
  );
}

function mockBrowserLanguage(language: string) {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue([language]);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('langue', () => {
  it('suit la langue du navigateur au premier passage', () => {
    mockBrowserLanguage('en-US');
    renderApp();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(en['menu.title']);
    expect(document.documentElement.lang).toBe('en');
  });

  it('prend le français pour toute autre langue du navigateur', () => {
    mockBrowserLanguage('ar-TN');
    renderApp();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(fr['menu.title']);
  });

  it('change la langue et mémorise le choix', async () => {
    mockBrowserLanguage('fr-FR');
    const { unmount } = renderApp();

    await userEvent.click(screen.getByRole('button', { name: 'English' }));

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(en['menu.title']);
    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true');
    expect(document.documentElement.lang).toBe('en');

    unmount();
    renderApp();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(en['menu.title']);
  });

  it('fonctionne quand le stockage est bloqué', async () => {
    mockBrowserLanguage('fr-FR');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqué');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqué');
    });
    renderApp();

    await userEvent.click(screen.getByRole('button', { name: 'English' }));

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(en['menu.title']);
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
