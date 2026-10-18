// Données factices au format de `GET /menu` (docs/api.md), en attendant le serveur.
// Extrait de docs/menu/menu.csv ; ids arbitraires.
import type { MenuItem, MenuResponse } from '../api/types';

const allDay: MenuItem['availability'] = { days: [1, 2, 3, 4, 5, 6, 7], from: null, until: null };
// « until » part de l'ouverture du café : le serveur renvoie from: '08:00'.
const untilNoon: MenuItem['availability'] = { ...allDay, from: '08:00', until: '12:00' };
const untilThree: MenuItem['availability'] = { ...allDay, from: '08:00', until: '15:00' };

const base = {
  photoUrl: null,
  available: true,
  unavailableReason: null,
  availability: allDay,
  suggestedExtraIds: [],
  choiceGroups: [],
  noteHint: null,
} satisfies Partial<MenuItem>;

export const mockMenu: MenuResponse = {
  categories: [
    {
      id: 1,
      name: { fr: 'Formules petit-déjeuner', en: 'Breakfast sets' },
      sortOrder: 1,
      items: [
        {
          ...base,
          id: 1,
          categoryId: 1,
          name: { fr: 'Early Bird', en: 'Early Bird' },
          description: {
            fr: 'Café ou thé, pain toasté, confiture, miel, Eau 0,5L',
            en: 'Coffee or tea, toasted bread, jam, honey, 0.5 L water',
          },
          price: 8500,
          availability: untilNoon,
          choiceGroups: ['hot_drink'],
          station: 'both',
        },
        {
          ...base,
          id: 2,
          categoryId: 1,
          name: { fr: 'Sunrise Plate', en: 'Sunrise Plate' },
          description: {
            fr: 'Café ou thé, pain toasté, confiture, miel, omelette ou œufs brouillés, Eau 0,5L',
            en: 'Coffee or tea, toasted bread, jam, honey, omelette or scrambled eggs, 0.5 L water',
          },
          price: 20500,
          availability: untilNoon,
          choiceGroups: ['hot_drink', 'eggs'],
          station: 'both',
        },
      ],
    },
    {
      id: 2,
      name: { fr: 'Extras', en: 'Extras' },
      sortOrder: 2,
      items: [
        {
          ...base,
          id: 10,
          categoryId: 2,
          name: { fr: 'Épinards', en: 'Spinach' },
          description: null,
          price: 6000,
          station: 'kitchen',
        },
        {
          ...base,
          id: 11,
          categoryId: 2,
          name: { fr: 'Avocat', en: 'Avocado' },
          description: null,
          price: 7000,
          available: false,
          unavailableReason: 'sold_out',
          station: 'kitchen',
        },
      ],
    },
    {
      id: 4,
      name: { fr: 'Œufs', en: 'Eggs' },
      sortOrder: 3,
      items: [
        {
          ...base,
          id: 30,
          categoryId: 4,
          name: { fr: 'Omelette nature', en: 'Plain omelette' },
          description: null,
          price: 13500,
          availability: untilThree,
          station: 'kitchen',
        },
        {
          ...base,
          id: 31,
          categoryId: 4,
          name: { fr: 'Œufs brouillés', en: 'Scrambled eggs' },
          description: null,
          price: 9000,
          availability: untilThree,
          station: 'kitchen',
        },
      ],
    },
    {
      id: 3,
      name: { fr: 'Cafés', en: 'Coffees' },
      sortOrder: 4,
      items: [
        {
          ...base,
          id: 20,
          categoryId: 3,
          name: { fr: 'Espresso', en: 'Espresso' },
          description: null,
          price: 6500,
          station: 'bar',
        },
        {
          ...base,
          id: 21,
          categoryId: 3,
          name: { fr: 'Espresso premium', en: 'Espresso premium' },
          description: null,
          price: 9500,
          station: 'bar',
        },
      ],
    },
  ],
  choiceGroups: [
    // Thés à 6 DT et cafés jusqu'à 8,5 DT : pas l'Espresso premium (9 DT).
    { key: 'hot_drink', name: { fr: 'Café ou thé', en: 'Coffee or tea' }, optionIds: [20] },
    {
      key: 'eggs',
      name: { fr: 'Omelette ou œufs brouillés', en: 'Omelette or scrambled eggs' },
      optionIds: [30, 31],
    },
  ],
};
