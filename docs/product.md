# Spécification produit — Coffee QR

Ce que nous construisons et quand une fonctionnalité est « terminée ». Si quelque chose manque ou n'est pas clair : demander, ne pas inventer.

Version 2 — refonte du 15 octobre 2026.

## 1. Contexte

- Coffee shop réel en Tunisie, environ 20 tables, environ 110 articles (voir `docs/menu/menu.csv`).
- Caisse : **LegacyPOS** (éditeur local) sur un **PC Windows**. Pas d'API. On ne contacte pas l'éditeur et on ne modifie rien dans LegacyPOS.
- La licence n'interdit pas l'automatisation et la propriétaire a donné son accord.
- Aucun paiement en ligne : le client paie au comptoir ou au serveur (espèces ou carte).
- Pas de délai imposé : le plus tôt possible, travail quotidien.

## 2. Les 5 parties

| Partie | Dossier | Pour qui |
| --- | --- | --- |
| Menu QR | `customer-web/` | Clients, sur leur téléphone, sans application |
| App staff (PWA) | `staff-app/` | Chaque membre du staff, sur son propre téléphone |
| Serveur | `server/` | API, base de données, temps réel, file des tâches caisse |
| Agent caisse | `pos-agent/` | PC de caisse Windows : saisit dans LegacyPOS comme un humain |
| Émulateur LegacyPOS | `pos-emulator/` | Nos PC (Windows) : copie de l'interface pour tester l'agent |

## 3. Le menu

- Catégories : Formules petit-déjeuner, Œufs, Salades, Plats, Starters, Sandwichs, Cakes & Sweets, Kids Menu, Extras, Jus, Fresh Blends, Thé & Infusion, Cafés, Matcha, Healthy Shots, Eau, Plat de la semaine.
- **Pas de tailles.** Chaque article a un prix fixe.
- **Chaque article a un code produit** LegacyPOS. L'agent saisit par **code**, jamais par nom.
- **Une photo par article.**
- **Deux menus complets : français et anglais** (noms et descriptions). « مرطبات اليوم » reste tel quel.
- **Extras** (avocat, champignons, bacon…) : ce sont des **articles normaux** avec leur prix et leur code. Ils apparaissent :
  - dans une section « Extras » de la catégorie ;
  - en **suggestions sous certains plats** (ex. Cheese Burger : +Bacon de bœuf, +Œuf, +Gouda…).
  Dans les deux cas, ils arrivent en caisse comme **une ligne séparée**.
- **Formules et articles à choix** (formules petit-déj, Kids Menu, Cookie) : le client choisit l'article et précise son choix (café/thé, jus, œufs, pancakes/cookie, parfum) **dans la note**. En caisse, l'agent saisit l'article et recopie la note.
- **Une note libre par ligne** (max 200 caractères).
- **Horaires de disponibilité** (fuseau Africa/Tunis), appliqués automatiquement :
  - Formules petit-déjeuner : jusqu'à 12h00
  - Œufs : jusqu'à 15h00
  - Plat de la semaine : lundi au vendredi, 8h00–15h00
  Hors horaire, l'article est masqué du menu QR et refusé par le serveur.
- **Rupture** : un article peut être marqué indisponible à tout moment ; il est grisé immédiatement chez les clients.
- Deux espressos distincts : **Espresso** (6,5 DT) et **Espresso premium** (9,5 DT), chacun avec son code.

## 4. Menu QR (`customer-web/`)

- Un QR par table, contenant un **jeton aléatoire** (pas le numéro de table). Jeton inconnu → message « demandez au serveur ».
- Langue au choix FR / EN, mémorisée sur le téléphone.
- Affichage par catégorie, comme le menu papier actuel : nom, description, prix (`12 DT`, `5,5 DT`), photo.
- Fiche article : photo, description, extras suggérés (ajoutables en un tap), quantité (1–20), note.
- Panier : lignes, quantités, total, modifier/supprimer. Envoi → écran « Commande envoyée, un serveur va la confirmer ».
- Erreur (réseau, article devenu indisponible) : le panier est conservé, message clair.
- La table peut commander plusieurs fois.
- Rapide sur données mobiles (photos compressées, chargement progressif).

## 5. App staff (`staff-app/`)

