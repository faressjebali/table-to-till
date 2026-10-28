# Spécification produit — Coffee QR

Ce que nous construisons et quand une fonctionnalité est « terminée ». Si quelque chose manque ou n'est pas clair : demander, ne pas inventer.

Version 2 — refonte du 15 octobre 2026. Clôture de shift et rapports de la manager ajoutés le 15 octobre 2026 (v1.7 du contrat). Caisse unique (principal et renfort), passation, commandes des managers : 15 octobre 2026 (v1.8). Fin de journée sans blocage, numéro des clôtures, file caisse après un échec : 16 octobre 2026 (v1.8.2). Comptable, tables d'offre, notes jamais en caisse : 17 octobre 2026 (v1.9). Demandes d'achat, dépenses fournisseurs, inventaire hebdomadaire : 17 octobre 2026 (v1.9.2). Offres saisies par un serveur, table encaissée : 17 octobre 2026 (v1.9.3). Deux principaux pendant la passation, vente directe encaissée depuis l'app, remise sur toute la table, transferts entre tables réelles, code admin de l'agent : 17 octobre 2026 (v2.0). Écran bar / cuisine, shift du barista et du cuisinier, transfert de toute la caisse à un renfort, vente directe gardée par son principal, liste « Offres staff » : 19 octobre 2026 (v2.1). Shift 2 choisi au démarrage, transfert vers une table libre : 19 octobre 2026 (v2.2). Relevé de la caisse (X / Z) à la clôture et ventes tapées à la main : 28 octobre 2026 (contrat à venir).

## 1. Contexte

