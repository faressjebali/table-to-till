# Système de design — App staff

Référence de l'apparence de `staff-app/`. Les variables sont dans `staff-app/src/styles/tokens.css`, les composants dans `staff-app/src/styles/components.css` (et `app.css` pour ceux qui existaient avant). La galerie `design.html` les montre tous, en développement seulement (`cd staff-app && npm run dev`, puis `/design.html` ; jamais dans le build).

**Règle** : un écran de l'app staff n'invente ni couleur, ni taille, ni composant. Un changement de palette ou de composant met à jour ce fichier **dans la même PR**.

## 1. Pour qui, dans quelles conditions

- Serveurs, barista, cuisinier, managers, comptable, sur leur propre téléphone (surtout des iPhone), app installée.
- Debout, souvent **d'une main**, **en plein service**, parfois **en plein soleil** en terrasse.
- **Français** uniquement.
- **Rapidité et lisibilité avant l'originalité.** L'app est un outil : le staff doit voir en un coup d'œil ce qui attend une action.

Principes :

1. **Un état ne passe jamais par la couleur seule** : forme, icône ou texte en plus (daltonisme, soleil).
2. **Contraste** : WCAG AA partout (texte 4,5:1, éléments graphiques 3:1) ; **7:1** pour les numéros, montants et états du plan des tables.
3. **48 px** minimum pour tout ce qui se touche, **8 px** entre deux cibles voisines.
4. **Rien ne bouge tout seul** : pas de clignotement, pas de pulsation. Le son et la notification push attirent l'attention ; l'écran reste calme.
5. **Une couleur = un sens**, dans les deux thèmes.

## 2. Thèmes

