# Contrat d'API — Coffee QR

> Brouillon v1.8 (15 octobre 2026). À relire ensemble. Toute modification passe par une PR dédiée, annoncée à l'autre.

## 1. Règles générales

| Règle | Valeur |
| --- | --- |
| URL de base (local) | `http://localhost:3000/api` |
| Format | JSON (`Content-Type: application/json`), sauf upload photo (multipart) |
| Noms de champs | camelCase |
| IDs | entiers |
| Dates | ISO 8601 UTC (`2026-10-20T14:32:05Z`). Les horaires de disponibilité sont en heure locale Africa/Tunis, calculés **par le serveur**. |
| Argent | **entiers en millimes** (1 DT = 1000). `5500` = 5,5 DT. Jamais de décimaux. |
| Langues | `{ "fr": "...", "en": "..." }` pour tout texte visible par le client |
| Listes longues | pagination `?limit=50&cursor=<valeur>` → réponse `{ items: [...], nextCursor: "..." \| null }` |
| Anti-doublon | les créations envoyées par un téléphone portent un `clientRequestId` (UUID généré par l'app). Même `clientRequestId` reçu deux fois → le serveur renvoie le résultat de la première requête, sans rien recréer. |

### Authentification

| Appelant | Méthode |
| --- | --- |
| Client (menu QR) | aucune ; `tableToken` valide obligatoire |
| Staff (PWA) | `Authorization: Bearer <token>` obtenu par `POST /auth/login` (30 jours) |
| Agent caisse | `X-Agent-Key: <secret>` (dans le `.env` du PC de caisse) |

Rôles : `manager`, `waiter` (serveur), `barista`, `chef` (affiché « Cuisinier »). Chaque endpoint staff indique les rôles autorisés.
Un serveur en shift est soit **principal** (un seul à la fois : le premier arrivé, ou celui qui a accepté la passation ; il gère l'argent), soit **renfort**.
Un compte désactivé est refusé partout (`ACCOUNT_DISABLED`) et ses connexions temps réel sont coupées.

### Erreurs

```json
{ "error": { "code": "ITEM_UNAVAILABLE", "message": "Croissant indisponible", "details": { "menuItemId": 12 } } }
```

| HTTP | Codes | Quand |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Corps ou paramètres invalides : `details: { fields: [{ field, message }] }` (`field` = chemin du champ, ex. `lines.0.quantity`) |
| 401 | `UNAUTHORIZED` | Token absent, invalide ou expiré |
| 401 | `PASSWORD_CHANGE_REQUIRED` | Première connexion : changer le mot de passe d'abord |
| 403 | `FORBIDDEN` | Mauvais rôle |
| 403 | `NOT_ON_SHIFT` | Action réservée aux serveurs en shift |
| 403 | `NOT_PRINCIPAL` | Action réservée au serveur principal (argent, remise, annulation, offert, dépense, clôture) |
| 403 | `ACCOUNT_DISABLED` | Compte désactivé par la manager |
| 404 | `NOT_FOUND`, `TABLE_NOT_FOUND` | Ressource ou jeton de table inconnu |
| 409 | `ITEM_UNAVAILABLE` | Article en rupture |
| 409 | `OUTSIDE_HOURS` | Article hors de ses horaires |
| 409 | `INVALID_STATUS` | Action impossible dans l'état actuel (ex. commande déjà confirmée par un autre serveur, ou expirée) |
| 409 | `NO_WAITER_ON_SHIFT` | Commande QR, commande de manager ou vente directe refusée : aucun serveur en shift |
| 409 | `OPEN_TABLES` | Fin de shift impossible : tables ouvertes, commandes en attente ou renfort encore en shift. `details: { tableIds, pendingOrderIds, supportWaiterIds }` |
| 409 | `HANDOVER_PENDING` | Une passation attend d'être acceptée : encaissement, vente directe, remise, annulation, offert et dépense bloqués jusque-là |
| 409 | `NO_FREE_VIRTUAL_TABLE` | Vente directe impossible : aucune table fictive libre |
| 409 | `CANCEL_WAITING` | Encaissement impossible : une annulation attend encore d'être saisie en caisse (voir PosJob `waiting`) ; attendre un autre article sur la table ou retirer l'annulation |
| 413 | `FILE_TOO_LARGE` | Photo > 5 Mo |
| 423 | `ACCOUNT_LOCKED` | Trop d'essais de connexion ratés (blocage temporaire) |
| 429 | `TOO_MANY_REQUESTS` | Trop de requêtes (ex. commandes QR en rafale). `details.retryAfterSeconds` |
| 500 | `INTERNAL_ERROR` | Bug serveur. `message` générique ; le détail va seulement dans les logs serveur, jamais au client |
| 503 | `SERVICE_UNAVAILABLE` | Base de données indisponible ou maintenance ; l'app propose de réessayer |

Limites anti-abus (valeurs de départ, réglables dans `.env`) : 5 commandes QR par jeton de table par 10 minutes ; 10 essais de connexion par adresse IP par minute.

## 2. Formes de données

### MenuItem
```json
{
  "id": 3,
  "categoryId": 9,
  "name": { "fr": "Cheese Burger", "en": "Cheese Burger" },
  "description": { "fr": "Steak haché de bœuf, sauce maison, cheddar...", "en": "Beef patty, house sauce, cheddar..." },
  "price": 28500,
  "photoUrl": "/uploads/cheese-burger-800.webp",
  "available": true,
  "unavailableReason": null,
  "availability": { "days": [1,2,3,4,5,6,7], "from": null, "until": null },
  "suggestedExtraIds": [41, 42, 43],
  "choiceGroups": [],
  "noteHint": null,
  "station": "kitchen",
  "posCode": "1234"
}
```
- `availability.days` : 1 = lundi … 7 = dimanche. `from`/`until` : `"HH:MM"` ou `null`. Sans horaire propre, un article est disponible pendant l'ouverture du café (8h00–22h00).
- `available` : vrai si commandable **maintenant**.
- `unavailableReason` : `null`, `"sold_out"` (rupture → **grisé** chez le client) ou `"outside_hours"` (hors horaire → **masqué** chez le client).
- `choiceGroups` : clés des groupes de choix obligatoires des formules et du Kids Menu (voir ChoiceGroup), ex. `["hot_drink", "eggs", "seasonal_juice"]` ; `[]` pour les autres articles.
- `noteHint` : aide facultative affichée au-dessus de la note libre (ex. `{ "fr": "Sans sucre ?", "en": "No sugar?" }`).
- `station` : `"bar"`, `"kitchen"` ou `"both"` ; décide qui peut marquer la rupture (voir `PATCH /menu-items/:id/availability`).
- `posCode` : renvoyé seulement au staff et à l'agent, jamais aux clients.

### ChoiceGroup (choix d'une formule ou du Kids Menu)
```json
{ "key": "hot_drink", "name": { "fr": "Café ou thé", "en": "Coffee or tea" },
  "optionIds": [57, 58, 59, 72, 73] }
```
- Chaque option est un **article du menu** (`menuItemId`), pour relier le choix à sa fiche technique (stock). Son prix est ignoré : il est inclus dans la formule.
- Le client choisit **exactement une** option par groupe. Une option en rupture est grisée et refusée (`ITEM_UNAVAILABLE`).
- Un groupe a **une seule liste d'options**, partagée par tous les articles qui l'utilisent. Si les options diffèrent d'un article à l'autre, ce sont deux groupes distincts.
- Groupes prévus :

| Clé | Nom (fr / en) | Options | Articles |
| --- | --- | --- | --- |
| `hot_drink` | Café ou thé / Coffee or tea | les thés à 6,5 DT et les cafés jusqu'à 8,5 DT de la carte | toutes les formules petit-déjeuner |
| `seasonal_juice` | Jus de saison / Seasonal juice | modifiable par la manager ; pour l'instant Grenade | Full, Boost Start et Sweet Start, Kids Menu |
| `eggs` | Omelette ou œufs brouillés / Omelette or scrambled eggs | Omelette nature, Œufs brouillés | Sunrise Plate, Full Morning |
| `eggs_with_benedict` | Vos œufs / Your eggs | Omelette nature, Œufs brouillés, Œufs Bénédicte | Sweet Start |

- Boost Start n'a pas de groupe d'œufs : ses œufs Bénédicte sont imposés.

### Order
```json
{
  "id": 154,
  "table": { "id": 7, "number": 7 },
  "tableSessionId": 61,
  "source": "qr",
  "status": "confirmed",
  "lines": [
    { "id": 901, "menuItemId": 3, "name": { "fr": "Cheese Burger", "en": "Cheese Burger" },
      "quantity": 1, "note": "sans oignon", "unitPrice": 28500, "discountPercent": 0,
      "lineTotal": 28500, "status": "active" },
    { "id": 902, "menuItemId": 41, "name": { "fr": "Bacon de bœuf", "en": "Beef bacon" },
      "quantity": 1, "note": null, "unitPrice": 8500, "discountPercent": 0,
      "lineTotal": 8500, "status": "active" },
    { "id": 903, "menuItemId": 2, "name": { "fr": "Classic Start", "en": "Classic Start" },
      "quantity": 1, "note": "sans sucre", "unitPrice": 14500, "discountPercent": 0,
      "lineTotal": 14500, "status": "active",
      "choices": [ { "group": "hot_drink", "menuItemId": 57, "name": { "fr": "Capuccino", "en": "Cappuccino" } } ] }
  ],
  "total": 51500,
  "createdAt": "...", "confirmedAt": "...", "confirmedBy": { "id": 4, "name": "Amira" }, "manager": null,
  "pos": { "status": "queued", "error": null }
}
```
- `source` : `qr` (client), `waiter` (saisie serveur), `direct` (vente directe au comptoir, sur une table fictive) ou `manager` (commande d'un manager sur sa table, voir Commandes des managers).
- `manager` : `{ id, name, forClient }` pour une commande `manager` (`forClient: true` = offerte à un client), sinon `null`.
- `confirmedBy` : `{ id, name }` de la personne qui a confirmé ou saisi la commande (serveur principal ou renfort, barista pour une vente directe), pour le journal ; `null` tant qu'elle est `pending`. La vente compte dans la caisse du principal.
- `status` : `pending` → `confirmed` | `rejected` | `expired`. Une commande `waiter` ou `direct` est créée directement `confirmed`.
- `expired` : commande `pending` (`qr` ou `manager`) non traitée après `ORDER_PENDING_TTL_SECONDS` (300 s par défaut). La table ou le manager en est informé (`order:updated`).
- Commande `manager` : `unitPrice` et `lineTotal` valent 0, `total` 0 ; jamais de tâche caisse (`pos: null`) ; jamais de session de table (`tableSessionId` toujours `null`). C'est un offert : hors CA, elle sort du stock et figure dans la clôture (`managerOrders`).
- `tableSessionId` : `null` tant que la commande est `pending` (ou si elle est rejetée ou expirée). C'est la **confirmation** qui rattache la commande à la session de la table, et l'ouvre si la table était libre.
- `choices` : présent sur les lignes d'articles ayant des `choiceGroups`, un choix par groupe. Les choix valent pour toute la quantité de la ligne ; pour des choix différents, le client ajoute une autre ligne.
- Ligne `status` : `active`, `cancelled` (annulée, avec note), `transferred` (déplacée vers une autre table). Un offert n'est **jamais** une ligne de commande (voir Gift).
- `cancellation` (lignes annulées, ou dont l'annulation a été retirée ; sinon absent) : `{ note, prepared, cancelledBy: { id, name }, cancelledAt, withdrawn }`. `prepared: true` = article déjà préparé (il sort du stock, c'est une perte) ; `false` = pas préparé (rien ne sort du stock). `withdrawn: true` = annulation retirée (voir `POST /order-lines/:id/withdraw-cancel`) : la ligne est redevenue `active` et a été payée.
- `splitFromLineId` (lignes issues d'un découpage, sinon absent) : annuler ou transférer une **partie** d'une ligne la coupe en deux. La ligne d'origine garde le reste (sa `quantity` baisse, elle reste `active`) ; une nouvelle ligne avec la quantité annulée (`cancelled`) ou transférée (sur la table d'arrivée) porte `splitFromLineId`.
- `discountPercent` : 0 ou 20 (remise staff). `lineTotal = quantity × unitPrice × (100 − discountPercent) / 100`, arrondi au millime. Les lignes `cancelled` et `transferred` comptent 0 dans `total`.
- `pos.status` : `not_sent` → `queued` → `entered` | `failed` | `manual` (saisie à la main au comptoir).
- Les prix sont copiés dans la commande à sa création.

### TableSession (une « ouverture » de table, jusqu'à l'encaissement)
```json
{ "id": 61, "tableId": 7, "openedAt": "...", "closedAt": null, "status": "open", "total": 51500, "orderIds": [154] }
```
- Ouverte automatiquement par la première commande **confirmée** sur une table libre ; fermée par l'encaissement (`POST /tables/:id/pay`).
- Le changement de table (`move`) déplace la session entière.
- Une table se paie **en une seule fois** : pas de division de l'addition, pas de paiement mixte.

### Table
```json
{ "id": 7, "number": 7, "kind": "real", "state": "occupied", "openSessionId": 61, "openTotal": 51500, "pendingOrders": 1,
  "layout": { "x": 2, "y": 0, "w": 1, "h": 1, "shape": "square" }, "managerId": null }
```
- `kind` : `real` (table de la salle, avec QR) ou `virtual` (table fictive de LegacyPOS, ex. 333, pour les ventes directes ; sans QR).
- `state` : `free` ou `occupied`. Une commande `pending` ne rend pas la table `occupied` : elle compte seulement dans `pendingOrders`.
- `openTotal` : seulement les commandes confirmées.
- `layout` : position sur le plan de la salle, en cases d'une grille (`shape` : `square` ou `round`) ; `null` pour une table `virtual`.
- `managerId` : pour une table `virtual` réservée à un manager (ses commandes), l'id du compte ; sinon `null`. Une table de manager n'est jamais utilisée pour une vente directe ni affichée sur le plan.

### Gift (offert, jamais tapé en caisse)
```json
{ "id": 12, "tableId": 7, "menuItemId": 64, "name": { "fr": "Cookie chocolat", "en": "Chocolate cookie" },
  "quantity": 1, "choices": [], "reason": "unhappy_customer", "beneficiary": null, "note": "attente trop longue",
  "givenBy": { "id": 4, "name": "Amira" }, "createdAt": "..." }
```
- Enregistré **seulement** comme Gift, jamais comme ligne de commande : il ne peut pas partir en caisse et compte 0 dans les totaux. Il sort du stock.
- `tableId` : `null` pour une offre sans table (staff).
- `reason` : `unhappy_customer` (client mécontent) ou `staff`. Les patrons et managers passent par leurs commandes (voir Order, source `manager`).
- `givenBy` : principal, barista ou cuisinier. L'offert compte dans la clôture du créneau en cours. Les offres des managers sont des commandes `manager` (voir Order).

### Expense (dépense payée en espèces de la caisse)
```json
{ "id": 5, "closureId": null, "amount": 18000, "reason": "supplies", "note": "boîtes takeaway",
  "photoUrl": null, "createdBy": { "id": 4, "name": "Amira" }, "createdAt": "..." }
```
- `closureId` : clôture qui l'a comptée ; `null` tant que le créneau n'est pas clôturé.
- `reason` : `supplier` (fournisseur), `extra_staff` (extra payé en espèces), `supplies` (achat courant : boîtes, papier…), `other`.

### ShiftClosure (clôture de la caisse, une par créneau)
```json
{ "id": 31, "principal": { "id": 4, "name": "Amira" }, "handedOverTo": { "id": 6, "name": "Mehdi" }, "forcedBy": null, "slot": 1,
  "startedAt": "2026-10-20T07:02:00Z", "endedAt": "2026-10-20T14:21:00Z",
  "sales": 412500, "cash": 251000, "card": 140500, "expenses": 18000,
  "expectedCash": 233000, "countedCash": 232000, "cashDifference": -1000,
  "items": [ { "menuItemId": 57, "name": { "fr": "Capuccino", "en": "Cappuccino" }, "quantity": 23, "amount": 207000 } ],
  "gifts": [Gift],
  "managerOrders": [ { "orderId": 160, "manager": { "id": 2, "name": "Salma", "forClient": false },
                       "lines": [ { "menuItemId": 57, "name": { "fr": "Capuccino", "en": "Cappuccino" }, "quantity": 1 } ] } ],
  "cancelledLines": [ { "orderLineId": 950, "menuItemId": 3, "quantity": 1, "note": "erreur de saisie", "prepared": false, "withdrawn": false } ],
  "expenseList": [Expense], "openTables": [ { "id": 7, "number": 7, "openTotal": 51500 } ],
  "pdfUrl": "/api/closures/31/pdf" }
```
- Une seule caisse : la clôture couvre **tout** ce qui s'est passé depuis la clôture précédente (`startedAt` = fin de la précédente, ou premier shift du jour), quel que soit le serveur (principal ou renfort) ou le poste (barista, cuisinier). Elle est faite par le principal.
- `slot` : `1` si `startedAt` est avant 15h00 (Africa/Tunis), sinon `2`.
- `sales` (CA) : lignes des commandes confirmées pendant la période (hors `manager`), remises déduites, annulations déduites, offerts exclus.
- `cash` / `card` : encaissements de la période (tables et ventes directes).
- `expectedCash = cash − expenses` (pas de fond de caisse) ; `cashDifference = countedCash − expectedCash`.
- `gifts` : offerts de la période (principal, barista, cuisinier). `managerOrders` : commandes des managers confirmées pendant la période (0 DT).
- `handedOverTo` : principal suivant (passation) ; `null` en fin de journée.
- `forcedBy` : manager qui a forcé la clôture (principal parti sans clôturer), sinon `null`.
- `cancelledLines` : annulations de la période, avec `prepared` (perte de stock ou non) et `withdrawn` (annulation retirée et payée par le serveur).
- `openTables` : tables passées au principal suivant (toujours `[]` en fin de journée).
- Le PDF reprend ces informations ; il est archivé et n'est jamais modifié.

### PosJob (file caisse)
```json
{ "id": 88, "type": "enter_order", "orderId": 154, "tableNumber": 7,
  "lines": [ { "orderLineId": 901, "posCode": "1234", "quantity": 1, "note": "sans oignon" },
             { "orderLineId": 902, "posCode": "2041", "quantity": 1, "note": null } ],
  "status": "queued", "attempts": 0, "lastError": null, "createdAt": "...", "startedAt": null }
```
- Champs par `type` (en plus de `id`, `type`, `tableNumber`, `status`, `attempts`, `lastError`, `createdAt`, `startedAt`) :

| `type` | Champs |
| --- | --- |
| `enter_order` | `orderId`, `lines: [ { orderLineId, posCode, quantity, note } ]` |
| `discount` | `percent` (20), `lines: [ { orderLineId, posCode, quantity } ] \| null` (`null` = toute la table), `note` |
| `cancel_line` | `orderLineId`, `posCode`, `quantity` (l'agent commande −`quantity`), `note` |
| `transfer_line` | `orderLineId`, `posCode`, `quantity`, `toTableNumber` |
| `move_table` | `toTableNumber` |
| `pay_table` | `method` (`cash` \| `card`), `expectedTotal` |
| `print_bill` | `expectedTotal` |

- `enter_order` : les choix (`choices`) ne vont **jamais** en caisse, l'agent tape seulement l'article. La note libre des articles ayant des `choiceGroups` (formules, Kids Menu) n'est pas envoyée non plus (`note: null`) : le serveur la transmet oralement.
- `expectedTotal` : montant que l'agent doit lire à l'écran avant d'encaisser ou d'imprimer ; s'il diffère, il s'arrête (`fail`, `error: "TOTAL_MISMATCH"`).
- `status` : `queued` → `in_progress` → `done` | `failed` ; `failed` → `queued` (réessai) ou `manual` (fait à la main) ; `waiting` → `queued` ou `withdrawn` (annulation retirée).
- `waiting` (seulement `cancel_line`) : l'annulation porterait sur le **dernier article** de la table en caisse, ce qui fait planter LegacyPOS. La tâche attend, et passe `queued` dès que la table a d'autres articles saisis en caisse (ex. le serveur saisit la commande du client suivant sur cette table). Sinon (fin de journée), le principal **retire l'annulation** : la tâche passe `withdrawn`, rien n'est tapé, et la table s'encaisse normalement (le serveur paie l'article). Une tâche `waiting` n'est jamais renvoyée à l'agent.
- **Une seule** tâche `in_progress` à la fois. Les tâches sont traitées dans l'ordre de création.
- Si une tâche reste `in_progress` plus de 2 minutes sans heartbeat de l'agent, elle passe `failed` (`lastError: "AGENT_TIMEOUT"`) et le staff est alerté — **jamais remise automatiquement en file**, pour ne pas saisir deux fois la même chose.

### User (compte staff)
```json
{ "id": 4, "name": "Amira", "login": "amira", "role": "waiter", "active": true,
  "mustChangePassword": false, "locked": false,
  "lastLoginAt": "2026-10-20T07:58:12Z", "createdAt": "2026-10-15T10:00:00Z" }
```
- `active` : `false` = compte désactivé par la manager (refusé partout, `ACCOUNT_DISABLED`).
- `locked` : bloqué temporairement après trop d'essais de connexion ratés (`ACCOUNT_LOCKED`).
- `lastLoginAt` : dernière connexion réussie ; `null` si jamais connecté.
- Le mot de passe et son empreinte ne sont jamais renvoyés.

## 3. Client (sans connexion)

| Méthode | Chemin | Corps | Réponse |
| --- | --- | --- | --- |
| GET | `/tables/:tableToken` | — | `{ id, number }` ou 404 `TABLE_NOT_FOUND` |
| GET | `/menu` | — | `{ categories: [ { id, name, sortOrder, items: [MenuItem sans posCode] } ], choiceGroups: [ChoiceGroup] }` |
| POST | `/orders` | `{ clientRequestId, tableToken, lines: [ { menuItemId, quantity, note, choices? } ] }` | 201 `{ orderId, status: "pending", total, expiresAt }` |
| GET | `/orders/:id?tableToken=` | — | `{ orderId, status }` (pour retrouver l'état après reconnexion) |

Règles `POST /orders` :
- 1–30 lignes, quantité 1–20, note ≤ 200 caractères, articles disponibles **à l'heure actuelle**. Le serveur calcule tous les prix. Limite : voir anti-abus.
- `choices: [ { group, menuItemId } ]` : obligatoire et complet pour un article ayant des `choiceGroups` (sinon `VALIDATION_ERROR`) ; interdit sinon.
- Aucun serveur en shift → 409 `NO_WAITER_ON_SHIFT` (le menu QR affiche « commandez au comptoir »).

## 4. Authentification staff

| Méthode | Chemin | Corps | Réponse |
| --- | --- | --- | --- |
| POST | `/auth/login` | `{ login, password }` | `{ token, user: { id, name, role, mustChangePassword } }` |
| POST | `/auth/change-password` | `{ currentPassword, newPassword }` | 204 |
| POST | `/auth/logout` | — | 204 |
| GET | `/me` | — | `{ id, name, role, onShift, principal }` (`principal` : vrai si serveur principal en shift) |

## 5. Serveur (rôle `waiter` en shift, sauf mention)

Le plan des tables et les commandes sont gérés **seulement par les serveurs en shift**, lecture comprise : tous les endpoints de cette section exigent le rôle `waiter` (sinon `FORBIDDEN`) et d'être **en shift** (sinon `NOT_ON_SHIFT`), sauf mention : `POST /shifts/start`, `GET /shifts/current`, les ruptures, `/direct-sales` (barista aussi), `/gifts` (barista et chef aussi) et l'abonnement push. La manager n'y a pas accès : elle a ses rapports (§ 6) et ses commandes (§ 5 bis).

**Principal seulement** (sinon 403 `NOT_PRINCIPAL`) : `POST /shifts/end` avec `countedCash`, `/expenses`, `/tables/:id/pay`, `/tables/:id/discount`, `/order-lines/:id/cancel`, `/order-lines/:id/withdraw-cancel`, `/pos/jobs/:id/resolve-manually`, `/gifts` (pour un serveur) et `/direct-sales` (pour un serveur). Le renfort peut tout le reste (plan, commandes, confirmer, saisir, transférer, changer de table, imprimer l'addition, ruptures).

Après la fermeture du café (22h00) et avant l'ouverture (8h00), `/staff-orders`, `/direct-sales` et `/manager-orders` restent possibles : seul le menu QR (`POST /orders`) est refusé (`OUTSIDE_HOURS`). Les horaires propres des articles (`availability.from` / `until`, `days`) s'appliquent toujours.

| Méthode | Chemin | Corps | Réponse |
| --- | --- | --- | --- |
| POST | `/shifts/start` | — | `{ shiftId, startedAt, principal }` (premier serveur en shift = principal, sinon renfort) |
| POST | `/shifts/end` | renfort : — ; principal : `{ countedCash, handoverTo? }` (espèces comptées, millimes ; `handoverTo` = id d'un serveur en shift) | renfort : 204 (fin de son shift). Principal **avec** `handoverTo` : 202 `{ handoverId }` (passation en attente, voir plus bas). Principal **sans** `handoverTo` (fin de journée) : 201 ShiftClosure ; refusé si un autre serveur est en shift (`VALIDATION_ERROR` sur `handoverTo`), ou s'il reste une table ouverte ou une commande en attente (409 `OPEN_TABLES`) |
| GET | `/handovers/pending` | — | `{ items: [ { id, from: { id, name }, openTables: [ { id, number, openTotal } ], pendingOrders, createdAt } ] }` (passations qui m'attendent) |
| POST | `/handovers/:id/accept` | `{ countedCash }` seulement pour une passation forcée (c'est alors moi qui compte) | 201 ShiftClosure (la clôture du principal sortant est générée maintenant ; je deviens principal ; tables ouvertes et commandes en attente me sont passées ; son shift se termine) |
| POST | `/handovers/:id/decline` | — | 204 (le principal sortant reste principal) |
| POST | `/expenses` | `{ clientRequestId, amount, reason, note, photoUrl? }` | 201 Expense (comptée dans la clôture en cours) — principal |
| GET | `/expenses?closure=current` | — | `{ items: [Expense] }` (dépenses du créneau en cours) — principal |
| GET | `/shifts/current` | — | `{ waiters: [ { id, name, startedAt, principal } ] }` (tout le staff) |
| GET | `/tables` | — | `{ tables: [Table] }` (tables `real`, pour le plan de la salle) |
| GET | `/tables/:id/session` | — | `{ session: TableSession, orders: [Order], gifts: [Gift] }` (session ouverte) |
| GET | `/orders?status=pending` | — | `{ items: [Order], nextCursor }` (commandes QR et des managers) |
| POST | `/orders/:id/confirm` | — | Order (409 `INVALID_STATUS` si déjà traitée ou expirée). Commande `manager` : confirmée sans session ni tâche caisse |
| POST | `/orders/:id/reject` | `{ reason? }` | Order |
| POST | `/staff-orders` | `{ clientRequestId, tableId, lines: [ { menuItemId, quantity, note, choices? } ] }` (`tableId` : une table `real`) | 201 Order (`source: "waiter"`, `confirmed`) |
| POST | `/direct-sales` | `{ clientRequestId, lines: [ { menuItemId, quantity, note, choices? } ], method: "cash" \| "card" }` | 201 Order (`source: "direct"`, `confirmed`) — principal ou barista ; comptée dans la caisse du principal ; aucun serveur en shift → 409 `NO_WAITER_ON_SHIFT` |
| PATCH | `/menu-items/:id/availability` | `{ available }` | MenuItem — serveur **en shift** (sinon `NOT_ON_SHIFT`), manager : tout article ; barista : `station` `bar` ou `both` ; chef : `kitchen` ou `both` ; sinon `FORBIDDEN` |
| POST | `/push/subscribe` | abonnement Web Push | 204 (tout le staff) |

Vente directe (`/direct-sales`) : le serveur attribue une **table fictive libre**, jamais une table de manager (sinon 409 `NO_FREE_VIRTUAL_TABLE`), crée la commande, puis met en file `enter_order` et `pay_table` (dans cet ordre) ; la session de la table fictive est fermée. Le numéro de la table fictive est dans `Order.table`.

### Actions sur une table (chacune crée une tâche dans la file caisse, sauf « offrir »)

| Méthode | Chemin | Corps | Effet caisse |
| --- | --- | --- | --- |
| POST | `/tables/:id/discount` | `{ percent: 20, lineIds?: [..], beneficiary, note? }` (remise staff : `percent` vaut toujours 20 ; `beneficiary` obligatoire = pour qui ; sans `lineIds` = les lignes actives de la table **à ce moment-là**, pas les suivantes) | tâche `discount` |
| POST | `/order-lines/:id/cancel` | `{ quantity?, note, prepared }` (note et `prepared` obligatoires : article déjà préparé ou non ; sans `quantity` = toute la ligne ; une partie = découpage, voir `splitFromLineId`) | tâche `cancel_line` (`waiting` si c'est le dernier article de la table en caisse) ; réponse `{ lines: [ligne d'origine, ligne annulée] }` |
| POST | `/order-lines/:id/withdraw-cancel` | — (seulement si sa tâche `cancel_line` est `waiting`) | **aucune** : tâche `withdrawn`, ligne de nouveau `active` (`cancellation.withdrawn: true`) ; la table s'encaisse ensuite normalement ; sinon 409 `INVALID_STATUS` |
| POST | `/order-lines/:id/transfer` | `{ toTableId, quantity? }` (sans `quantity` = toute la ligne ; une partie = découpage) | tâche `transfer_line` ; réponse `{ lines: [ligne d'origine, ligne sur la table d'arrivée] }` |
| POST | `/tables/:id/move` | `{ toTableId }` | tâche `move_table` |
| POST | `/gifts` | `{ clientRequestId, tableId?, menuItemId, quantity, choices?, reason: "unhappy_customer" \| "staff", beneficiary?, note }` | **aucune** (jamais tapé en caisse) ; 201 Gift |
| POST | `/tables/:id/pay` | `{ method: "cash" \| "card" }` | tâche `pay_table` ; la session est fermée tout de suite dans l'app ; 409 `CANCEL_WAITING` si une annulation de la table est `waiting` |
| POST | `/tables/:id/print-bill` | — | tâche `print_bill` |

- **Offrir** : un article est offert **dès le départ**, jamais après avoir été tapé en caisse. L'offert crée un Gift (rattaché à la session ouverte de la table si `tableId`), jamais une ligne de commande ; il sort du stock. Rôles : principal, barista, chef (les offres du barista et du cuisinier comptent dans la clôture en cours). La manager n'utilise pas `/gifts` : ses offres et celles des patrons sont des commandes `manager`.
- Toutes ces actions sont écrites dans le journal d'actions.

## 5 bis. Commandes des managers (rôle `manager`)

| Méthode | Chemin | Corps | Réponse |
| --- | --- | --- | --- |
| POST | `/manager-orders` | `{ clientRequestId, forClient, lines: [ { menuItemId, quantity, note, choices? } ] }` (`forClient: true` = offerte à un client) | 201 Order (`source: "manager"`, `pending`, sur la table du manager) ; aucun serveur en shift → 409 `NO_WAITER_ON_SHIFT` ; aucune table attribuée à ce manager → 409 `INVALID_STATUS` |
| GET | `/manager-orders` | — | `{ items: [Order], nextCursor }` (mes commandes, les plus récentes d'abord) |

- Mêmes règles de lignes que `POST /orders` (quantités, notes, choix, ruptures, horaires propres des articles).
- Les serveurs en shift sont notifiés (`order:new`) ; l'un d'eux confirme ou rejette (`/orders/:id/confirm`, `/orders/:id/reject`). Sans réponse, la commande expire comme une commande QR.
- Jamais tapée en caisse ; 0 DT ; dans la clôture du créneau (`managerOrders`).

### Échecs caisse (serveur en shift ; « fait à la main » : principal)

| Méthode | Chemin | Corps | Effet |
| --- | --- | --- | --- |
| GET | `/pos/jobs?status=failed` | — | `{ items: [PosJob], nextCursor }` (aussi `status=waiting`) |
| POST | `/pos/jobs/:id/retry` | — | `failed` → `queued` |
| POST | `/pos/jobs/:id/resolve-manually` | `{ note? }` | `failed` → `manual` (fait à la main au comptoir) ; commande `pos.status = "manual"` — principal |

## 6. Manager (rôle `manager`)

| Méthode | Chemin | Rôle |
| --- | --- | --- |
| GET | `/users` | `{ users: [User] }` (tous les comptes, sans pagination) |
| POST | `/users` | `{ name, login, role }` → 201 `{ user: User, temporaryPassword }` |
| PATCH | `/users/:id` | `{ role?, active? }` (changer de rôle, désactiver/réactiver) → User |
| POST | `/users/:id/reset-password` | — → `{ user: User, temporaryPassword }` |
| GET/POST/PUT/DELETE | `/categories`, `/menu-items` | édition du menu (noms FR/EN, prix, code, horaires, extras suggérés, `station`, `choiceGroups`) ; dont le Plat de la semaine |
| GET/PUT | `/admin/choice-groups/:key` | options d'un groupe de choix (ex. `seasonal_juice` : `{ optionIds: [..] }`) |
| GET/POST/PATCH | `/admin/tables` | lister, créer, renommer les tables ; `kind` (`real` / `virtual`), `layout` (plan de la salle) et `managerId` (table fictive réservée à un manager) |
| POST | `/admin/tables/:id/rotate-token` | nouveau jeton QR (l'ancien QR ne marche plus) → `{ tableToken }` ; 409 `INVALID_STATUS` pour une table `virtual` |
| POST | `/uploads` | photo (jpg/png ≤ 5 Mo) → `{ photoUrl }` (redimensionnée 800 px, WebP) |
| GET | `/audit-log` | journal d'actions, paginé |
| POST | `/admin/force-handover` | `{ toWaiterId }` : crée une passation **forcée** du principal en cours vers ce serveur en shift (il accepte avec `countedCash`) ; ou `{ toWaiterId: null, countedCash }` en fin de journée sans autre serveur : 201 ShiftClosure (règles `OPEN_TABLES` comme `POST /shifts/end`). Dans les deux cas `forcedBy` = la manager, journal d'actions |
| GET | `/reports/sales?date=YYYY-MM-DD&slot=1\|2` | rapport d'une journée (Africa/Tunis), ou d'un créneau **par horaire** avec `slot` (1 = 8h00–15h00, 2 = 15h00–22h00, quelles que soient les clôtures) ; sans `date` : aujourd'hui → `{ sales, cash, card, expenses, items: [ { menuItemId, name, quantity, amount } ], gifts: [ { menuItemId, name, quantity, reason } ] }` ; `gifts.reason` : `unhappy_customer`, `staff`, `manager` ou `manager_for_client` (commandes des managers) ; les ventes après 22h comptent dans le créneau 2, avant 8h dans le 1 (temps réel : recharger sur `report:updated`) |
| GET | `/closures?date=YYYY-MM-DD` | `{ items: [ShiftClosure], nextCursor }` (sans `date` : toutes, de la plus récente à la plus ancienne) |
| GET | `/closures/:id` | ShiftClosure |
| GET | `/closures/:id/pdf` | le PDF de clôture (`application/pdf`) |

Comptes (`/users`) :
- Le **serveur génère** le mot de passe temporaire (aléatoire, 10 caractères faciles à taper : minuscules et chiffres, sans `0 o 1 l i`). Il est renvoyé **une seule fois**, dans la réponse ; il n'est jamais stocké en clair. Changement obligatoire à la connexion suivante (`mustChangePassword: true`).
- `login` déjà pris (sans tenir compte des majuscules) → 400 `VALIDATION_ERROR` sur le champ `login`.
- Désactiver (`active: false`) coupe tout de suite toutes les sessions du compte (`session:revoked`, `reason: "ACCOUNT_DISABLED"`).
- Réinitialiser le mot de passe débloque le compte (`locked: false`) et coupe toutes ses sessions.
- On ne peut pas se désactiver soi-même ni retirer son propre rôle `manager`, et il reste toujours au moins un manager actif → 409 `INVALID_STATUS`.
- Un serveur en shift ne peut être ni désactivé ni changé de rôle tant que son shift n'est pas terminé → 409 `INVALID_STATUS`.
- Toutes ces actions sont écrites dans le journal d'actions.

Statistiques (articles les plus / moins vendus, ventes d'un article sur une période, courbes) : endpoints ajoutés plus tard.

Rôles barista / chef : endpoints ajoutés avec le stock (achats, arrivages, avaries, inventaire, besoins, offres staff, rapports d'écarts).

## 7. Agent caisse

| Méthode | Chemin | Corps | Réponse |
| --- | --- | --- | --- |
| GET | `/pos/jobs/next` | — | PosJob le plus ancien `queued`, ou 204 (rien, ou une tâche déjà `in_progress`) ; jamais une tâche `waiting` |
| POST | `/pos/jobs/:id/start` | — | 200 (passe en `in_progress`) ; 409 si une autre tâche est en cours |
| POST | `/pos/jobs/:id/done` | — | 200 (`done`, commande `entered`) |
| POST | `/pos/jobs/:id/fail` | `{ error, step, screenshot? }` | 200 (`failed`, staff alerté) |
| POST | `/pos/heartbeat` | `{ state: "idle" \| "busy" \| "waiting_for_human", jobId? }` | 204 (toutes les 10 s) |

## 8. Temps réel (Socket.IO)

### Connexion
| Qui | Authentification | Reçoit |
| --- | --- | --- |
| Client (menu QR) | `auth: { tableToken }` | seulement les événements de **sa** table + `menu:updated` |
| Staff | `auth: { token }` | selon son rôle et son shift ; déconnecté si compte désactivé |
| Agent | `auth: { agentKey }` | `pos:job` |

### Événements
| Événement | Destinataires | Données |
| --- | --- | --- |
| `order:new` | serveurs en shift | Order (QR et managers) |
| `order:updated` | serveurs en shift (+ la table ou le manager concerné : `{ orderId, status }`, y compris `expired`) | Order |
| `table:updated` | serveurs en shift | Table |
| `menu:updated` | staff, clients | `{ menuItemId, available, unavailableReason }` |
| `handover:requested` | serveur destinataire | `{ handoverId, from: { id, name } }` |
| `handover:updated` | les deux serveurs | `{ handoverId, status: "accepted" \| "declined" }` |
| `pos:job` | agent | `{ jobId }` |
| `pos:failed` | serveurs en shift | `{ jobId, orderId, error }` |
| `pos:waiting` | serveurs en shift | `{ jobId, tableNumber, orderLineId }` (annulation en attente : dernier article de la table) |
| `pos:status` | manager | `{ state, lastSeenAt }` |
| `report:updated` | manager | `{}` (une vente, un encaissement, une dépense ou une clôture a changé les chiffres du jour : recharger `/reports/sales`) |
| `session:revoked` | staff concerné | `{ reason: "ACCOUNT_DISABLED" \| "LOGGED_OUT" }` |

Après reconnexion, chaque client recharge via REST.

## 9. Divers

| Méthode | Chemin | Réponse |
| --- | --- | --- |
| GET | `/health` | `{ status: "ok", db: "ok", time: "..." }` (sans connexion ; pour le déploiement et l'agent) |

## 10. Historique

| Version | Date | Changement |
| --- | --- | --- |
| v1.8 brouillon | 2026-10-15 | Une seule caisse : serveur **principal** et **renfort** (`NOT_PRINCIPAL`), clôture par créneau (`ShiftClosure.principal`, `handedOverTo`, `managerOrders`), passation (`/handovers`, `handover:*`, `HANDOVER_PENDING`), fin de journée (`OPEN_TABLES`) ; plus de `Order.waiterId` ni de `waiterId` dans `/direct-sales` ; commandes des managers (`/manager-orders`, `source: "manager"`, `Order.manager`, `Table.managerId`) ; `/gifts` sans la manager, avec le chef ; découpage des lignes (`splitFromLineId`) ; remise sur les lignes présentes ; ruptures du serveur seulement en shift ; annulation `prepared` (perte de stock ou non) et retrait d'une annulation en attente (`withdraw-cancel`, tâche `withdrawn`) ; « fait à la main » réservé au principal ; plus de raison d'offert `owner` (patrons = commandes `manager`) ; rapports `slot` par horaire ; pas de changement de rôle d'un serveur en shift ; après 22h seul le menu QR est bloqué ; `Expense.closureId` ; `/me` et `/shifts/current` avec `principal` ; clôture forcée par la manager (`/admin/force-handover`, `forcedBy`) ; exemple `expectedCash` corrigé (233 000) ; exemple Order `confirmed` (il était `pending` avec une session) ; `/staff-orders` sur une table `real` ; `HANDOVER_PENDING` bloque aussi la vente directe |
| v1.7.1 brouillon | 2026-10-15 | Sans changement de forme : options de `hot_drink` (thés à 6,5 DT, cafés jusqu'à 8,5 DT) ; corrections des exemples (totaux 51 500, id du Gift) ; `/gifts` dans les exceptions du § 5 |
| v1.7 brouillon | 2026-10-15 | Plan des tables, commandes, échecs caisse et leurs événements réservés aux serveurs **en shift** (lecture comprise) ; clôture de shift (`POST /shifts/end` avec `countedCash` → ShiftClosure, PDF) ; dépenses (`/expenses`, Expense) ; `Order.waiterId` ; `/direct-sales` pour le compte d'un serveur en shift (`waiterId`) ; rapports de la manager (`/reports/sales`, `/closures`, `report:updated`) ; offerts : forme Gift, plus de ligne `gifted` |
| v1.6 brouillon | 2026-10-15 | Forme `User` ; corps et réponses de `/users` ; mot de passe temporaire généré par le serveur et renvoyé une seule fois ; règles de désactivation (pas soi-même, toujours un manager actif) |
| v1.5 brouillon | 2026-10-15 | Quatre rôles : `manager`, `waiter`, `barista`, `chef` (affiché « Cuisinier ») ; rôle `owner` supprimé (la raison `owner` de `POST /gifts` reste : offert à un patron) |
| v1.4 brouillon | 2026-10-15 | `VALIDATION_ERROR` : format de `details` précisé (`{ fields: [{ field, message }] }`) |
| v1.3 brouillon | 2026-10-15 | Groupes de choix : une liste d'options par groupe ; `eggs` (omelette ou brouillés) et `eggs_with_benedict` (Sweet Start) ; `MenuItem.choiceGroups` = liste de clés |
| v1.2 brouillon | 2026-10-15 | Décisions de la PR : `station` et droits de rupture par poste ; `choiceGroups` et `choices` (formules, Kids Menu) ; statut `expired` et `ORDER_PENDING_TTL_SECONDS` ; `NO_WAITER_ON_SHIFT` ; session ouverte à la confirmation ; tables `real` / `virtual` et `layout` ; `/direct-sales` ; champs des tâches caisse, `pay_table` (`cash` / `card`) et `print_bill` avec `expectedTotal` ; remise staff (`beneficiary`) ; annulation `waiting` et `CANCEL_WAITING` ; offert sans `orderLineId` |
| v1.1 brouillon | 2026-10-15 | Codes d'erreur 413/429/500/503 et `ACCOUNT_DISABLED` ; `clientRequestId` anti-doublon ; `unavailableReason` ; id et statut des lignes, `discountPercent` ; sessions de table ; statuts des tâches caisse, réessai et résolution manuelle ; tables et rotation du jeton QR ; `/shifts/current` ; authentification Socket.IO ; pagination ; `/health` |
| v1 brouillon | 2026-10-15 | Refonte : comptes et rôles, shifts, saisie serveur, horaires, extras, codes produit, file caisse |
