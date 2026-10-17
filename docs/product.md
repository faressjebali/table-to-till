# Spécification produit — Coffee QR

Ce que nous construisons et quand une fonctionnalité est « terminée ». Si quelque chose manque ou n'est pas clair : demander, ne pas inventer.

Version 2 — refonte du 15 octobre 2026. Clôture de shift et rapports de la manager ajoutés le 15 octobre 2026 (v1.7 du contrat). Caisse unique (principal et renfort), passation, commandes des managers : 15 octobre 2026 (v1.8). Fin de journée sans blocage, numéro des clôtures, file caisse après un échec : 16 octobre 2026 (v1.8.2). Comptable, tables d'offre, notes jamais en caisse : 17 octobre 2026 (v1.9).

## 1. Contexte

- Coffee shop réel en Tunisie, 24 tables (plus 16 tables fictives : 5 pour les ventes directes, 11 tables d'offre ; voir `docs/tables.csv`), **97 articles** (voir `docs/menu/menu.csv`).
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
  - Dans une formule, le client peut prendre un **thé à 6,5 DT** ou un **café jusqu'à 8,5 DT** de la carte, et **n'importe quel jus de saison**.
  - Les jus de saison changent : pour l'instant, seulement **Grenade**. La liste doit être modifiable par la manager.
  - Les choix sont enregistrés dans l'app pour le **calcul du stock** (traçabilité).
  - En caisse, l'agent tape **seulement la formule**, sans les choix ; il n'ajoute jamais la boisson, le jus ou les œufs inclus. Le bar et la cuisine connaissent les choix **oralement**, par le serveur.
- **Une note libre par ligne** (max 200 caractères, ex. « sans sucre »), en plus des choix. Elle n'est **jamais tapée en caisse** (le bouton NOTE de LegacyPOS n'est pas utilisé) : elle reste dans l'app et le serveur la dit au bar ou à la cuisine.
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
  - Carrot cake, Fondant au chocolat, Cookie, Granola, Fruits, Extras sucrés, Formules petit-déjeuner et Kids Menu (`both`) : barista **ou** cuisinier ;
  - le **serveur en shift** et la **manager** peuvent marquer n'importe quel article.
- Deux espressos distincts : **Espresso** (6,5 DT) et **Espresso premium** (9,5 DT), chacun avec son code.

## 4. Menu QR (`customer-web/`)

- Un QR par table, contenant un **jeton aléatoire** (pas le numéro de table). Jeton inconnu → message « demandez au serveur ».
- Langue au choix FR / EN, mémorisée sur le téléphone.
- Affichage par catégorie, comme le menu papier actuel : nom, description, prix (`12 DT`, `5,5 DT`), photo.
- Fiche article : photo, description, extras suggérés (ajoutables en un tap), quantité (1–20), note.
- Panier : lignes, quantités, total, modifier/supprimer. Envoi → écran « Commande envoyée, un serveur va la confirmer ».
- Erreur (réseau, article devenu indisponible) : le panier est conservé, message clair.
- La table peut commander plusieurs fois.
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
| Serveur | **En shift seulement** (voir Shifts : principal ou renfort) : plan des tables, commandes, confirmer/rejeter les commandes QR et les commandes offertes des managers et du comptable, saisir une commande (y compris sur une table d'offre), transfert d'article, changement de table, imprimer l'addition, ruptures de tout article. **Principal seulement** : encaisser, remise staff 20 %, annulation, offrir un article, dépenses, clôture et passation. Hors shift : seulement « Démarrer mon shift » |
| Barista | Saisir et encaisser une vente directe (comptoir), ruptures des articles du bar (+ articles `both`), achats, pointer l'arrivage de marchandise, déclarer les avaries, enregistrer les offres **au staff** (pas aux clients) |
| Cuisinier | Ruptures des articles de la cuisine (+ articles `both`), pointer les arrivages de la cuisine, déclarer les avaries de la cuisine, saisir l'inventaire de la cuisine, signaler les besoins (ce qu'il faut racheter), enregistrer les offres **au staff** (pas aux clients) |
| Manager | Comptes et rôles, édition du menu (articles, photos, prix, codes, horaires, Plat de la semaine, jus de saison), ruptures, rapports (CA, articles sortis, clôtures, statistiques), rapports de stock et d'écarts, **commander sur sa table d'offre** et sur les tables d'offre sans compte, pour soi ou pour offrir à un client (voir Tables d'offre). **Pas** d'accès au plan des tables ni aux commandes des clients |
| Comptable | Rapports (CA, espèces / carte, dépenses, articles sortis, clôtures et PDF), rapports de stock et d'écarts, **commander sur sa table d'offre**. Ne modifie rien (ni menu, ni prix, ni comptes) ; **pas** d'accès au plan des tables ni aux commandes |

