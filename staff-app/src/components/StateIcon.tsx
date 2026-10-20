// Icônes d'état (docs/design.md), même trait que la barre d'onglets : elles doublent toujours la
// couleur, pour qu'un daltonien voie l'état. Tasse et cloche : mêmes tracés que les onglets Bar et
// Cuisine (TabIcon).
export type State =
  'bar' | 'kitchen' | 'failed' | 'offline' | 'update' | 'person' | 'done' | 'waiting' | 'manual';

const STATE_PATHS: Record<State, string> = {
  bar: 'M5 8h11v6a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5V8ZM16 10h1.5a2.5 2.5 0 0 1 0 5H16M8 3v2M11 3v2M14 3v2',
  kitchen: 'M6 13a6 6 0 1 1 12 0v6H6v-6ZM4 19h16M12 4v3',
  failed: 'M12 3 2 20h20L12 3ZM12 10v4M12 17v.5',
  offline:
    'M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0M12 19v.5M3 3l18 18',
  update: 'M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5',
  // Autre principal (passation) : même tracé que l'onglet Comptes.
  person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0',
  // État en caisse d'une commande : tapée, en attente, faite à la main.
  done: 'M5 12.5 10 17.5 19 7',
  waiting: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2',
  manual: 'M4 20h4L19 9l-4-4L4 16v4ZM13 7l4 4',
};

export function StateIcon({ state, size = 24 }: { state: State; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={size < 20 ? 2.6 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={STATE_PATHS[state]} />
    </svg>
  );
}
