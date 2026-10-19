import type { Destination } from '../navigation';

// Icônes de la barre d'onglets : traits simples de 24 px, couleur du texte (currentColor).
const PATHS: Record<Destination, string> = {
  tables: 'M3 8h18M5 8v11M19 8v11M8 4h8M9 12h6',
  orders: 'M7 3h10a1 1 0 0 1 1 1v17l-3-2-3 2-3-2-3 2V4a1 1 0 0 1 1-1ZM9 8h6M9 12h6M9 16h3',
  offers:
    'M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7c-1-3-5-4-5-1.5S10 7 12 7Zm0 0c1-3 5-4 5-1.5S14 7 12 7Z',
  menu: 'M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4ZM5 17a3 3 0 0 1 3-3h11M9 8h6',
  till: 'M3 7h18v12H3zM3 11h18M7 15h3M16 15h1',
  bar: 'M5 8h11v6a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5V8ZM16 10h1.5a2.5 2.5 0 0 1 0 5H16M8 3v2M11 3v2M14 3v2',
  kitchen: 'M6 13a6 6 0 1 1 12 0v6H6v-6ZM4 19h16M12 4v3',
  directSale: 'M4 9l1.5-5h13L20 9M4 9h16v11H4V9ZM9 20v-6h6v6',
  staffOffers:
    'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2 20a6 6 0 0 1 12 0M16 11a3 3 0 1 0 0-6M18 20a6 6 0 0 0-3-5.2',
  purchases:
    'M3 4h2l2.5 11h11L21 7H6.5M10 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM18 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z',
  reports: 'M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-3',
  menuEdit: 'M4 20h4L19 9l-4-4L4 16v4ZM13 7l4 4',
  accounts: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0',
  me: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6.5 18a6 6 0 0 1 11 0',
};

export function TabIcon({ destination }: { destination: Destination }) {
  return (
    <svg
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[destination]} />
    </svg>
  );
}
