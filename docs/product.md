# Spécification produit — Coffee QR

Ce que nous construisons et quand une fonctionnalité est « terminée ». Si quelque chose manque ou n'est pas clair : demander, ne pas inventer.

Version 2 — refonte du 15 octobre 2026.

## 1. Contexte

- Coffee shop réel en Tunisie, environ 20 tables (plus des tables fictives pour les ventes directes), **97 articles** (voir `docs/menu/menu.csv`).
- Le café est ouvert de **8h00 à 22h00**.
- Le **calcul du stock** est une fonctionnalité principale (voir §12).
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

- Source : le menu papier actuel (food et boissons). 97 articles : les 94 du menu papier, avec le Kids Menu et le Cookie comptés deux fois (ils existent chacun en deux articles en caisse : Kids Menu (Cookie) / Kids Menu (Pancakes), Cookie chocolat / Cookie pomme cannelle), + le Plat de la semaine.
- Catégories, dans l'ordre du menu papier :
  - Food (56) : Formules petit-déjeuner (6), Œufs (3), Extras (14), Salades (3), Plats (3), Starters (5), Accompagnements (3), Sandwichs (4), Cakes & Sweets (8), Extras sucrés (4), Kids Menu (2), Plat de la semaine (1).
  - Boissons (41) : Jus (6), Fresh Blends (4), Thé & Infusion (9), Cafés (13), Matcha (4), Healthy Shots (3), Eau (2).
  - Sur le menu papier, « Accompagnements » et « Extras sucrés » sont titrés « Extras ». Les extras Œuf, Steak et Pommes cannelle caramélisées n'apparaissent qu'en suggestion (« + ») sous un plat.
- **Pas de tailles.** Chaque article a un prix fixe.
- **Chaque article a un code produit** LegacyPOS. L'agent saisit par **code**, jamais par nom.
- **Une photo par article.**
- **Deux menus complets : français et anglais** (noms et descriptions). « مرطبات اليوم » reste tel quel.
- **Extras** (avocat, champignons, bacon…) : ce sont des **articles normaux** avec leur prix et leur code. Ils apparaissent :
  - dans une section « Extras » de la catégorie ;
  - en **suggestions sous certains plats** (ex. Cheese Burger : +Bacon de bœuf, +Œuf, +Gouda…).
  Dans les deux cas, ils arrivent en caisse comme **une ligne séparée**.
- **Formules et articles à choix** (formules petit-déj, Kids Menu) : le client **choisit dans des listes** (café ou thé, jus, œufs), pas dans une note libre. Le Kids Menu (cookie ou pancakes) et le Cookie (chocolat ou pomme cannelle) sont chacun **deux articles distincts** en caisse ; le choix du jus du Kids Menu reste une liste.
  - Dans une formule, le client peut prendre **n'importe quel café ou thé** de la carte, et **n'importe quel jus de saison**.
  - Les jus de saison changent : pour l'instant, seulement **Grenade**. La liste doit être modifiable par la manager.
  - Les choix sont enregistrés dans l'app pour le **calcul du stock** (traçabilité).
  - En caisse, l'agent tape **seulement la formule**, sans les choix ; il n'ajoute jamais la boisson, le jus ou les œufs inclus. Le bar et la cuisine connaissent les choix **oralement**, par le serveur.
- **Une note libre par ligne** (max 200 caractères, ex. « sans sucre »), en plus des choix. Sur une formule, elle n'est **pas tapée en caisse** : elle reste dans l'app et le serveur la dit au bar ou à la cuisine.
- **Horaires de disponibilité** (fuseau Africa/Tunis), appliqués automatiquement :
  - Formules petit-déjeuner : 8h00–12h00
  - Œufs : 8h00–15h00
  - Plat de la semaine : lundi au vendredi, 8h00–15h00
  - Autres articles : pendant l'ouverture (8h00–22h00)
  Hors horaire, l'article est masqué du menu QR et refusé par le serveur.
