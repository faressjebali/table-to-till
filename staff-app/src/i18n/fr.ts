// Textes de l'app staff (en français seulement : le staff travaille en français).
export const fr = {
  'app.name': 'Café Olivine Staff',
  'home.title': 'Bienvenue',
  'home.body': 'L’app du staff est prête. La connexion arrive bientôt.',
  'install.title': 'Installez l’app',
  'install.why':
    'Sur iPhone, l’app doit être sur l’écran d’accueil pour recevoir les nouvelles commandes.',
  'install.openSafari': 'Ouvrez ce lien dans Safari : copiez-le, puis collez-le dans Safari.',
  'install.step1.safari': 'Touchez le bouton Partager de Safari.',
  'install.step1.other': 'Touchez le bouton Partager, en haut dans la barre d’adresse.',
  'install.step2': 'Choisissez « Sur l’écran d’accueil », puis « Ajouter ».',
  'install.step3': 'Ouvrez Olivine Staff depuis l’écran d’accueil.',
  'install.noOption': 'Pas de « Sur l’écran d’accueil » ? Ouvrez ce lien dans Safari.',
  'install.copy': 'Copier le lien',
  'install.copied': 'Lien copié. Collez-le dans Safari.',
  'install.shareIcon': 'Bouton Partager',
  'install.button': 'Installer l’app',
  'install.hint': 'Installez l’app pour l’ouvrir comme les autres et recevoir les commandes.',
};

export type MessageKey = keyof typeof fr;

export const t = (key: MessageKey): string => fr[key];
