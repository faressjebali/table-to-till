import type { Lang } from '../api/types';
import { en } from './en';
import { fr, type Messages } from './fr';

export const messages: Record<Lang, Messages> = { fr, en };

const STORAGE_KEY = 'coffee-qr.lang';

function isLang(value: unknown): value is Lang {
  return value === 'fr' || value === 'en';
}

/** Langue choisie sur ce téléphone, sinon celle du navigateur (anglais si demandé, sinon français). */
export function initialLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLang(stored)) return stored;
  } catch {
    // Stockage bloqué (navigation privée) : on se rabat sur le navigateur.
  }
  const preferred = navigator.languages[0] ?? navigator.language;
  return preferred.toLowerCase().startsWith('en') ? 'en' : 'fr';
}

export function saveLang(lang: Lang): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Sans stockage, le choix vaut pour la visite en cours seulement.
  }
}