- **Plat de la semaine** : choisi en début de semaine. La manager le met à jour dans l'app (nom FR/EN, description, photo, prix, code) et le crée elle-même dans LegacyPOS. L'agent le saisit ensuite par son code, comme tout autre article. Le code peut changer chaque semaine : seul compte que la manager saisisse dans l'app le même code que dans la caisse.
- **Rupture** : un article peut être marqué indisponible à tout moment ; il est grisé immédiatement chez les clients. Qui la marque dépend du poste de l'article (colonne `station` de `menu.csv`) :
  - articles du bar (boissons) : le **barista** ;
  - articles de la cuisine : le **cuisinier** ;
  - Carrot cake, Fondant au chocolat, Cookie, Formules petit-déjeuner et Kids Menu (`both`) : barista **ou** cuisinier ;
  - le **serveur** et la **manager** peuvent marquer n'importe quel article.
- Deux espressos distincts : **Espresso** (6,5 DT) et **Espresso premium** (9,5 DT), chacun avec son code.

## 4. Menu QR (`customer-web/`)

- Un QR par table, contenant un **jeton aléatoire** (pas le numéro de table). Jeton inconnu → message « demandez au serveur ».
- Langue au choix FR / EN, mémorisée sur le téléphone.
- Affichage par catégorie, comme le menu papier actuel : nom, description, prix (`12 DT`, `5,5 DT`), photo.
- Fiche article : photo, description, extras suggérés (ajoutables en un tap), quantité (1–20), note.
- Panier : lignes, quantités, total, modifier/supprimer. Envoi → écran « Commande envoyée, un serveur va la confirmer ».
- Erreur (réseau, article devenu indisponible) : le panier est conservé, message clair.
- La table peut commander plusieurs fois.
- **Aucun serveur en shift** : la commande QR est refusée, avec un message clair (« commandez au comptoir »).
- Une commande non confirmée **expire après 5 minutes** (délai réglable) ; le client en est informé (« appelez un serveur »), son panier est conservé.
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
| Serveur | Plan des tables, commandes, confirmer/rejeter les commandes QR, saisir une commande, encaisser n'importe quelle table (s'il est en shift), imprimer l'addition, remise staff 20 %, annulation, transfert d'article, changement de table, offrir un article, marquer n'importe quel article en rupture |
| Barista | Saisir et encaisser une vente directe (comptoir), ruptures des articles du bar (+ articles `both`), achats, pointer l'arrivage de marchandise, déclarer les avaries, enregistrer les offres café du staff et des patrons |
| Cuisinier | Ruptures des articles de la cuisine (+ articles `both`), pointer les arrivages de la cuisine, déclarer les avaries de la cuisine, saisir l'inventaire de la cuisine, signaler les besoins (ce qu'il faut racheter) |
| Manager | Comptes et rôles, édition du menu (articles, photos, prix, codes, horaires, Plat de la semaine, jus de saison), ruptures, tout voir |

Tout le monde a la PWA sur son téléphone et peut y accéder à tout moment ; ce qu'il voit dépend de son rôle.

### Shifts et notifications
- Le serveur **démarre son shift** dans l'app et le termine en fin de service. 1 ou 2 serveurs par shift.
- Les nouvelles commandes QR sont notifiées (son + notification push) **uniquement aux serveurs en shift**.