Le rôle Manager regroupe les **2 managers et les 3 patrons** : tous ont le même rôle et les mêmes droits. Chaque compte a un **titre affiché** (Manager, Patron, Patronne, Comptable…) sur le PDF et dans le journal, sans droits particuliers. Le **comptable** a son propre rôle, parce que ses droits sont différents.

La manager ne peut pas changer le rôle d'un serveur en shift ni le désactiver : il doit d'abord terminer son shift.

Tout le monde a la PWA sur son téléphone et peut y accéder à tout moment ; ce qu'il voit dépend de son rôle. Le staff a des iPhone : sur iPhone, la PWA doit être **installée sur l'écran d'accueil** (iOS 16.4+), sinon les notifications ne marchent pas ; l'app le demande.

Le plan des tables et les commandes sont gérés **entièrement par les serveurs en shift**, consultation comprise : ni la manager ni le comptable (sauf leurs propres commandes offertes), ni le barista, ni le cuisinier, ni un serveur hors shift n'y ont accès. Un serveur hors shift voit seulement « Démarrer mon shift ».

### Shifts : principal et renfort
- **Une seule caisse.** À tout moment, il y a au plus **un serveur principal** : il encaisse, gère l'argent, saisit les dépenses, fait la clôture. D'habitude, il est seul.
- Les jours chargés (week-end), un **renfort** vient aider (ex. 10h–18h) : il prend et confirme les commandes, saisit des commandes, sert, transfère des articles, change de table et imprime l'addition. Il **ne touche jamais à l'argent** (ni encaissement, ni remise, ni annulation, ni offert, ni dépense). Tout ce qu'il fait compte dans la caisse du principal ; le journal d'actions garde son nom.
- Le serveur **démarre son shift** dans l'app en arrivant. **Le premier arrivé est principal**, le suivant est renfort. Un renfort termine son shift quand il veut ; s'il oublie, la dernière clôture de la journée le termine d'office.
- Deux créneaux : **Shift 1** (8h–15h) et **Shift 2** (15h–22h). Une **clôture par créneau** : le principal clôture en partant. Les clôtures sont numérotées dans l'ordre de la journée : la clôture de la passation est le Shift 1, la dernière le Shift 2, quelle que soit l'heure de la passation.
- **Passation** : au changement de créneau, le principal clôture et choisit le serveur en shift à qui il passe la main (en général celui du Shift 2, déjà arrivé). Celui-ci reçoit la demande et l'accepte : il devient principal et reçoit les tables encore ouvertes et les commandes en attente. Tant qu'elle n'est pas acceptée, le principal reste principal. Un renfort reste renfort.
- Le principal ne termine pas son shift tant qu'il a des tables ouvertes : il les encaisse ou les passe au serveur suivant (passation). Si le serveur du Shift 2 arrive en retard, celui du Shift 1 continue jusqu'à la passation.
- **Clôture forcée** : si le principal part sans clôturer (oubli, téléphone déchargé, urgence), la manager le remplace depuis l'app par un autre serveur en shift, qui compte les espèces et devient principal ; en fin de journée sans autre serveur, elle termine le shift elle-même avec le montant compté, même s'il reste des tables ouvertes : elles sont fermées **non encaissées**, signalées sur le PDF et régularisées à la main en caisse. C'est noté au journal et sur le PDF (« clôture forcée par X »).
- **Fin de journée** : la dernière clôture (sans passation) est refusée tant qu'une table est ouverte ou qu'une commande attend une confirmation. Toutes les tables sont encaissées et fermées. Les renforts encore en shift terminent leur shift avec elle.
- **Shift oublié** : un shift resté ouvert se termine automatiquement dans la nuit (4h00, réglable). Si le principal n'avait pas clôturé, une **clôture automatique** est faite sans espèces comptées (« clôture manquante » sur le PDF, au journal et notifiée aux managers) ; ses tables encore ouvertes sont fermées non encaissées. Le lendemain matin, le menu QR n'accepte donc pas de commande tant que personne n'a démarré son shift.
- Les nouvelles commandes (QR et commandes offertes depuis l'app) sont notifiées (son + notification push) **à tous les serveurs en shift** ; le premier disponible confirme.

### Clôture
- Le principal appuie sur **Clôturer**, compte les espèces de la caisse et saisit le montant compté ; puis passation (voir plus haut) ou fin de journée.
- Un **PDF de clôture par créneau** est généré et archivé. Il couvre tout ce qui s'est passé depuis la clôture précédente, quel que soit le serveur (principal ou renfort) ou le poste (barista, cuisinier) :
  - les articles vendus (quantités et montants) et le **CA** : toutes les commandes confirmées, envoyées en caisse, moins les remises staff et les annulations **faites pendant le créneau**, même sur un article commandé au créneau précédent (le PDF déjà archivé ne change jamais) ;
  - les encaissements **espèces** et **carte** ;
  - les **dépenses** ;
  - les articles **offerts** (clients mécontents, staff) et les **commandes des tables d'offre** (managers, patrons, comptable, invités), mentionnés à 0 DT avec la table d'offre et qui les a offerts ou commandés : ils ne comptent pas dans le CA mais sortent du stock ;
  - les articles **annulés**, avec leur note, en séparant ceux **déjà préparés** (perte de stock) et ceux **pas préparés**, et les annulations retirées (payées par le serveur) ;
  - les **espèces attendues** (espèces encaissées − dépenses ; pas de fond de caisse), les **espèces comptées** et l'**écart** ;
  - les tables passées au principal suivant, et les tables fermées **non encaissées** (clôture forcée ou automatique).

### Tables d'offre
- Des **tables fictives d'offre** (liste dans `docs/tables.csv`) servent à tout ce qui est offert hors clients mécontents et staff : une par manager, patron et comptable, et des tables sans compte (propriétaire du local, artistes, invitées, table de test). Elles ne servent jamais aux ventes directes et ne sont pas sur le plan.
- Tout ce qui est commandé sur une table d'offre est un **offert** : 0 DT, hors CA, **jamais tapé en caisse**, sorti du stock, et inscrit dans le PDF de clôture avec la table d'offre et qui l'a demandé (« commande de X », « offert à un client par X », « Hedi Mansour »…).
- Les **serveurs en shift** (principal et renfort) saisissent directement sur n'importe quelle table d'offre, sans confirmation.
- Un **manager** commande depuis son app sur sa table ou sur une table d'offre sans compte ; le **comptable** seulement sur sa table. Pour soi ou comme **offre à un client** (il le dit aussi oralement au serveur). Les **serveurs en shift sont notifiés** ; un serveur **confirme** et dit la commande oralement au barista ou au cuisinier. Sans serveur en shift, la commande est refusée. Comme une commande QR, elle expire si personne ne la confirme.

### Dépenses
- Le principal saisit chaque dépense payée en espèces de la caisse : montant, motif (fournisseur, extra payé en espèces, achat courant comme les boîtes takeaway ou le papier, autre), note, photo du ticket facultative.
- Elle est déduite des espèces attendues de la clôture et inscrite au journal d'actions.

### Rapports de la manager
- **En temps réel** : CA, espèces / carte, dépenses et articles sortis (combien de jus, cafés…), pour la journée, le Shift 1 (8h–15h) ou le Shift 2 (15h–22h). Les créneaux des rapports se comptent **par horaire**, quelles que soient les clôtures ; une remise ou une annulation compte à l'heure où elle est faite ; l'argent compté est sur les PDF de clôture.
- **Par date** : les mêmes chiffres pour hier ou n'importe quel jour.
- **Clôtures** : tous les PDF de clôture, anciens compris.
- **Statistiques** (plus tard) : articles les plus et les moins vendus sur une période, ventes d'un article sur une période (ex. fondants vendus la semaine dernière), courbes.

### Écrans du serveur (mini-caisse)
- **Plan des tables** : reproduit la **disposition de la salle** ; état de chaque table (libre / occupée), montant en cours. Les tables fictives (ventes directes) n'y figurent pas ; l'app en attribue une libre automatiquement à chaque vente directe et affiche son numéro. Une table fictive n'est réutilisée qu'une fois la vente réellement encaissée dans LegacyPOS.
- **Commandes entrantes** (QR et commandes offertes depuis l'app) : table ou personne, lignes, notes, heure → **Confirmer** (après vérification avec la table) ou **Rejeter**.
- **Saisir une commande** pour un client sans téléphone : choisir la table, ajouter articles + notes, envoyer. Pas de confirmation nécessaire.
- **Encaisser une table** : le principal prend l'argent et appuie sur **Espèces** ou **Carte** dans l'app ; l'agent encaisse ensuite dans LegacyPOS. Une table se paie **en une seule fois** : pas de division de l'addition, pas de paiement mixte.
- **Imprimer l'addition** depuis l'app : l'agent lance l'impression dans LegacyPOS.
- **Remise staff de 20 %** : réservée aux **membres du staff**, toujours 20 % exactement, appliquée par le principal, sur **toute la table** (les articles déjà commandés à ce moment-là, pas les suivants) **ou sur des articles choisis**. **Note obligatoire** : pour qui est la remise, plus des détails si besoin. Saisie en caisse par l'agent.
- **Annuler un article** — **note obligatoire** (raison). En caisse, l'agent commande **−1** de l'article (un bon « −1 » s'imprime en cuisine). **Jamais sur le dernier article d'une table** : LegacyPOS plante. Dans ce cas, l'annulation reste **en attente** jusqu'à ce que la table ait d'autres articles (ex. le serveur saisit la commande du client suivant sur cette table), et l'app le montre au serveur. S'il n'y a plus de client (fin de journée), le principal **retire l'annulation** : l'article redevient normal et la table s'encaisse comme d'habitude (le serveur paie l'article) ; c'est noté au journal et sur le PDF.
  - Deux types d'annulation, à choisir à chaque fois : **déjà préparé** (l'article sort du stock : perte) ou **pas préparé** (rien ne sort du stock). En caisse, c'est le même −1. Annuler une partie d'une ligne (1 capuccino sur 3) **coupe la ligne en deux** : la ligne d'origine garde 2 capuccinos, une nouvelle ligne de 1 est annulée avec sa note.
- **Transférer un article** d'une table à une autre. Saisi en caisse par l'agent. Transférer une partie d'une ligne la coupe en deux de la même façon.
- **Changer de table** (déplacer toute la table vers une autre). Saisi en caisse par l'agent.
- **Offrir un article** : enregistré **uniquement dans l'app**, à part des commandes, **jamais tapé en caisse**. Un article est offert **dès le départ** : on n'offre jamais un article déjà tapé. Cas : client mécontent, offres du staff. Qui, quoi, à qui, pourquoi (note). Le barista et le cuisinier enregistrent aussi les offres **au staff** ; l'offert à un client mécontent est réservé au principal. Les managers, patrons et le comptable ne passent pas par là : ils commandent sur les tables d'offre, y compris pour offrir à un client (voir Tables d'offre). L'article offert **sort du stock**.

- Une tâche en échec côté caisse est signalée clairement à tous les serveurs en shift : chacun peut la **réessayer** ; seul le principal peut la marquer **faite à la main** au comptoir. Tant qu'elle n'est pas réglée, les tâches suivantes de **la même table** attendent (les autres tables continuent) : par exemple, si l'encaissement de la table 5 a échoué, la commande des clients suivants de la table 5 ne s'ajoute pas à l'ancienne addition. Une annulation, une remise ou un transfert d'un article pas encore tapé en caisse passe simplement après sa saisie.

Toutes ces actions sont inscrites au journal d'actions (qui, quand, quelle table, quelle note).

## 6. Flux d'une commande

1. Le client scanne le QR → menu → commande avec notes → envoi.
2. Les serveurs en shift (principal et renfort) sont notifiés.
3. Un serveur vérifie avec la table → **Confirmer** (ou Rejeter si fausse commande). Sans réponse, la commande expire (voir §4).
4. La commande confirmée entre dans la **file caisse**. C'est la **confirmation** qui ouvre la session de la table si elle était libre : une commande en attente ne rend pas la table « occupée » et ne compte pas dans son montant (le plan affiche seulement « commande à confirmer »).
5. L'agent saisit la commande dans LegacyPOS quand la caisse est libre.
6. Le serveur apporte la commande ; plus tard, l'addition est imprimée et le principal encaisse.

Commande tapée par un serveur : on démarre directement à l'étape 4.

**Vente directe (client pressé au comptoir)** : il ne scanne pas le QR. Le barista ou le principal saisit la commande dans l'app comme **vente directe** (étape 4) ; elle compte dans la caisse du principal, et il faut un serveur en shift. En caisse, elle est tapée sur une **table fictive** (LegacyPOS en a beaucoup, ex. table 333). On prend l'argent et on appuie sur **Espèces** ou **Carte** dans l'app, sans attendre la caisse ; l'agent saisit puis encaisse, dans l'ordre de la file.

**Rien n'est jamais tapé directement en caisse** : toutes les ventes passent par l'app, ce qui est indispensable au calcul du stock.

## 7. Agent caisse (`pos-agent/`)

- Python + pywinauto, sur le PC de caisse Windows, à côté de LegacyPOS.
- Pilote uniquement l'**interface** de LegacyPOS. Jamais sa base de données ni ses fichiers.
- Repère les contrôles **par nom** (les boutons de LegacyPOS ont des noms visibles), jamais par coordonnées.
- **Un seul PIN caisse** dédié, stocké uniquement dans le `.env` du PC de caisse. Si l'écran PIN apparaît, l'agent le tape et continue.
- **File unique** : une action à la fois (commande, encaissement, addition…).
- **Partage de la caisse avec les humains** :
  - l'agent n'agit que si personne n'a touché souris/clavier depuis quelques secondes **et** si l'écran est le plan des tables (ou l'écran PIN, qu'il remplit avant de continuer) ;
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
- Agent en panne : la caisse reste utilisable à la main ; les serveurs en shift et la manager voient que l'agent ne répond plus ; les commandes en attente sont signalées.

## 11. Questions ouvertes (à trancher après la vidéo)

Tranchées le 15/10/2026 (voir §5 et `docs/decisions.md`) : encaissement depuis l'app, addition depuis l'app, remise staff, annulation par −1, offert, pas de division de l'addition, plan selon la disposition de la salle, Plat de la semaine.

Restent :

1. Après validation, LegacyPOS revient-il bien au plan des tables sans PIN ? Qu'est-ce qui fait sortir du plan des tables ?
2. ~~Tables réelles, disposition, tables fictives et tables d'offre~~ : relevées le 16/10/2026, `docs/tables.csv`.
3. Écrans d'encaissement, d'impression de l'addition, de remise, de transfert et de changement de table (à filmer).

## 12. Stock (fonctionnalité principale — à détailler)

- But : **tout calculer pour minimiser les écarts inexpliqués** entre le stock théorique et le stock réel.
- **Toutes les ventes passent par l'app** (QR, saisie serveur, comptoir) : une vente tapée directement en caisse sans l'app serait un écart inexpliqué.
- Consommation théorique de chaque article vendu à partir des **fiches techniques** (bar et cuisine), y compris les choix précis dans les formules (type de café, thé, jus, œufs).
- Sorties hors ventes : offerts (principal, barista, cuisinier), commandes des tables d'offre, annulations d'articles déjà préparés.
- Approvisionnement : achats, arrivages, avaries.
- Règles détaillées du calcul et de l'approvisionnement : à définir ensemble.