Deux palettes : **clair** et **sombre** (le sombre, avec le bouton beige de la connexion, est la base de l'identité). Par défaut l'app **suit le téléphone** ; « Moi » propose **Auto / Clair / Sombre**, mémorisé sur le téléphone (`src/theme.ts`, attribut `data-theme` sur `<html>`). Le clair aide en plein soleil ; chacun choisit.

Chaque composant est vérifié dans **les deux thèmes**. Dans `tokens.css`, le thème sombre est écrit deux fois (téléphone en sombre, ou Sombre imposé) : les deux blocs doivent rester identiques, un test le vérifie (`src/theme.test.ts`).

Manifest : `background_color` et `theme_color` = `#1c1b16` (papier sombre) ; les icônes ont déjà le fond beige `#e3d8c2`, l'olive et l'orange du logo, comme la palette. `index.html` donne la couleur de barre d'état de chaque thème du téléphone ; un thème imposé met les deux à jour.

## 3. Palette

Couleurs du café (logo et menu papier), sur fond uni. Crème + orange et quasi-noir + orange ressemblent à des palettes « par défaut » : ici elles viennent du logo, on les garde.

| Variable | Rôle | Clair | Sombre |
| --- | --- | --- | --- |
| `--color-paper` | Fond de l'app | `#fbf7ee` | `#1c1b16` |
| `--color-surface` | Cartes, barre d'onglets | `#ffffff` | `#26251f` |
| `--color-ink` | Texte | `#1f1d1a` | `#f2ebdd` |
| `--color-muted` | Texte secondaire, contour d'une table libre | `#6b6559` | `#b9b1a1` |
| `--color-border` | Traits de séparation (décor, jamais seul porteur d'information) | olive 25 % | crème 20 % |
| `--color-action` / `--color-on-action` | Bouton principal, table occupée | `#3d3f2b` / `#ffffff` | `#e3d9c3` (beige) / `#1c1b16` |
| `--color-accent` / `--color-on-accent` | Liens, onglet ouvert, note, **commande à confirmer** | `#b04300` / `#ffffff` | `#ff8a4c` / `#1c1b16` |
| `--color-danger` / `--color-on-danger` | Bouton danger, **échec caisse** | `#a8174a` / `#ffffff` | `#d4849a` / `#1c1b16` |
| `--color-ready` / `--color-on-ready` | **Prête** au bar ou en cuisine | `#1d5fa6` / `#ffffff` | `#8ab8ff` / `#1c1b16` |
| `--color-focus` | Contour du focus clavier | = accent | = accent |

En sombre, le framboise est **peu saturé** (48 %) : un bouton danger ne doit pas crier dans l'app sombre ; il garde 6,2:1. Le rouge est **framboise** et non rouge orangé : pour un daltonien protan ou deutan, il reste loin de l'orange « à confirmer » (écart ΔE 38 à 54 au lieu de 9 à 21 avec un rouge classique, simulation Machado 2009). Le bleu « prête » se distingue de l'orange et du rouge pour les trois formes de daltonisme.

### Contrastes calculés (WCAG 2.x, à partir des valeurs hexadécimales)

| Paire | Clair | Sombre |
| --- | --- | --- |
| ink sur paper | 15,7:1 | 14,5:1 |
| ink sur surface | 16,8:1 | 13,0:1 |
| muted sur paper | 5,4:1 | 8,1:1 |
| muted sur surface | 5,8:1 | 7,2:1 |
| accent sur paper | 5,4:1 | 7,4:1 |
| accent sur surface | 5,8:1 | 6,6:1 |
| on-accent sur accent | 5,8:1 | 7,4:1 |
| on-action sur action | 10,8:1 | 12,3:1 |
| action sur paper (table occupée) | 10,1:1 | 12,3:1 |
| on-danger sur danger | 7,3:1 | 6,2:1 |
| danger sur paper | 6,8:1 | 6,2:1 |
| danger sur surface | 7,3:1 | 5,5:1 |
| on-ready sur ready | 6,5:1 | 8,5:1 |
| ready sur paper | 6,1:1 | 8,5:1 |
| paper sur ink (bandeau « Pas de connexion ») | 15,7:1 | 14,5:1 |

Plan des tables (7:1 visé) : numéro d'une table libre (ink sur paper) 15,7 / 14,5 ; occupée (on-action sur action) 10,8 / 12,3 ; échec caisse (ink sur surface) 16,8 / 13,0. Les pastilles chiffrées (on-accent sur accent) sont à 5,8 / 7,4 : AA.

Un bouton désactivé (opacité 50 %) n'a pas d'exigence de contraste ; il dit toujours pourquoi (« Pas de connexion »).

## 4. Texte

**Police système** (`--font-body`) : rien à télécharger, marche hors ligne, nette sur chaque téléphone. Pas de police de marque.

Deux styles :

| Style | Graisse | Interligne | Tailles |
| --- | --- | --- | --- |
| **Titre** | 700 | 1,2 | `--text-title` 28 px (titre d'écran), `--text-card` 22 px (table ou poste d'une carte de commande), `--text-number` 20 px (numéro d'une table du plan) |
| **Texte** | 400, ou 600 pour ce qui compte (nom d'article, libellé de bouton, note) | 1,45 | `--text-body` 17 px, `--text-small` 14 px, `--text-tab` 12 px (minimum : barre d'onglets, pastilles) |

Montants, heures, quantités, numéros : chiffres alignés (`font-variant-numeric: tabular-nums`). Tailles en `rem` : elles suivent le zoom du navigateur. Aucun texte sous 12 px.

Écriture : phrases courtes, une seule majuscule en début de phrase (« Démarrer mon shift », jamais « Démarrer Mon Shift »), pas de majuscules pour décorer. Exceptions existantes : les mentions **ANNULÉ** et **TRANSFÉRÉ** sur l'écran bar / cuisine, qui doivent sauter aux yeux. Une ligne annulée ou transférée est aussi **barrée** (`<s>`) et passe en texte secondaire : on la reconnaît sans lire l'étiquette. Un bouton dit ce qu'il fait (« Confirmer », « Rejeter la commande ») ; une erreur dit quoi faire, sans s'excuser.

## 5. Espacements, rayons, tailles

| Variable | Valeur | Usage |
| --- | --- | --- |
| `--space-1` … `--space-8` | 4, 8, 12, 16, 24, 32 px | Marges et écarts ; marge latérale de l'écran 16 px |
| `--tap-min` | 48 px | Hauteur minimale de tout ce qui se touche |
| `--tap-gap` | 8 px | Écart minimal entre deux cibles voisines |
| `--tabbar-height` | 56 px | Barre d'onglets |
| `--table-tile` × `--table-tile-height` | 48 × 60 px | Table carrée du plan (dont 18 px de bande « prête » quand elle est là) ; une table longue fait 2 cases et l'écart entre elles : 104 × 60 px |
| `--table-round` | 56 px | Diamètre d'une table ronde, centrée sur sa case |
| `--radius-small` | 8 px | Table carrée du plan, pastilles carrées, nuancier |
| `--radius` | 14 px | Boutons, cartes, champs, bandeaux |
| `--radius-full` | 999 px | Table ronde, pastilles |
| `--content-max` | 40 rem | Largeur maximale du contenu |

## 6. États (plan des tables et bandeaux)

| État | Forme | Couleur | Icône / texte |
| --- | --- | --- | --- |
| Table **libre** | Contour 2 px, pas de fond, numéro seul | muted (contour), ink (numéro) | — |
| Table **occupée** | **Fond plein** + montant sous le numéro | action / on-action | montant |
| **Commande à confirmer** | **Bord épais** 4 px + pastille en haut à droite | accent | nombre de commandes |
| **Échec caisse** | **Hachures autour**, numéro et montant sur fond **uni** (surface) | danger | pastille ⚠ en haut à droite ; bandeau d'alerte « Échec caisse, table 14 » + « Réessayer » |
| **Prête au bar** | **Bande bleue** sur toute la largeur du bas de la table, dans la case | ready / on-ready | **tasse** de 16 px (icône de l'onglet Bar) |
| **Prête en cuisine** | Même bande | ready / on-ready | **cloche** de 16 px (icône de l'onglet Cuisine) |
| **Bar et cuisine prêts** | **Une seule bande** | ready / on-ready | tasse + cloche côte à côte |
| Table de l'**autre principal** (passation) | Contour épais 3 px, sans fond plein | action | **icône personne** dans la table, au-dessus du numéro ; son **nom** dans le résumé du plan (« Sami : 3 tables », touchable) et dans les commandes de la table (« Caisse de Sami ») |

Formes : **carrée** (48 × 60), **ronde** (56 px de diamètre : 5, 17, 25) et **longue** (2 cases, 104 × 60 : la 19 de la terrasse). Tous les états marchent sur les trois : sur une ronde, la pastille se pose sur le cercle et la bande « prête » devient une pilule dans le bas ; sur une longue, la bande prend toute la largeur. Seule la pastille du coin (à confirmer, échec) sort de la table, de 6 px : moins que les 8 px entre deux tables. Quand la place manque (ronde prête ou de l'autre principal, carrée prête et de l'autre principal), le **montant s'efface** : il reste dans la phrase du lecteur d'écran et dans les commandes de la table.

Échec caisse et commande à confirmer sur la même table : la pastille ⚠ passe avant (elle bloque la table) ; la commande reste dans la liste « Commandes ».

« Prête » demande au serveur d'agir (apporter la commande) : elle doit se voir aussi vite que « à confirmer ». D'où une **bande pleine** plutôt qu'une petite pastille : 48 × 18 px de bleu, icône de 16 px à 8,5:1 (sombre) ou 6,5:1 (clair) sur la bande. La bande reste dans la case, donc elle ne touche jamais la table voisine. Elle se combine avec les autres états (une table peut être prête et avoir une commande à confirmer). Sur une table occupée, le bleu et le fond plein de la table sont proches en luminosité (1,4 à 1,7:1) : c'est l'icône sur la bande, très contrastée, qui porte l'information. Sur une table ronde, la bande devient une pilule dans le bas du cercle.

## 7. Composants

| Composant | Classe | Où | Notes |
| --- | --- | --- | --- |
| Bouton principal | `.button` | `app.css` | 48 px, fond action. Un seul par écran ou par carte. `.button--block` pour toute la largeur |
| Bouton secondaire | `.button.button--secondary` | `app.css` | Contour, fond surface |
| **Bouton danger** | `.button.button--danger` | `components.css` | Rejeter, annuler, clôturer ; toujours un texte qui dit l'action, et une confirmation si c'est irréversible |
| Choix segmenté | `.segmented` (+ `.segmented__count`, `.segmented__badge`) | `components.css` | Boutons radio en ligne, 48 px : thème dans « Moi », salle du plan (`<RoomSwitch>` : « Intérieur 18 \| Terrasse 6 », dernier choix gardé sur le téléphone). Pastille orange chiffrée sur l'onglet **non affiché** quand des tables y attendent une action |
| **Carte de table** | `<TableTile>` / `.table-tile` | `components/TableTile.tsx` | Voir § 6. Le montant s'affiche **sans « DT »** (il tient dans 48 px) ; `label` donne au lecteur d'écran la phrase complète |
| **Plan d'une salle** | `.room`, `.room__cell` ; calcul `drawRoom` | `components.css`, `src/tablePlan.ts` | Deux salles, **Intérieur** (18 tables) et **Terrasse** (6), chacune avec sa grille (`docs/tables.csv` : `salle`, `forme`, case). Chaque table est placée en px : rangées de 60 px à 8 px d'écart ; entre deux colonnes, **8 px** si elles ont des tables sur la même rangée (**12 px** si une ronde y fait face), **4 px** si elles ne se font jamais face (l'écart vertical les sépare déjà). Intérieur : 328 px, Terrasse : 272 px, **sans défilement de côté** sur 360 px ; un test vérifie 8 px minimum entre deux tables |
| **Carte de commande** | `.ticket` + `.ticket--receipt` | `app.css` + `components.css` | Voir § 8 |
| Bandeau d'alerte | `.alert` (+ `.alert--danger`), `.alert__icon` | `app.css` + `components.css` | Dans l'écran : icône + texte + action éventuelle. `.alert--danger` pour l'échec caisse |
| Bandeau « prêt » | `.ready` | `app.css` | Bord et icône bleus `ready` : « Table 7 : boissons prêtes » + OK |
| **Résumé du plan** | `.chips`, `.chip` (+ `.chip__swatch`, `.chip__icon`) | `components.css` | Une puce de 48 px par état présent : sa forme ou son icône, son nombre, son nom. `aria-pressed` : un tap met ces tables en évidence (les autres à 35 %), un deuxième annule. Les puces comptent **les deux salles** ; si les tables d'une puce ne sont que dans l'autre salle, le plan y va |
| Bouton icône | `.icon-button` | `components.css` | Rond de 48 px, un signe ou une icône, toujours un `aria-label` (« ? » = Légende) |
| **Légende du plan** | `<TablesLegend>` / `.legend` | `components/TablesLegend.tsx` | Les 7 états avec la même carte de table (`decorative`) et leur nom, ouverte en un tap |
| État d'une commande | `.status-chip` (+ `--danger`, `--ready`) | `components.css` | Icône + texte : en caisse ✓, en attente, échec ⚠, à la main, boissons / plats prêts |
| Titre caché | `.visually-hidden` | `components.css` | Titre lu par le lecteur d'écran quand l'onglet le dit déjà (écran Tables) |
| **Bandeau « Pas de connexion »** | `.banner.banner--offline` | `components.css` | Collé en haut, **couleurs inversées** (ink / paper) : ne ressemble à rien d'autre ; icône réseau barré |
| **Bandeau « Nouvelle version disponible »** | `.banner.banner--update` | `components.css` | Collé en haut, discret, bouton « Recharger » de 48 px |
| Icônes d'état | `<StateIcon>` | `components/StateIcon.tsx` | Même trait que `TabIcon` ; toujours à côté d'un texte ou dans un élément qui a un `aria-label` |

Les écrans adoptent ces composants un par un, dans les PR d'apparence : plan des tables et commandes d'une table (fait), connexion, navigation, shift, avec captures avant / après dans les deux thèmes. D'ici là, un écart connu :

- `.button` n'a pas encore le léger retour au toucher (`scale(0.97)`) : il l'aura plus tard.

Limites du plan des tables, en attendant les données :

- **Échec caisse** : montré par la légende et par les commandes de la table, pas encore sur le plan ni dans le résumé ; branché plus tard (Réessayer, fait à la main).
- **Prête** : vient de l'événement `order:ready`, gardé sur le téléphone jusqu'au OK du bandeau ou jusqu'à ce que la table se libère. Une « prête » envoyée pendant une coupure réseau est perdue ; l'API ne permet pas encore de la relire.

## 8. Élément signature

**La carte de commande a le haut dentelé d'un bon de caisse**, comme les bons que LegacyPOS imprime au bar et en cuisine (`.ticket--receipt`). C'est la seule fantaisie de l'app : fixe, sans animation, dans les deux thèmes. Tout le reste est sobre.

## 9. Mouvement

- Seulement en réponse à un geste : fondu de couleur 150 ms, léger enfoncement (`scale(0.97)`) au toucher.
- Rien qui tourne en boucle, clignote ou pulse, même pour une commande en attente.
- `prefers-reduced-motion` : aucune transition.

## 10. Choix entre les skills de design

Les skills `frontend-design`, `ui-ux-pro-max` et `apple-design` aident, mais **ce fichier prime**. Arbitrages faits le 20/10/2026 :

| Sujet | Choix |
| --- | --- |
| Clair / sombre | Les deux ; le téléphone décide par défaut, choix Auto / Clair / Sombre dans « Moi » |
| Originalité (frontend-design) contre police système (apple-design) | Police système ; l'originalité tient dans un seul élément (§ 8) |
| Palette « par défaut » selon frontend-design et apple-design | Gardée : elle vient du logo du café |
| Taille de toucher (44 pt / 44 px) | 48 px, 8 px d'écart |
| `ui-ux-pro-max --design-system --persist` (`design-system/…/MASTER.md`) | Jamais : la seule référence est ce fichier. Recherches ciblées (`--domain ux`) seulement |
| Animation | Fondus de 150 ms en réponse à un geste ; rien qui pulse |
| Majuscules des boutons (Title Case d'Apple) | Français : une majuscule en début de phrase |
| Taille du texte système (Dynamic Type) | Tailles en `rem` ; le plan garde des cases fixes |
| Contraste AA | AA partout, 7:1 sur le plan |

Pas de MCP 21st, pas de bibliothèque de composants externe, pas de police téléchargée.