### Écrans du serveur (mini-caisse)
- **Plan des tables** : reproduit la **disposition de la salle** ; état de chaque table (libre / occupée), montant en cours. Les tables fictives (ventes directes) n'y figurent pas ; l'app en attribue une libre automatiquement à chaque vente directe et affiche son numéro.
- **Commandes QR entrantes** : table, lignes, notes, heure → **Confirmer** (après vérification avec la table) ou **Rejeter**.
- **Saisir une commande** pour un client sans téléphone : choisir la table, ajouter articles + notes, envoyer. Pas de confirmation nécessaire.
- **Encaisser une table** : n'importe quel serveur en shift prend l'argent et appuie sur **Espèces** ou **Carte** dans l'app ; l'agent encaisse ensuite dans LegacyPOS. Une table se paie **en une seule fois** : pas de division de l'addition, pas de paiement mixte.
- **Imprimer l'addition** depuis l'app : l'agent lance l'impression dans LegacyPOS.
- **Remise staff de 20 %** : réservée aux **membres du staff**, toujours 20 % exactement, appliquée par n'importe quel serveur en shift, sur **toute la table ou sur des articles choisis**. **Note obligatoire** : pour qui est la remise, plus des détails si besoin. Saisie en caisse par l'agent.
- **Annuler un article** — **note obligatoire** (raison). En caisse, l'agent commande **−1** de l'article (un bon « −1 » s'imprime en cuisine). **Jamais sur le dernier article d'une table** : LegacyPOS plante. Dans ce cas, l'annulation reste **en attente** jusqu'à ce que la table ait d'autres articles, et l'app le montre au serveur.
- **Transférer un article** d'une table à une autre. Saisi en caisse par l'agent.
- **Changer de table** (déplacer toute la table vers une autre). Saisi en caisse par l'agent.
- **Offrir un article** : enregistré **uniquement dans l'app**, **jamais tapé en caisse**. Un article est offert **dès le départ** : on n'offre jamais un article déjà tapé. Cas : client mécontent, offres du staff, offres des patrons. Qui, quoi, à qui, pourquoi (note). L'article offert **sort du stock**.

Toutes ces actions sont inscrites au journal d'actions (qui, quand, quelle table, quelle note).
- Une commande en échec côté caisse est signalée clairement pour être terminée à la main.

## 6. Flux d'une commande

1. Le client scanne le QR → menu → commande avec notes → envoi.
2. Les serveurs en shift sont notifiés.
3. Un serveur vérifie avec la table → **Confirmer** (ou Rejeter si fausse commande). Sans réponse, la commande expire (voir §4).
4. La commande confirmée entre dans la **file caisse**. C'est la **confirmation** qui ouvre la session de la table si elle était libre : une commande en attente ne rend pas la table « occupée » et ne compte pas dans son montant (le plan affiche seulement « commande à confirmer »).
5. L'agent saisit la commande dans LegacyPOS quand la caisse est libre.
6. Le serveur apporte la commande ; plus tard encaisse et imprime l'addition.

Commande tapée par un serveur : on démarre directement à l'étape 4.

**Vente directe (client pressé au comptoir)** : il ne scanne pas le QR. Le barista ou le serveur saisit la commande dans l'app comme **vente directe** (étape 4). En caisse, elle est tapée sur une **table fictive** (LegacyPOS en a beaucoup, ex. table 333). On prend l'argent et on appuie sur **Espèces** ou **Carte** dans l'app, sans attendre la caisse ; l'agent saisit puis encaisse, dans l'ordre de la file.

**Rien n'est jamais tapé directement en caisse** : toutes les ventes passent par l'app, ce qui est indispensable au calcul du stock.

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

- Internet coupé : données mobiles, ou retour à la méthode classique (le serveur saisit à la caisse). C'est la seule exception à « rien n'est tapé directement en caisse » ; il faudra rattraper ces ventes pour le stock (à définir).
- Agent en panne : la caisse reste utilisable à la main ; les commandes en attente sont signalées.

## 11. Questions ouvertes (à trancher après la vidéo)

Tranchées le 15/10/2026 (voir §5 et `docs/decisions.md`) : encaissement depuis l'app, addition depuis l'app, remise staff, annulation par −1, offert, pas de division de l'addition, plan selon la disposition de la salle, Plat de la semaine.

Restent :

1. Après validation, LegacyPOS revient-il bien au plan des tables sans PIN ? Qu'est-ce qui fait sortir du plan des tables ?
2. Nombre et numéros des tables réelles, disposition de la salle, liste des tables fictives (à relever à la visite).
3. Écrans d'encaissement, d'impression de l'addition, de remise, de transfert et de changement de table (à filmer).

## 12. Stock (fonctionnalité principale — à détailler)

- But : **tout calculer pour minimiser les écarts inexpliqués** entre le stock théorique et le stock réel.
- **Toutes les ventes passent par l'app** (QR, saisie serveur, comptoir) : une vente tapée directement en caisse sans l'app serait un écart inexpliqué.
- Consommation théorique de chaque article vendu à partir des **fiches techniques** (bar et cuisine), y compris les choix précis dans les formules (type de café, thé, jus, œufs).
- Approvisionnement : achats, arrivages, avaries, offres (barista).
- Règles détaillées du calcul et de l'approvisionnement : à définir ensemble.