- Coffee shop réel en Tunisie, 24 tables (plus 16 tables fictives : 5 pour les ventes directes, 11 tables d'offre ; voir `docs/tables.csv`), **86 articles** (voir `docs/menu/menu.csv`).
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

- Source : le menu papier actuel (food refait et jus d'orange ajouté le 24 octobre 2026). 86 articles : les 83 du menu papier, avec la formule burger du Kids Menu et le Cookie comptés deux fois (ils existent chacun en deux articles en caisse : Kids Menu (Cookie) / Kids Menu (Pancakes), Cookie chocolat / Cookie pomme cannelle), + le Plat de la semaine, qui n'est pas sur la carte.
- Catégories, dans l'ordre du menu papier :
  - Food (44) : Formules petit-déjeuner (3), Œufs (3), Extras (11), Salades (2), Plats (3), Starters (3), Sandwichs (3), Cakes & Sweets (7), Extras sucrés (4), Kids Menu (4 : la formule burger en deux articles, Croque-monsieur, Pancakes au chocolat), Plat de la semaine (1).
  - Boissons (42) : Jus (7), Fresh Blends (4), Thé & Infusion (9), Cafés (13), Matcha (4), Healthy Shots (3), Eau (2).
  - Sur le menu papier, « Extras sucrés » est titré « Extras ». Les Pommes cannelle caramélisées sont proposées sous les Pancakes et le Pain perdu.
- **Pas de tailles.** Chaque article a un prix fixe.
- **Chaque article a un code produit** LegacyPOS, affiché sur son bouton en caisse. L'agent reconnaît l'article à ce **code**, jamais à son nom (on ne peut pas taper un code : il ouvre la catégorie et touche le bouton qui porte le code).
- **Une photo par article.**
- **Deux menus complets : français et anglais** (noms et descriptions). « مرطبات اليوم » reste tel quel.
- **Extras** (avocat, champignons, bacon…) : ce sont des **articles normaux** avec leur prix et leur code. Ils apparaissent :
  - dans une section « Extras » de la catégorie, toujours visible ;
  - en **suggestions dans la fiche de certains plats** (ex. Cheese Burger : +Bacon de bœuf, +Œuf, +Gouda…) : le client ne les voit qu'en ouvrant l'article, et seulement ceux de cet article (pas de Caramel dans la fiche du Cheese Burger). Rien n'est affiché sous le plat dans la carte.
  Dans les deux cas, ils arrivent en caisse comme **une ligne séparée**.
- **Formules et articles à choix** (formules petit-déj, Kids Menu) : le client **choisit dans des listes** (café ou thé, jus, œufs), pas dans une note libre. La formule burger du Kids Menu (cookie ou pancakes au chocolat) et le Cookie (chocolat ou pomme cannelle) sont chacun **deux articles distincts** en caisse ; le choix du jus de la formule burger reste une liste.
  - Dans une formule, le client peut prendre un **thé à 6,5 DT** ou un **café jusqu'à 8,5 DT** de la carte, et **n'importe quel jus de saison**.
  - Les jus de saison changent : pour l'instant, seulement **Grenade**. La liste doit être modifiable par la manager. Si le jus de saison est en rupture, la manager le remplace dans la liste par un autre jus de la carte (sinon les formules avec jus ne peuvent plus être commandées).
  - Les choix sont enregistrés dans l'app pour le **calcul du stock** (traçabilité).
  - En caisse, l'agent tape **seulement la formule**, sans les choix ; il n'ajoute jamais la boisson, le jus ou les œufs inclus. Le bar et la cuisine voient les choix sur leur **écran bar / cuisine** (voir § 5).
- **Une note libre par ligne** (max 200 caractères, ex. « sans sucre »), en plus des choix. Elle n'est **jamais tapée en caisse** (le bouton NOTE de LegacyPOS n'est pas utilisé) : elle reste dans l'app et s'affiche sur l'écran bar / cuisine.
- **Horaires de disponibilité** (fuseau Africa/Tunis), appliqués automatiquement :
  - Formules petit-déjeuner : 8h00–12h00
  - Œufs : 8h00–15h00
  - Plat de la semaine : lundi au vendredi, 8h00–15h00
  - Autres articles : pendant l'ouverture (8h00–22h00)
  Hors horaire, l'article est masqué du menu QR et refusé par le serveur. Avant l'ouverture et après la fermeture (22h00), seul le **menu QR** est bloqué : les serveurs peuvent encore saisir une commande, mais les horaires propres des articles (formules, œufs, Plat de la semaine) s'appliquent toujours.
- **Plat de la semaine** : choisi en début de semaine. La manager le met à jour dans l'app (nom FR/EN, description, photo, prix, code) et le crée elle-même dans LegacyPOS. L'agent le saisit ensuite par son code, comme tout autre article. Le code peut changer chaque semaine : seul compte que la manager saisisse dans l'app le même code que dans la caisse.
- **Nouvel article** : la manager le crée d'abord dans LegacyPOS (nom, prix) pour obtenir son code, puis dans l'app avec le bouton « Ajouter un article » : catégorie, nom et description FR/EN, photo, prix, code, poste (`station`), horaires. L'agent reçoit ce code dans chaque tâche caisse.
- **Le prix doit être identique dans l'app et dans la caisse.** Un changement de prix se fait dans les deux le même jour : sinon l'agent s'arrête avant d'encaisser (total différent).
- Un **nouveau jus de saison** est un article normal du menu (vendu seul aussi) ; la manager l'ajoute ensuite à la liste des jus de saison.
- **Rupture** : un article peut être marqué indisponible à tout moment ; il est grisé immédiatement chez les clients. Qui la marque dépend du poste de l'article (colonne `station` de `menu.csv`) :
  - articles du bar (boissons) : le **barista** ;
  - articles de la cuisine : le **cuisinier** ;
  - Carrot cake, Fondant au chocolat, Cookie, Granola, Extras sucrés, Formules petit-déjeuner et formule burger du Kids Menu (`both`) : barista **ou** cuisinier ;
  - le **serveur en shift** et la **manager** peuvent marquer n'importe quel article.
- Deux espressos distincts : **Espresso** (6,5 DT) et **Espresso premium** (9,5 DT), chacun avec son code.

## 4. Menu QR (`customer-web/`)

- Un QR par table, contenant un **jeton aléatoire** (pas le numéro de table). Jeton inconnu → message « demandez au serveur ».
- Langue au choix FR / EN, mémorisée sur le téléphone.
- Affichage par catégorie, comme le menu papier actuel : nom, description, prix (`12 DT`, `5,5 DT`), photo.
- Fiche article : photo, description, extras suggérés de cet article seulement (ajoutables en un tap ; jamais affichés dans la carte), quantité (1–20), note.
- Panier : lignes, quantités, total, modifier/supprimer. Envoi → écran « Commande envoyée, un serveur va la confirmer ».
- Erreur (réseau, article devenu indisponible) : le panier est conservé, message clair.
- La table peut commander plusieurs fois.
- **Café fermé** (avant 8h00 ou après 22h00) : la commande QR est refusée avec son propre message (« le café est fermé, demandez au serveur »), différent de celui d'un article hors de ses horaires, que le client retire simplement de son panier.
- **Aucun serveur en shift** (après la clôture du soir par exemple) : la commande QR est refusée, avec un message clair (« commandez au comptoir »).
- Une commande non confirmée **expire après 5 minutes** (délai réglable) ; le client en est informé (« appelez un serveur »), son panier est conservé.
- Rapide sur données mobiles (photos compressées, chargement progressif).

## 5. App staff (`staff-app/`)

### Comptes et connexion
- **Un compte par personne.** Identifiant (numéro de téléphone ou nom d'utilisateur) + mot de passe.
- Connexion **une fois par téléphone**, session de **30 jours**.
- La **manager crée les comptes** avec un mot de passe temporaire et attribue un **rôle**. Changement de mot de passe obligatoire à la première connexion.
- La manager peut changer un rôle, réinitialiser un mot de passe, **désactiver** un compte (sessions coupées immédiatement). On ne peut pas se désactiver soi-même ni retirer son propre rôle de manager ; il reste toujours au moins un manager actif.
- Blocage temporaire après 5 essais ratés. Mots de passe hachés.
- **Journal d'actions** : qui a fait quoi et quand.

### Rôles (privilèges détaillés au fur et à mesure)
| Rôle | Privilèges connus |
| --- | --- |
| Serveur | **En shift seulement** (voir Shifts : principal ou renfort) : plan des tables, commandes, confirmer/rejeter les commandes QR et les commandes offertes des managers et du comptable, saisir une commande (y compris sur une table d'offre), transfert d'article, changement de table, imprimer l'addition, ruptures de tout article. **Principal seulement** (sur ses propres tables pendant une passation) : encaisser, vente directe, remise staff 20 %, annulation, offrir un article, dépenses, clôture. Hors shift : seulement « Démarrer mon shift » |
| Barista | **En shift seulement** : écran bar (commandes à préparer, **Prêt**), saisir et encaisser une vente directe (comptoir), ruptures des articles du bar (+ articles `both`), pointer les arrivages du bar, déclarer les avaries du bar, saisir l'inventaire du bar, ajouter à la liste **« Offres staff »** (pas aux clients). À tout moment : **demandes d'achat** (envoyées aux managers). Hors shift : sinon seulement « Démarrer mon shift » |
| Cuisinier | **En shift seulement** : écran cuisine (commandes à préparer, **Prêt**), ruptures des articles de la cuisine (+ articles `both`), pointer les arrivages de la cuisine, déclarer les avaries de la cuisine, saisir l'inventaire de la cuisine, ajouter à la liste **« Offres staff »** (pas aux clients). À tout moment : **demandes d'achat** (ce qu'il faut racheter, envoyées aux managers). Hors shift : sinon seulement « Démarrer mon shift » |
| Manager | Comptes et rôles, édition du menu (articles, photos, prix, codes, horaires, Plat de la semaine, jus de saison), ruptures, rapports (CA, articles sortis, clôtures, statistiques), rapports de stock et d'écarts, reçoit les **demandes d'achat** (et appelle les fournisseurs), **commander sur sa table d'offre** et sur les tables d'offre sans compte, pour soi ou pour offrir à un client (voir Tables d'offre). **Pas** d'accès au plan des tables ni aux commandes des clients |
| Comptable | Rapports (CA, espèces / carte, dépenses, articles sortis, clôtures et PDF, statistiques), rapports de stock et d'écarts, **commander sur sa table d'offre**. Ne modifie rien (ni menu, ni prix, ni comptes) ; **pas** d'accès au plan des tables ni aux commandes |

Le rôle Manager regroupe les **2 managers et les 3 patrons** : tous ont le même rôle et les mêmes droits. Chaque compte a un **titre affiché** (Manager, Patron, Patronne, Comptable…) sur le PDF et dans le journal, sans droits particuliers. Le **comptable** a son propre rôle, parce que ses droits sont différents.

La manager ne peut pas changer le rôle d'un serveur en shift ni le désactiver : il doit d'abord terminer son shift.

Tout le monde a la PWA sur son téléphone et peut y accéder à tout moment ; ce qu'il voit dépend de son rôle. Le staff a des iPhone : sur iPhone, la PWA doit être **installée sur l'écran d'accueil** (iOS 16.4+), sinon les notifications ne marchent pas ; l'app le demande.

Le plan des tables et les commandes sont gérés **entièrement par les serveurs en shift**, consultation comprise : ni la manager ni le comptable (sauf leurs propres commandes offertes), ni un serveur hors shift n'y ont accès. Le barista et le cuisinier en shift voient seulement les lignes à préparer de leur poste (écran bar / cuisine), pas le plan. Un serveur, un barista ou un cuisinier hors shift voit seulement « Démarrer mon shift » (le barista et le cuisinier gardent les demandes d'achat).

### Écran bar / cuisine
- Le barista et le cuisinier **démarrent leur shift** dans l'app en arrivant (sans argent ni clôture) et le terminent en partant ; un oubli se termine dans la nuit (4h00, comme les serveurs). La clôture des serveurs ne termine pas leur shift.
- En shift, ils voient **toutes les commandes confirmées** (QR, saisies par un serveur, ventes directes, commandes des tables d'offre), les plus anciennes d'abord : la table (ou la table d'offre et la personne, ex. « 103 Nour Ben Salem »), l'heure et **les lignes de leur poste** (colonne `station` : `bar` au barista, `kitchen` au cuisinier, `both` aux deux), avec quantité, **note** et **choix** (formule : le bar voit le café ou thé et le jus, la cuisine les œufs).
- Chaque nouvelle commande est notifiée (son + notification push) aux baristas ou cuisiniers en shift concernés ; même quand c'est un serveur qui la saisit (ex. pour Hedi Mansour, qui n'a pas d'application).
- Bouton **Prêt** : la partie de leur poste disparaît de leur liste et les serveurs en shift sont notifiés (« Table 7 : boissons prêtes »).
- Une **annulation** d'une ligne pas encore prête l'affiche barrée « ANNULÉ » avec une alerte ; un transfert ou un changement de table met à jour le numéro de table.
- Personne en shift au bar ou en cuisine : la commande passe quand même (les bons papier de la caisse s'impriment toujours) ; ses lignes attendent dans la liste du poste, et le serveur qui confirme ou saisit voit « personne au bar » / « personne en cuisine » pour prévenir à l'oral.

### Shifts : principal et renfort
- **Une seule caisse.** D'habitude, il y a **un seul serveur principal** : il encaisse, gère l'argent, saisit les dépenses, fait la clôture. Pendant la passation (voir plus bas), **deux principaux** travaillent en même temps quelque temps : chacun encaisse ses propres tables et a sa propre clôture.
- Les jours chargés (week-end), un **renfort** vient aider (ex. 10h–18h) : il prend et confirme les commandes, saisit des commandes, sert, transfère des articles, change de table et imprime l'addition. Il **ne touche jamais à l'argent** (ni encaissement, ni remise, ni annulation, ni offert, ni dépense), sauf si le principal lui passe la caisse (il devient alors principal). Tout ce qu'il fait compte dans la caisse du principal de la table (ou du principal en cours hors des tables) ; le journal d'actions garde son nom.
- Le serveur **démarre son shift** dans l'app en arrivant. **Le premier arrivé est principal** ; les suivants choisissent « Je suis le Shift 2 » ou « Je suis renfort » (voir Passation). Un renfort termine son shift quand il veut ; s'il oublie, la dernière clôture de la journée le termine d'office.
- Deux créneaux : **Shift 1** (8h–15h) et **Shift 2** (15h–22h). Une **clôture par principal** : chaque principal clôture en partant. Les clôtures sont numérotées dans l'ordre de la journée : la clôture du premier principal est le Shift 1, la dernière le Shift 2, quelle que soit l'heure à laquelle il a fini ses tables.
- **Passation** : le serveur du Shift 2 se connecte, appuie sur « Démarrer mon shift » et choisit **« Je suis le Shift 2 »** (l'app pose la question quand un principal est déjà en shift ; l'autre réponse est « Je suis renfort »). À **15h00**, il devient **automatiquement principal**, quelle que soit son heure d'arrivée ; s'il arrive après 15h, il devient principal en démarrant son shift. Il n'y a rien à accepter. Il n'y a qu'un Shift 2 à la fois : si un autre serveur en shift l'a déjà choisi, l'app refuse (« X est déjà le Shift 2 ») et propose de démarrer en renfort.
  - À partir de ce moment, il est le **principal en cours** : les tables et les ventes directes qui s'ouvrent, les dépenses qu'il saisit, les offres staff et les commandes des tables d'offre comptent pour lui.
  - Le premier principal **reste principal de ses tables et de ses ventes directes encore ouvertes** (et de leurs nouvelles commandes) : il les encaisse ou les passe au nouveau principal, puis clôture. Si le barista encaisse au comptoir une de ses ventes directes, l'argent compte pour lui (le barista le lui remet). Sa clôture ne montre que sa caisse, pas ce que le nouveau principal a fait en même temps.
  - Un renfort reste renfort : il ne devient jamais principal à 15h, même arrivé l'après-midi (ex. 14h30–22h).
  - Si le serveur du Shift 2 arrive en retard, celui du Shift 1 reste seul principal jusqu'à son arrivée.
- **Passer la caisse à un renfort** (le principal doit partir avant l'heure, ou le Shift 2 est en retard) : le principal, s'il est seul principal, passe **toute sa caisse** à un renfort en shift : tables et ventes directes ouvertes, argent déjà encaissé, dépenses. Il **ne clôture pas** : son shift se termine et le renfort devient principal tout de suite. Le renfort fait la clôture, qui couvre toute la caisse depuis le début ; le PDF indique « caisse tenue par X jusqu'à 13h05, puis par Y ». Ce passage ne compte jamais comme la bascule : le serveur du Shift 2 devient principal à 15h00, ou à son arrivée s'il arrive plus tard, comme d'habitude. Il y a donc toujours une clôture par créneau.
- Le principal ne termine pas son shift tant qu'il a des tables ouvertes, sauf s'il les passe au principal en cours en clôturant.
- **Clôture forcée** : si le principal part sans clôturer (oubli, téléphone déchargé, urgence), la manager le remplace depuis l'app par un autre serveur en shift, qui devient principal **tout de suite** (sans pouvoir refuser), reçoit ses tables ouvertes et compte ses espèces ; en fin de journée sans autre serveur, elle termine le shift elle-même avec le montant compté, même s'il reste des tables ouvertes : elles sont fermées **non encaissées**, signalées sur le PDF et régularisées à la main en caisse. C'est noté au journal et sur le PDF (« clôture forcée par X »).
- **Fin de journée** : la dernière clôture (sans autre principal) est refusée tant qu'une table est ouverte (vente directe non encaissée comprise) ou qu'une commande attend une confirmation. Toutes les tables sont encaissées et fermées. Les renforts encore en shift terminent leur shift avec elle.
- **Shift oublié** : un shift resté ouvert se termine automatiquement dans la nuit (4h00, réglable). Si le principal n'avait pas clôturé, une **clôture automatique** est faite sans espèces comptées (« clôture manquante » sur le PDF, au journal et notifiée aux managers) ; ses tables encore ouvertes sont fermées non encaissées. Le lendemain matin, le menu QR n'accepte donc pas de commande tant que personne n'a démarré son shift.
- Les nouvelles commandes (QR et commandes offertes depuis l'app) sont notifiées (son + notification push) **à tous les serveurs en shift** ; le premier disponible confirme.

### Clôture
- Le principal appuie sur **Clôturer**, compte les espèces qu'il a encaissées et saisit le montant compté. S'il reste un autre principal (passation), ses tables encore ouvertes passent à celui-ci ; sinon c'est la fin de journée.
- **Relevé de la caisse** : pour voir les ventes tapées à la main sans l'app, chaque clôture compare le CA de LegacyPOS à celui de l'app. Avant le relevé, aucune tâche caisse ne doit être en échec ni en attente.
  - Le principal appuie sur « Imprimer le X » (« Imprimer le Z » à la dernière clôture) : la file caisse se met en pause (l'agent finit sa tâche en cours), l'app affiche « Vous pouvez imprimer », le principal imprime le ticket dans LegacyPOS, le photographie et saisit son montant et le montant « en instances », puis la file reprend. Le relevé est obligatoire pour valider la clôture.
  - Le **X** (relevé intermédiaire, ne remet rien à zéro, ne touche pas à la journée fiscale) et le **Z** (clôture fiscale de la journée) comptent les **commandes**, encaissées ou non, **remises et −1 déduits** ; « en instances » est le montant des tables encore ouvertes.
  - Comparaison **par période, pas par principal** : X ↔ CA net de tout ce que l'app a fait taper depuis le matin jusqu'à la pause, tous principaux confondus ; Z − X ↔ CA net de tout ce qui vient après le X ; « en instances » ↔ total des tables encore ouvertes dans l'app.
  - **Écart positif** (la caisse compte plus) : le principal déclare les **ventes tapées à la main** (articles, quantités, espèces ou carte). Elles ne passent jamais par l'agent ; elles comptent dans le stock, le CA, les espèces attendues et le PDF. Prix calculé par le serveur. L'écart restant est signalé aux managers. **Écart négatif** (l'app compte plus) : rien à déclarer, signalé aux managers.
  - Sans X : un seul principal toute la journée → seulement le Z, comparé à toute la journée. Caisse passée à un renfort → pas de X au passage ; le renfort fait le relevé à sa clôture, sur toute la période, et ce qu'il ignore reste dans l'écart signalé. Clôture forcée → le serveur qui remplace fait le relevé ; si la manager termine elle-même le shift, elle saisit le Z s'il a été imprimé, sinon comparaison « manquante ». Clôture automatique → comparaison « manquante » sur le PDF, notifiée aux managers ; un manager peut saisir le Z plus tard dans les rapports, sans changer le PDF archivé.
- Un **PDF de clôture par principal** est généré et archivé. Il couvre **sa caisse**, quel que soit le serveur (principal ou renfort) ou le poste (barista, cuisinier) qui a fait l'action : ses tables et ses ventes directes (ouvertes pendant qu'il était le principal en cours, ou reçues d'un autre principal), et ce qui n'est sur aucune table (dépenses, offres staff, commandes des tables d'offre) pendant qu'il était le principal en cours. Après un passage de caisse à un renfort (voir plus haut), la clôture du renfort couvre la caisse entière, depuis le début, avec les noms et l'heure du passage. Ce que le nouveau principal fait pendant que le premier finit ses tables n'y figure pas :
  - les articles vendus (quantités et montants) et le **CA** : les commandes confirmées de sa caisse, envoyées en caisse, moins les remises staff et les annulations **faites pendant qu'il avait la table**, même sur un article commandé avant (sur une table reçue, ou dans un créneau précédent) ; le PDF déjà archivé ne change jamais ;
  - les encaissements **espèces** et **carte** ;
  - les **dépenses** ;
  - les articles **offerts** (clients mécontents, liste « Offres staff ») et les **commandes des tables d'offre** (managers, patrons, comptable, invités), mentionnés à 0 DT avec la table d'offre et qui les a offerts ou commandés : ils ne comptent pas dans le CA mais sortent du stock ;
  - les articles **annulés**, avec leur note, en séparant ceux **déjà préparés** (perte de stock) et ceux **pas préparés**, et les annulations retirées (payées par le serveur) ;
  - les **espèces attendues** (espèces encaissées − dépenses ; pas de fond de caisse), les **espèces comptées** et l'**écart** ;
  - les tables passées à l'autre principal, et les tables fermées **non encaissées** (clôture forcée ou automatique) ;
  - le **relevé de la caisse** : photo du X ou du Z, montant saisi, CA de l'app sur la période, écart, ventes saisies à la main (déclarées par qui) et écart restant, ou « comparaison manquante ».

### Tables d'offre
- Des **tables fictives d'offre** (liste dans `docs/tables.csv`) servent à tout ce qui est offert hors clients mécontents et staff : une par manager, patron et comptable, et des tables sans compte (propriétaire du local, artistes, invitées, table de test). Elles ne servent jamais aux ventes directes et ne sont pas sur le plan.
- Tout ce qui est commandé sur une table d'offre est un **offert** : 0 DT, hors CA, **jamais tapé en caisse**, sorti du stock, et inscrit dans le PDF de clôture avec la table d'offre et qui l'a demandé (« commande de X », « offert à un client par X », « Hedi Mansour »…).
- Les **serveurs en shift** (principal et renfort) saisissent directement sur n'importe quelle table d'offre, sans confirmation, en choisissant qui l'a demandé (un manager ou le comptable) et si c'est pour un client : le PDF dit qui a offert.
- Un **manager** commande depuis son app sur sa table ou sur une table d'offre sans compte ; le **comptable** seulement sur sa table. Pour soi ou comme **offre à un client** (il le dit aussi oralement au serveur). Les **serveurs en shift sont notifiés** ; un serveur **confirme**, et la commande s'affiche sur l'écran bar / cuisine avec la table d'offre et la personne. Sans serveur en shift, la commande est refusée. Comme une commande QR, elle expire si personne ne la confirme.

### Dépenses
- Le principal saisit chaque dépense payée en espèces de la caisse : montant, motif (fournisseur, extra payé en espèces, achat courant comme les boîtes takeaway ou le papier, autre), note, photo du ticket facultative.
- Elle est déduite des espèces attendues de la clôture et inscrite au journal d'actions.
- Cas habituels :
  - **achats courants** (essuie-tout, pailles, boîtes takeaway…) : demandés oralement au serveur, achetés par la femme de ménage avec l'argent de la caisse ; à son retour, le principal photographie la facture et saisit la dépense ;
  - **fournisseur payé tout de suite** : il livre, le principal le paie avec la caisse, photographie la facture et saisit la dépense ;
  - **fournisseur payé plus tard** : réglé par la manager, rien n'est saisi côté argent dans l'app.
- Dans tous les cas, la marchandise livrée est **pointée comme arrivage** par le barista ou le cuisinier (§ 12), payée ou non.
- Les **demandes d'achat** du barista et du cuisinier ne sont pas des dépenses : elles disent aux managers quoi commander aux fournisseurs.

### Rapports de la manager
- **En temps réel** : CA, espèces / carte, dépenses et articles sortis (combien de jus, cafés…), pour la journée, le Shift 1 (8h–15h) ou le Shift 2 (15h–22h). Les créneaux des rapports se comptent **par horaire**, quelles que soient les clôtures ; une remise ou une annulation compte à l'heure où elle est faite ; l'argent compté est sur les PDF de clôture.
- **Par date** : les mêmes chiffres pour hier ou n'importe quel jour.
- **Clôtures** : tous les PDF de clôture, anciens compris.
- **Statistiques** (plus tard, aussi pour le comptable) : articles les plus et les moins vendus sur une période, ventes d'un article sur une période (ex. fondants vendus la semaine dernière), courbes.

### Écrans du serveur (mini-caisse)
- **Plan des tables** : reproduit la **disposition de la salle**, en deux plans : **Intérieur** et **Terrasse** (choix en haut de l'écran) ; état de chaque table (libre / occupée), montant en cours. Les tables fictives (ventes directes) n'y figurent pas ; l'app en attribue une libre automatiquement à chaque vente directe et affiche son numéro. Une table fictive n'est réutilisée qu'une fois la vente réellement encaissée dans LegacyPOS.
- **Commandes entrantes** (QR et commandes offertes depuis l'app) : table ou personne, lignes, notes, heure → **Confirmer** (après vérification avec la table) ou **Rejeter**.
- **Saisir une commande** pour un client sans téléphone : choisir la table, ajouter articles + notes, envoyer. Pas de confirmation nécessaire.
- **Encaisser une table** : le principal prend l'argent et appuie sur **Espèces** ou **Carte** dans l'app ; l'agent encaisse ensuite dans LegacyPOS. Une table se paie **en une seule fois** : pas de division de l'addition, pas de paiement mixte. Une fois encaissée, la table est libre : plus aucune remise, annulation ni transfert sur ses articles.
- **Imprimer l'addition** depuis l'app : l'agent lance l'impression dans LegacyPOS.
- **Remise staff de 20 %** : réservée aux **membres du staff**, toujours 20 % exactement, appliquée par le principal, **toujours sur toute la table** (les articles déjà commandés à ce moment-là, pas les suivants) : LegacyPOS ne sait pas remiser un seul article. **Note obligatoire** : pour qui est la remise, plus des détails si besoin. Saisie en caisse par l'agent.
- **Annuler un article** — **note obligatoire** (raison). En caisse, l'agent commande **−1** de l'article (un bon « −1 » s'imprime en cuisine). **Jamais sur le dernier article d'une table** : LegacyPOS plante. Dans ce cas, l'annulation reste **en attente** jusqu'à ce que la table ait d'autres articles (ex. le serveur saisit la commande du client suivant sur cette table), et l'app le montre au serveur. S'il n'y a plus de client (fin de journée), le principal **retire l'annulation** : l'article redevient normal et la table s'encaisse comme d'habitude (le serveur paie l'article) ; c'est noté au journal et sur le PDF.
  - Deux types d'annulation, à choisir à chaque fois : **déjà préparé** (l'article sort du stock : perte) ou **pas préparé** (rien ne sort du stock). En caisse, c'est le même −1. Annuler une partie d'une ligne (1 capuccino sur 3) **coupe la ligne en deux** : la ligne d'origine garde 2 capuccinos, une nouvelle ligne de 1 est annulée avec sa note.
- **Transférer un article** d'une table à une autre. Saisi en caisse par l'agent. Transférer une partie d'une ligne la coupe en deux de la même façon.
- **Changer de table** (déplacer toute la table vers une autre). Saisi en caisse par l'agent.
- Transfert et changement de table : **seulement entre tables réelles de la salle**, jamais depuis ou vers une table d'offre (un article déjà tapé deviendrait offert) ni une table de vente directe.
- Pendant une passation, un article transféré vers une **table libre** reste dans la caisse du principal de la table de départ (l'argent suit le client) ; vers une table occupée, il passe dans la caisse du principal de cette table.
- **Offrir un article** : enregistré **uniquement dans l'app**, à part des commandes, **jamais tapé en caisse**. Un article est offert **dès le départ** : on n'offre jamais un article déjà tapé. Deux cas :
  - **client mécontent** : réservé au principal, sur une table de clients ; qui, quoi, pourquoi (note obligatoire) ;
  - **liste « Offres staff »** : ce que le barista, le cuisinier ou le principal offrent au staff en shift (serveurs, baristas, cuisiniers, plongeur) ; une liste par créneau, qui repart à zéro à chaque clôture ; on note l'article, la quantité et qui l'a offert, sans nom de bénéficiaire (note facultative). Les managers, patrons et le comptable ne passent pas par là : ils commandent sur les tables d'offre, y compris pour offrir à un client (voir Tables d'offre). L'article offert **sort du stock**.

- Une tâche en échec côté caisse est signalée clairement à tous les serveurs en shift : chacun peut la **réessayer** ; seul le principal peut la marquer **faite à la main** au comptoir. Tant qu'elle n'est pas réglée, les tâches suivantes de **la même table** attendent (les autres tables continuent) : par exemple, si l'encaissement de la table 5 a échoué, la commande des clients suivants de la table 5 ne s'ajoute pas à l'ancienne addition. Une annulation, une remise ou un transfert d'un article pas encore tapé en caisse passe simplement après sa saisie.

Toutes ces actions sont inscrites au journal d'actions (qui, quand, quelle table, quelle note).

## 6. Flux d'une commande

1. Le client scanne le QR → menu → commande avec notes → envoi.
2. Les serveurs en shift (principal et renfort) sont notifiés.
3. Un serveur vérifie avec la table → **Confirmer** (ou Rejeter si fausse commande). Sans réponse, la commande expire (voir §4).
4. La commande confirmée entre dans la **file caisse** et s'affiche sur l'**écran bar / cuisine**. C'est la **confirmation** qui ouvre la session de la table si elle était libre : une commande en attente ne rend pas la table « occupée » et ne compte pas dans son montant (le plan affiche seulement « commande à confirmer »).
5. L'agent saisit la commande dans LegacyPOS quand la caisse est libre.
6. Le barista et le cuisinier préparent et appuient sur **Prêt** ; le serveur apporte la commande ; plus tard, l'addition est imprimée et le principal encaisse.

Commande tapée par un serveur : on démarre directement à l'étape 4.

**Vente directe (client pressé au comptoir)** : il ne scanne pas le QR. Le barista ou le principal saisit la commande dans l'app comme **vente directe** (étape 4) ; elle appartient au principal en cours au moment de la saisie (comme une table, elle reste à lui jusqu'à l'encaissement ou jusqu'à ce qu'il la passe en clôturant), et il faut un serveur en shift. L'app lui attribue une **table fictive** libre (ex. table 333) et l'agent la tape en caisse. La vente directe reste **ouverte** jusqu'à ce que le barista ou le principal prenne l'argent et appuie sur **Espèces** ou **Carte** dans l'app ; l'agent encaisse ensuite, dans l'ordre de la file. Tant qu'elle n'est pas encaissée, elle se corrige comme une table : remise staff et annulation par le principal (pas de transfert).

**Rien n'est jamais tapé directement en caisse** : toutes les ventes passent par l'app, ce qui est indispensable au calcul du stock.

## 7. Agent caisse (`pos-agent/`)

- Python + pywinauto, sur le PC de caisse Windows, à côté de LegacyPOS.
- Pilote uniquement l'**interface** de LegacyPOS. Jamais sa base de données ni ses fichiers.
- Repère les contrôles **par identifiant, nom ou texte** exposés à Windows (UI Automation, voir `docs/pos.md`), jamais par coordonnées. Trouve chaque article par le code affiché sur son bouton, en parcourant les catégories.
- L'agent tape le **code caisse commun aux serveurs** (pas le code admin) : toutes les tables sont ouvertes par le même utilisateur, il peut donc ouvrir n'importe laquelle. Ce code a les droits nécessaires (abandonner une vente, quantité négative, supprimer une ligne) et aucune fonction d'admin ; il est stocké uniquement dans le `.env` du PC de caisse. Si l'écran PIN apparaît, l'agent le tape et continue.
- **File unique** : une action à la fois (commande, encaissement, addition…).
- **Partage de la caisse avec les humains** :
  - l'agent n'agit que si personne n'a touché souris/clavier depuis quelques secondes **et** si l'écran est le plan des tables (ou l'écran PIN, qu'il remplit avant de continuer) ;
  - bandeau « Saisie automatique en cours — ne touchez pas » pendant l'action ;
  - si un humain touche pendant l'action : arrêt immédiat, attente, vérification, reprise propre.
- Vérifie l'écran attendu avant chaque étape ; sinon s'arrête, ne devine jamais, signale l'échec au serveur, journalise tout.
- Lancé **à la main chaque matin** par le staff, une fois le PC ouvert et LegacyPOS synchronisé avec NACEF (pas au démarrage de Windows, `docs/decisions.md` 26/10). Tant qu'il ne tourne pas, les tâches attendent dans la file et l'app staff affiche que l'agent ne répond pas.

## 8. Émulateur LegacyPOS (`pos-emulator/`)

- Application Windows qui reproduit les écrans de LegacyPOS utilisés par l'agent, **avec les mêmes noms de contrôles** : écran PIN, plan des tables, saisie de table (catégories, boutons d'articles avec leur code), validation, retour au plan ; puis encaissement et addition.
- Construit à partir de la vidéo de saisie réelle (`docs/pos.md`).
- Sert à tester tous les cas d'erreur avant livraison : code inconnu, écran inattendu, PIN redemandé, humain qui clique pendant la saisie, LegacyPOS fermé, lenteurs.
- L'agent ne doit pas savoir s'il parle à l'émulateur ou au vrai LegacyPOS.

## 9. Hors périmètre (pour l'instant)

- Paiement en ligne, comptes clients, fidélité, livraison.
- Suivi de commande côté client (optionnel, plus tard).

## 10. Panne

- Internet coupé : données mobiles, ou retour à la méthode classique (le serveur saisit à la caisse). C'est la seule exception à « rien n'est tapé directement en caisse » ; ces ventes sont rattrapées à la clôture : l'écart avec le X ou le Z les fait apparaître, et le principal les déclare comme ventes tapées à la main (§ 5 Clôture).
- Agent en panne : la caisse reste utilisable à la main ; les serveurs en shift et la manager voient que l'agent ne répond plus ; les commandes en attente sont signalées. Les ventes directes occupent chacune une table fictive jusqu'à leur encaissement (dans l'app, puis en caisse) : avec 5 tables de vente directe, la 6ᵉ est refusée tant que les précédentes ne sont pas encaissées et que l'agent n'a pas rattrapé son retard ; le comptoir passe alors à la méthode classique.

## 11. Questions ouvertes (à trancher après la vidéo)

Tranchées le 15/10/2026 (voir §5 et `docs/decisions.md`) : encaissement depuis l'app, addition depuis l'app, remise staff, annulation par −1, offert, pas de division de l'addition, plan selon la disposition de la salle, Plat de la semaine.

Restent :

1. ~~Après validation, LegacyPOS revient-il au plan sans PIN ?~~ Oui, en passant par la fenêtre « Choisir une action » (bouton de droite, plan) qui s'ouvre après VALIDER (vidéo du 16/10, corrigé le 26/10) ; le PIN est redemandé quand on ferme le plan (✕).
2. ~~Tables réelles, disposition, tables fictives et tables d'offre~~ : relevées le 16/10/2026, `docs/tables.csv`.
3. Écrans de remise, d'annulation (−1 sans code), de transfert et de changement de table, quantité > 1 (à filmer ; encaissement et addition filmés le 16/10).

## 12. Stock (fonctionnalité principale — à détailler)

- But : **tout calculer pour minimiser les écarts inexpliqués** entre le stock théorique et le stock réel.
- **Toutes les ventes passent par l'app** (QR, saisie serveur, comptoir) : une vente tapée directement en caisse sans l'app serait un écart inexpliqué. Le relevé de la caisse à chaque clôture (X / Z, § 5) la fait apparaître, et le principal la déclare pour qu'elle sorte du stock.
- Consommation théorique de chaque article vendu à partir des **fiches techniques** (bar et cuisine), y compris les choix précis dans les formules (type de café, thé, jus, œufs).
- Sorties hors ventes : offerts (clients mécontents, liste « Offres staff »), commandes des tables d'offre, annulations d'articles déjà préparés.
- Approvisionnement : arrivages (pointés à chaque livraison, payée ou non), avaries ; demandes d'achat aux managers. Seuls le **barista** (bar) et le **cuisinier** (cuisine) pointent arrivages, avaries et inventaire.
- **Inventaire manuel hebdomadaire obligatoire** (bar et cuisine). Rappel chaque **vendredi** au Shift 2 : notification au serveur en shift, au barista et au cuisinier ; les managers voient si l'inventaire n'a pas été fait.
- Règles détaillées du calcul et de l'approvisionnement : à définir ensemble.
