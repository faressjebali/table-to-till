// Thème clair ou sombre (docs/design.md) : par défaut il suit le téléphone ; « Moi » peut imposer
// Clair ou Sombre, mémorisé sur ce téléphone. Stockage bloqué : le choix vaut pour la visite.

export type ThemeChoice = 'auto' | 'light' | 'dark';

export const THEME_CHOICES: ThemeChoice[] = ['auto', 'light', 'dark'];

const KEY = 'coffee-qr.staff.theme';
let memoryChoice: ThemeChoice = 'auto';

// Barre d'état et fond de l'app installée : le papier de chaque thème (tokens.css).
const PAPER = { light: '#fbf7ee', dark: '#1c1b16' } as const;

function isChoice(value: unknown): value is ThemeChoice {
  return THEME_CHOICES.includes(value as ThemeChoice);
}

export function loadTheme(): ThemeChoice {
  try {
    const stored = localStorage.getItem(KEY);
    return isChoice(stored) ? stored : 'auto';
  } catch {
    return memoryChoice;
  }
}

/** Applique le thème à la page : `data-theme` sur <html> et couleur de la barre d'état. */
export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'auto') delete root.dataset.theme;
  else root.dataset.theme = choice;
  // index.html a une balise par thème du téléphone ; un thème imposé les met toutes les deux à jour.
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
    const scheme = meta.media.includes('dark') ? 'dark' : 'light';
    meta.content = PAPER[choice === 'auto' ? scheme : choice];
  });
}

export function saveTheme(choice: ThemeChoice): void {
  memoryChoice = choice;
  try {
    if (choice === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // Sans stockage : le choix reste en mémoire.
  }
  applyTheme(choice);
}
