// Textes de l'interface en français. Toute clé ajoutée ici doit l'être aussi dans en.ts.
export const fr = {
  'language.label': 'Langue',
  'language.fr': 'Français',
  'language.en': 'English',
  'menu.title': 'Notre carte',
  'menu.intro': 'Commandez depuis votre table, un serveur viendra confirmer.',
  'menu.counterHint': 'Pressé ? Commandez au comptoir.',
};

export type MessageKey = keyof typeof fr;
export type Messages = Record<MessageKey, string>;