### Comptes et connexion
- **Un compte par personne.** Identifiant (numéro de téléphone ou nom d'utilisateur) + mot de passe.
- Connexion **une fois par téléphone**, session de **30 jours**.
- La **manager crée les comptes** avec un mot de passe temporaire et attribue un **rôle**. Changement de mot de passe obligatoire à la première connexion.
- La manager peut changer un rôle, réinitialiser un mot de passe, **désactiver** un compte (sessions coupées immédiatement).
- Blocage temporaire après 5 essais ratés. Mots de passe hachés.
- **Journal d'actions** : qui a fait quoi et quand.

### Rôles (privilèges détaillés au fur et à mesure)
| Rôle | Privilèges connus |
| --- | --- |
| Serveur | Plan des tables, commandes, confirmer/rejeter les commandes QR, saisir une commande, demander l'encaissement et l'addition, remise 20 %, annulation, transfert d'article, changement de table, offrir un article, marquer un article en rupture |
| Barista | Achats, pointer l'arrivage de marchandise, déclarer les avaries, enregistrer les offres café du staff et des patrons |
| Chef | À définir |
| Manager | Comptes et rôles, édition du menu (articles, photos, prix, codes, horaires), tout voir |
| Patron | À définir (probablement tout voir) |

Tout le monde a la PWA sur son téléphone et peut y accéder à tout moment ; ce qu'il voit dépend de son rôle.

### Shifts et notifications
- Le serveur **démarre son shift** dans l'app et le termine en fin de service. 1 ou 2 serveurs par shift.
- Les nouvelles commandes QR sont notifiées (son + notification push) **uniquement aux serveurs en shift**.

### Écrans du serveur (mini-caisse)
- **Plan des tables** : état de chaque table (libre / occupée), montant en cours.
- **Commandes QR entrantes** : table, lignes, notes, heure → **Confirmer** (après vérification avec la table) ou **Rejeter**.
- **Saisir une commande** pour un client sans téléphone : choisir la table, ajouter articles + notes, envoyer. Pas de confirmation nécessaire.
- **Encaisser une table** et **imprimer l'addition** (voir questions ouvertes).
- **Remise de 20 %** — **note obligatoire** (raison). Saisie en caisse par l'agent.
- **Annuler un article** — **note obligatoire** (raison). Saisie en caisse par l'agent.
- **Transférer un article** d'une table à une autre. Saisi en caisse par l'agent.
- **Changer de table** (déplacer toute la table vers une autre). Saisi en caisse par l'agent.
- **Offrir un article** : enregistré **uniquement dans l'app**, **jamais tapé en caisse**. Cas : client mécontent, offres du staff, offres des patrons. Qui, quoi, à qui, pourquoi (note).
- **Rupture** : marquer un article indisponible / disponible.

Toutes ces actions sont inscrites au journal d'actions (qui, quand, quelle table, quelle note).
- Une commande en échec côté caisse est signalée clairement pour être terminée à la main.

## 6. Flux d'une commande

1. Le client scanne le QR → menu → commande avec notes → envoi.
2. Les serveurs en shift sont notifiés.
3. Un serveur vérifie avec la table → **Confirmer** (ou Rejeter si fausse commande).
4. La commande confirmée entre dans la **file caisse**.
5. L'agent saisit la commande dans LegacyPOS quand la caisse est libre.
6. Le serveur apporte la commande ; plus tard encaisse et imprime l'addition.

Commande tapée par un serveur : on démarre directement à l'étape 4.

## 7. Agent caisse (`pos-agent/`)

- Python + pywinauto, sur le PC de caisse Windows, à côté de LegacyPOS.
- Pilote uniquement l'**interface** de LegacyPOS. Jamais sa base de données ni ses fichiers.
- Repère les contrôles **par nom** (les boutons de LegacyPOS ont des noms visibles), jamais par coordonnées.
- **Un seul PIN caisse** dédié, stocké uniquement dans le `.env` du PC de caisse. Si l'écran PIN apparaît, l'agent le tape et continue.
- **File unique** : une action à la fois (commande, encaissement, addition…).
- **Partage de la caisse avec les humains** :
  - l'agent n'agit que si personne n'a touché souris/clavier depuis quelques secondes **et** si l'écran est le plan des tables ;
  - bandeau « Saisie automatique en cours — ne touchez pas » pendant l'action ;
  - si un humain touche pendant l'action : arrêt immédiat, attente, vérification, reprise propre.
- Vérifie l'écran attendu avant chaque étape ; sinon s'arrête, ne devine jamais, signale l'échec au serveur, journalise tout.
- Démarre avec Windows.

## 8. Émulateur LegacyPOS (`pos-emulator/`)

- Application Windows qui reproduit les écrans de LegacyPOS utilisés par l'agent, **avec les mêmes noms de contrôles** : écran PIN, plan des tables, saisie par code produit, note, validation, retour au plan ; puis encaissement et addition.
- Construit à partir de la vidéo de saisie réelle (`docs/pos.md`).
- Sert à tester tous les cas d'erreur avant livraison : code inconnu, écran inattendu, PIN redemandé, humain qui clique pendant la saisie, LegacyPOS fermé, lenteurs.
- L'agent ne doit pas savoir s'il parle à l'émulateur ou au vrai LegacyPOS.

## 9. Hors périmètre (pour l'instant)

- Paiement en ligne, comptes clients, fidélité, livraison.
- Suivi de commande côté client (optionnel, plus tard).

## 10. Panne

- Internet coupé : données mobiles, ou retour à la méthode classique (le serveur saisit à la caisse).
- Agent en panne : la caisse reste utilisable à la main ; les commandes en attente sont signalées.

## 11. Questions ouvertes (à trancher après la vidéo)

1. **Encaisser** depuis l'app : l'agent encaisse-t-il dans LegacyPOS (espèces/carte), ou l'encaissement reste-t-il au comptoir ?
2. **Imprimer l'addition** depuis l'app : l'agent déclenche-t-il l'impression dans LegacyPOS ?
3. **Remise 20 %** : sur toute la table ou sur un article ? Toujours 20 % exactement ? Réservée à certains rôles ?
3b. **Annulation** : LegacyPOS demande-t-il un PIN ou une autorisation spéciale pour annuler un article déjà saisi ?
3c. **Offert** : peut-on offrir un article déjà commandé (il ne faut alors pas le taper en caisse, ou l'annuler s'il y est déjà) ? L'offert compte-t-il dans le stock du barista ?
3d. Diviser l'addition : nécessaire ?
4. **Plan des tables** : reproduire la disposition de la salle de LegacyPOS ?
5. **Plat de la semaine** : même code chaque semaine (la manager change nom/photo/prix) ou nouveau code ?
6. Après validation, LegacyPOS revient-il bien au plan des tables sans PIN ? Qu'est-ce qui fait sortir du plan des tables ?
7. Privilèges des rôles Chef et Patron.
