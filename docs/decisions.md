# Décisions

Une ligne par décision, la plus récente en haut. Format : `AAAA-MM-JJ — décision — pourquoi`.

- 2026-10-15 — Migrations avec node-pg-migrate, écrites en SQL pur (`server/migrations/`), client `pg` ; `npm run migrate` chaque matin via `scripts/start-day.sh` — outil maintenu, SQL lisible par toute l'équipe, pas d'ORM imposé
- 2026-10-15 — Offerts dans une table `gifts` : sans table (offres staff, patrons) seulement dans `gifts` ; article déjà commandé et offert = `gifts` liée à la ligne, qui passe `gifted` — traçabilité du stock
- 2026-10-15 — Œufs des formules : deux groupes de choix, `eggs` (omelette ou brouillés : Sunrise, Full) et `eggs_with_benedict` (+ Bénédicte : Sweet) ; Boost Start a ses Bénédicte imposés — les options diffèrent selon la formule sur le menu papier
- 2026-10-15 — Le calcul du stock est une fonctionnalité principale : tout calculer pour minimiser les écarts inexpliqués — besoin principal du café
- 2026-10-15 — Annulation = commander −1 ; jamais sur le dernier article d'une table (l'annulation attend d'autres articles) — LegacyPOS plante sinon
- 2026-10-15 — Remise staff 20 % exactement, par tout serveur en shift, sur toute la table ou des articles, note « pour qui » obligatoire — usage actuel du café
- 2026-10-15 — Encaissement en une fois (ni division ni paiement mixte) par tout serveur en shift ; addition imprimée depuis l'app par l'agent — usage actuel
- 2026-10-15 — Offert déclaré dès le départ, jamais après saisie en caisse ; il sort du stock — éviter les annulations, stock exact
- 2026-10-15 — Plan des tables de l'app : disposition de la salle ; tables fictives attribuées automatiquement aux ventes directes — demande de l'équipe
- 2026-10-15 — Chef : ruptures, arrivages, avaries, inventaire et besoins de la cuisine ; Patron : droits de la manager + rapports de stock et d'écarts — rôles réels
- 2026-10-15 — Vente directe : le barista ou le serveur la saisit dans l'app, l'agent la tape sur une table fictive (ex. 333) ; rien n'est jamais tapé directement en caisse — toutes les ventes passent par l'app pour le stock
- 2026-10-15 — Encaissement depuis l'app : bouton Espèces / Carte, l'agent encaisse dans LegacyPOS — on prend l'argent sans attendre la caisse
- 2026-10-15 — Kids Menu (Cookie / Pancakes) et Cookie (chocolat / pomme cannelle) en deux articles chacun, comme en caisse ; note libre gardée sur chaque ligne, non tapée en caisse pour une formule — reflète la caisse
- 2026-10-15 — Formules et articles à choix : choix dans des listes (n'importe quel café ou thé, jus de saison), enregistrés pour le stock ; l'agent ne tape que la formule, sans note — la caisse n'a pas de note pour les formules, le stock a besoin de choix exacts
- 2026-10-15 — Plat de la semaine : la manager le crée dans LegacyPOS et entre son code dans l'app (même si le code change chaque semaine) ; l'agent le saisit par code — l'agent ne crée jamais d'article en caisse
- 2026-10-15 — Aucun serveur en shift → commande QR refusée ; commande non confirmée expirée après 5 min (réglable) — le serveur doit avoir le temps d'aller vérifier à la table
- 2026-10-15 — La confirmation (et non la commande en attente) ouvre la session de la table — pas de table « occupée » par une fausse commande
- 2026-10-15 — Ruptures : barista pour le bar, chef pour la cuisine, les deux pour Carrot cake, Fondant, Cookie, Formules et Kids Menu ; serveur et manager pour tout — chacun connaît son poste
- 2026-10-15 — Café ouvert de 8h00 à 22h00 : formules 8h–12h, œufs 8h–15h — horaires réels
- 2026-10-15 — Le menu de référence compte 97 articles (menu papier, Kids Menu et Cookie en deux articles, + Plat de la semaine) — vérifié contre le menu papier
- 2026-10-15 — App serveur : remise 20 % et annulation avec note obligatoire, transfert d'article, changement de table, tous saisis en caisse par l'agent ; « offert » enregistré seulement dans l'app, jamais tapé en caisse
- 2026-10-15 — Pas de planning par semaine : liste de tâches avec priorités P1/P2/P3 — l'équipe préfère avancer sans contrainte de temps
- 2026-10-15 — PR obligatoires mais sans approbation requise ; chacun fusionne sa propre PR — avancer vite tout en gardant un historique propre
- 2026-10-15 — L'agent partage la caisse avec les humains : file unique, attente d'inactivité, bandeau, arrêt si un humain touche — une seule souris/clavier
- 2026-10-15 — Émulateur LegacyPOS sous Windows pour tester l'agent avant livraison — on ne peut pas tester sur la vraie caisse
- 2026-10-15 — Un seul PIN caisse dédié pour l'agent, stocké seulement sur le PC de caisse — plus simple
- 2026-10-15 — L'agent saisit par code produit, pas par nom — plus fiable ; les boutons LegacyPOS ont des noms visibles
- 2026-10-15 — Pas de tailles ; les extras sont des articles normaux, saisis comme lignes séparées — reflète la caisse actuelle
- 2026-10-15 — Formules et articles à choix : le choix va dans la note — c'est ainsi que la caisse fonctionne aujourd'hui
- 2026-10-15 — Horaires automatiques : formules jusqu'à 12h, œufs jusqu'à 15h, plat de la semaine lun–ven 8h–15h
- 2026-10-15 — Menu complet en français et en anglais, avec une photo par article
- 2026-10-15 — Chaque membre du staff a son compte (identifiant + mot de passe, session 30 jours) et un rôle ; la manager crée les comptes
- 2026-10-15 — Notifications des commandes QR uniquement aux serveurs en shift (1 ou 2 par shift)
- 2026-10-15 — L'app serveur sert aussi de mini-caisse : plan des tables, saisie de commande pour clients sans téléphone
- 2026-10-15 — Argent en millimes entiers ; prix calculés par le serveur ; QR avec jeton aléatoire
- 2026-10-15 — Stack : Node.js/TypeScript, Express, Socket.IO, PostgreSQL ; React/Vite (PWA) ; Python/pywinauto (agent)
