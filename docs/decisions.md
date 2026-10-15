# Décisions

Une ligne par décision, la plus récente en haut. Format : `AAAA-MM-JJ — décision — pourquoi`.

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
