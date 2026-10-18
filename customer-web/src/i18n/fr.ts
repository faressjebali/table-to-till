// Textes de l'interface en français. Toute clé ajoutée ici doit l'être aussi dans en.ts.
export const fr = {
  'language.label': 'Langue',
  'language.fr': 'Français',
  'language.en': 'English',
  'menu.title': 'Notre carte',
  'menu.intro': 'Commandez depuis votre table, un serveur viendra confirmer.',
  'menu.counterHint': 'Pressé ? Commandez au comptoir.',
  'menu.sections': 'Carte',
  'menu.section.food': 'Food',
  'menu.section.drinks': 'Boissons',
  'menu.suggestions': 'Extras suggérés',
  'menu.categories': 'Catégories',
  'menu.soldOut': 'Épuisé',
  'menu.loading': 'Chargement de la carte…',
  'table.unknown.title': 'QR non reconnu',
  'table.unknown.body': 'Ce QR code ne correspond à aucune table. Demandez au serveur.',
  'error.title': 'Carte indisponible',
  'error.body':
    'La carte n’a pas pu être chargée. Vérifiez votre connexion ou réessayez dans un instant.',
  'error.retry': 'Réessayer',
};

export type MessageKey = keyof typeof fr;
export type Messages = Record<MessageKey, string>;
