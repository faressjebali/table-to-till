// Formes de données de docs/api.md utilisées par le menu QR.

export type Lang = 'fr' | 'en';

/** Texte visible par le client, dans les deux langues. */
export type Localized = Record<Lang, string>;

/** Montant en millimes entiers (1 DT = 1000). */
export type Millimes = number;

export type ChoiceGroupKey = 'hot_drink' | 'seasonal_juice' | 'eggs' | 'eggs_with_benedict';

export interface ChoiceGroup {
  key: ChoiceGroupKey;
  name: Localized;
  optionIds: number[];
}

/** MenuItem tel que renvoyé aux clients (sans `posCode`). */
export interface MenuItem {
  id: number;
  categoryId: number;
  name: Localized;
  description: Localized | null;
  price: Millimes;
  photoUrl: string | null;
  available: boolean;
  unavailableReason: 'sold_out' | 'outside_hours' | null;
  availability: { days: number[]; from: string | null; until: string | null };
  suggestedExtraIds: number[];
  choiceGroups: ChoiceGroupKey[];
  noteHint: Localized | null;
  station: 'bar' | 'kitchen' | 'both';
}

export interface MenuCategory {
  id: number;
  name: Localized;
  sortOrder: number;
  items: MenuItem[];
}

/** Réponse de `GET /menu`. */
export interface MenuResponse {
  categories: MenuCategory[];
  choiceGroups: ChoiceGroup[];
}
