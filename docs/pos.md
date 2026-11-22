# Caisse et agent — version publique

La caisse du café (appelée ici **LegacyPOS**) est un logiciel Windows tiers, sans API. L'agent
(`pos-agent/`) y saisit les ventes **comme un humain**, en pilotant son interface par
**UI Automation** (pywinauto). Ce document résume ce qui est publié ; le détail des écrans de la
vraie caisse reste privé.

## Ce que fait l'agent

- Il lit la **file caisse** du serveur (`docs/api.md`, tâches `enter_order`, `pay_table`,
  `print_bill`) et traite **une tâche à la fois**.
- **Saisie d'une commande** : ouvrir la table sur le plan, puis pour chaque ligne ouvrir la
  catégorie et toucher le bouton qui porte le **code produit** de l'article (on ne peut pas taper
  un code). Quantité tapée au pavé avant l'article. Validation par VALIDER, retour au plan.
- **Encaissement / addition** : avant d'encaisser, l'agent lit le total affiché et le compare au
  `expectedTotal` envoyé par le serveur ; s'ils diffèrent, il s'arrête (`TOTAL_MISMATCH`).
- Les notes et les choix des formules ne vont **jamais** en caisse : ils restent dans l'app et
  s'affichent sur l'écran bar / cuisine.

## Règles de sûreté

- Contrôles trouvés par **identifiant, nom ou texte** exposés à Windows, jamais par coordonnées.
- Avant chaque étape, l'écran attendu est vérifié ; sinon l'agent **s'arrête sans deviner**,
  abandonne proprement la saisie en cours et signale l'échec au serveur avec un code
  (`SCREEN_UNEXPECTED`, `UNKNOWN_CODE`, `TABLE_NOT_FOUND`, `COMMANDE_UNCONFIRMED`…).
- L'agent n'agit que si personne n'a touché la caisse depuis quelques secondes ; un humain qui
  touche pendant la saisie l'arrête (partage de la caisse, en cours).
- Le code caisse de l'agent n'est jamais dans le dépôt : seulement dans le fichier `.env` de l'agent, sur le
  PC de caisse (`pos-agent/.env.example`).

## Tests

- `pos-agent/tests/` : tests unitaires contre une **fausse caisse** en mémoire
  (`fausse_legacy.py`) et un faux serveur.
- L'équipe teste aussi l'agent contre un **émulateur Windows** de la caisse (`docs/product.md`
  § 8). Il reproduit l'interface d'un logiciel tiers : il **n'est pas publié**.
