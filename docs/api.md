# Contrat d'API — Coffee QR

> Brouillon v1.5 (15 octobre 2026). À relire ensemble. Toute modification passe par une PR dédiée, annoncée à l'autre.

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
| 403 | `ACCOUNT_DISABLED` | Compte désactivé par la manager |
| 404 | `NOT_FOUND`, `TABLE_NOT_FOUND` | Ressource ou jeton de table inconnu |
| 409 | `ITEM_UNAVAILABLE` | Article en rupture |
| 409 | `OUTSIDE_HOURS` | Article hors de ses horaires |
| 409 | `INVALID_STATUS` | Action impossible dans l'état actuel (ex. commande déjà confirmée par un autre serveur, ou expirée) |
| 409 | `NO_WAITER_ON_SHIFT` | Commande QR refusée : aucun serveur en shift |
| 409 | `NO_FREE_VIRTUAL_TABLE` | Vente directe impossible : aucune table fictive libre |
| 409 | `CANCEL_WAITING` | Encaissement impossible : une annulation attend encore d'être saisie en caisse (voir PosJob `waiting`) |
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
| `hot_drink` | Café ou thé / Coffee or tea | tous les cafés et thés de la carte | toutes les formules petit-déjeuner |
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
  "status": "pending",
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
  "total": 37000,
  "createdAt": "...", "confirmedAt": null, "confirmedBy": null,
  "pos": { "status": "not_sent", "error": null }
}
```
- `source` : `qr` (client), `waiter` (saisie serveur) ou `direct` (vente directe au comptoir, sur une table fictive).
- `status` : `pending` → `confirmed` | `rejected` | `expired`. Une commande `waiter` ou `direct` est créée directement `confirmed`.
- `expired` : commande `pending` non traitée après `ORDER_PENDING_TTL_SECONDS` (300 s par défaut). La table en est informée (`order:updated`).
- `tableSessionId` : `null` tant que la commande est `pending` (ou si elle est rejetée ou expirée). C'est la **confirmation** qui rattache la commande à la session de la table, et l'ouvre si la table était libre.
- `choices` : présent sur les lignes d'articles ayant des `choiceGroups`, un choix par groupe. Les choix valent pour toute la quantité de la ligne ; pour des choix différents, le client ajoute une autre ligne.
- Ligne `status` : `active`, `cancelled` (annulée, avec note), `transferred` (déplacée vers une autre table), `gifted` (offerte, jamais en caisse).
- `discountPercent` : 0 ou 20 (remise staff). `lineTotal = quantity × unitPrice × (100 − discountPercent) / 100`, arrondi au millime. Les lignes `cancelled`, `transferred` et `gifted` comptent 0 dans `total`.
- `pos.status` : `not_sent` → `queued` → `entered` | `failed` | `manual` (saisie à la main au comptoir).
- Les prix sont copiés dans la commande à sa création.

### TableSession (une « ouverture » de table, jusqu'à l'encaissement)
```json
{ "id": 61, "tableId": 7, "openedAt": "...", "closedAt": null, "status": "open", "total": 37000, "orderIds": [154] }
```
- Ouverte automatiquement par la première commande **confirmée** sur une table libre ; fermée par l'encaissement (`POST /tables/:id/pay`).
- Le changement de table (`move`) déplace la session entière.
- Une table se paie **en une seule fois** : pas de division de l'addition, pas de paiement mixte.

### Table
```json
{ "id": 7, "number": 7, "kind": "real", "state": "occupied", "openSessionId": 61, "openTotal": 37000, "pendingOrders": 1,
  "layout": { "x": 2, "y": 0, "w": 1, "h": 1, "shape": "square" } }
```
- `kind` : `real` (table de la salle, avec QR) ou `virtual` (table fictive de LegacyPOS, ex. 333, pour les ventes directes ; sans QR).
- `state` : `free` ou `occupied`. Une commande `pending` ne rend pas la table `occupied` : elle compte seulement dans `pendingOrders`.
- `openTotal` : seulement les commandes confirmées.
- `layout` : position sur le plan de la salle, en cases d'une grille (`shape` : `square` ou `round`) ; `null` pour une table `virtual`.

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
- `status` : `queued` → `in_progress` → `done` | `failed` ; `failed` → `queued` (réessai) ou `manual` (fait à la main).
- `waiting` (seulement `cancel_line`) : l'annulation porterait sur le **dernier article** de la table en caisse, ce qui fait planter LegacyPOS. La tâche attend, et passe `queued` dès que la table a d'autres articles saisis en caisse. Elle peut aussi être réglée à la main (`manual`). Une tâche `waiting` n'est jamais renvoyée à l'agent.
- **Une seule** tâche `in_progress` à la fois. Les tâches sont traitées dans l'ordre de création.
- Si une tâche reste `in_progress` plus de 2 minutes sans heartbeat de l'agent, elle passe `failed` (`lastError: "AGENT_TIMEOUT"`) et le staff est alerté — **jamais remise automatiquement en file**, pour ne pas saisir deux fois la même chose.

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
| GET | `/me` | — | `{ id, name, role, onShift }` |

## 5. Serveur (rôle `waiter`, sauf mention)

Toutes les actions de cette section qui modifient quelque chose exigent d'être **en shift** (`NOT_ON_SHIFT`), sauf démarrer le shift, les ruptures et l'abonnement push.

| Méthode | Chemin | Corps | Réponse |
| --- | --- | --- | --- |
| POST | `/shifts/start` | — | `{ shiftId, startedAt }` |
| POST | `/shifts/end` | — | 204 |
| GET | `/shifts/current` | — | `{ waiters: [ { id, name, startedAt } ] }` (tout le staff) |
| GET | `/tables` | — | `{ tables: [Table] }` (tables `real`, pour le plan de la salle) |
| GET | `/tables/:id/session` | — | `{ session: TableSession, orders: [Order] }` (session ouverte) |
| GET | `/orders?status=pending` | — | `{ items: [Order], nextCursor }` |
| POST | `/orders/:id/confirm` | — | Order (409 `INVALID_STATUS` si déjà traitée ou expirée) |
| POST | `/orders/:id/reject` | `{ reason? }` | Order |
| POST | `/staff-orders` | `{ clientRequestId, tableId, lines: [ { menuItemId, quantity, note, choices? } ] }` | 201 Order (`source: "waiter"`, `confirmed`) |
| POST | `/direct-sales` | `{ clientRequestId, lines: [ { menuItemId, quantity, note, choices? } ], method: "cash" \| "card" }` | 201 Order (`source: "direct"`, `confirmed`) — serveur en shift ou barista |
| PATCH | `/menu-items/:id/availability` | `{ available }` | MenuItem — serveur, manager : tout article ; barista : `station` `bar` ou `both` ; chef : `kitchen` ou `both` ; sinon `FORBIDDEN` |
| POST | `/push/subscribe` | abonnement Web Push | 204 (tout le staff) |

Vente directe (`/direct-sales`) : le serveur attribue une **table fictive libre** (sinon 409 `NO_FREE_VIRTUAL_TABLE`), crée la commande, puis met en file `enter_order` et `pay_table` (dans cet ordre) ; la session de la table fictive est fermée. Le numéro de la table fictive est dans `Order.table`.

### Actions sur une table (chacune crée une tâche dans la file caisse, sauf « offrir »)

| Méthode | Chemin | Corps | Effet caisse |
| --- | --- | --- | --- |
| POST | `/tables/:id/discount` | `{ percent: 20, lineIds?: [..], beneficiary, note? }` (remise staff : `percent` vaut toujours 20 ; `beneficiary` obligatoire = pour qui ; sans `lineIds` = toute la table) | tâche `discount` |
| POST | `/order-lines/:id/cancel` | `{ quantity?, note }` (note obligatoire) | tâche `cancel_line` (`waiting` si c'est le dernier article de la table en caisse) |
| POST | `/order-lines/:id/transfer` | `{ toTableId, quantity? }` | tâche `transfer_line` |
| POST | `/tables/:id/move` | `{ toTableId }` | tâche `move_table` |
| POST | `/gifts` | `{ clientRequestId, tableId?, menuItemId, quantity, choices?, reason: "unhappy_customer" \| "staff" \| "owner", beneficiary?, note }` | **aucune** (jamais tapé en caisse) |
| POST | `/tables/:id/pay` | `{ method: "cash" \| "card" }` | tâche `pay_table` ; la session est fermée tout de suite dans l'app ; 409 `CANCEL_WAITING` si une annulation de la table est `waiting` |
| POST | `/tables/:id/print-bill` | — | tâche `print_bill` |

- **Offrir** : un article est offert **dès le départ**, jamais après avoir été tapé en caisse. L'offert crée une ligne `gifted` (dans la session de la table si `tableId`), qui sort du stock. Rôles : serveur, barista (offres staff), manager. La raison `owner` veut dire « offert à un patron » : ce n'est pas un rôle.
- Toutes ces actions sont écrites dans le journal d'actions.

### Échecs caisse (serveur, manager)

| Méthode | Chemin | Corps | Effet |
| --- | --- | --- | --- |
| GET | `/pos/jobs?status=failed` | — | `{ items: [PosJob], nextCursor }` (aussi `status=waiting`) |
| POST | `/pos/jobs/:id/retry` | — | `failed` → `queued` |
| POST | `/pos/jobs/:id/resolve-manually` | `{ note? }` | `failed` ou `waiting` → `manual` (fait à la main au comptoir) ; commande `pos.status = "manual"` |

## 6. Manager (rôle `manager`)

| Méthode | Chemin | Rôle |
| --- | --- | --- |
| GET/POST | `/users` | lister / créer (nom, login, rôle, mot de passe temporaire) |
| PATCH | `/users/:id` | changer rôle, désactiver/réactiver |
| POST | `/users/:id/reset-password` | nouveau mot de passe temporaire |
| GET/POST/PUT/DELETE | `/categories`, `/menu-items` | édition du menu (noms FR/EN, prix, code, horaires, extras suggérés, `station`, `choiceGroups`) ; dont le Plat de la semaine |
| GET/PUT | `/admin/choice-groups/:key` | options d'un groupe de choix (ex. `seasonal_juice` : `{ optionIds: [..] }`) |
| GET/POST/PATCH | `/admin/tables` | lister, créer, renommer les tables ; `kind` (`real` / `virtual`) et `layout` (plan de la salle) |
| POST | `/admin/tables/:id/rotate-token` | nouveau jeton QR (l'ancien QR ne marche plus) → `{ tableToken }` ; 409 `INVALID_STATUS` pour une table `virtual` |
| POST | `/uploads` | photo (jpg/png ≤ 5 Mo) → `{ photoUrl }` (redimensionnée 800 px, WebP) |
| GET | `/audit-log` | journal d'actions, paginé |

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
| Staff | `auth: { token }` | selon son rôle ; déconnecté si compte désactivé |
| Agent | `auth: { agentKey }` | `pos:job` |

### Événements
| Événement | Destinataires | Données |
| --- | --- | --- |
| `order:new` | serveurs en shift | Order |
| `order:updated` | staff (+ la table concernée : `{ orderId, status }`, y compris `expired`) | Order |
| `table:updated` | staff | Table |
| `menu:updated` | staff, clients | `{ menuItemId, available, unavailableReason }` |
| `pos:job` | agent | `{ jobId }` |
| `pos:failed` | staff | `{ jobId, orderId, error }` |
| `pos:waiting` | serveurs en shift | `{ jobId, tableNumber, orderLineId }` (annulation en attente : dernier article de la table) |
| `pos:status` | manager | `{ state, lastSeenAt }` |
| `session:revoked` | staff concerné | `{ reason: "ACCOUNT_DISABLED" \| "LOGGED_OUT" }` |

Après reconnexion, chaque client recharge via REST.

## 9. Divers

| Méthode | Chemin | Réponse |
| --- | --- | --- |
| GET | `/health` | `{ status: "ok", db: "ok", time: "..." }` (sans connexion ; pour le déploiement et l'agent) |

## 10. Historique

| Version | Date | Changement |
| --- | --- | --- |
| v1.5 brouillon | 2026-10-15 | Quatre rôles : `manager`, `waiter`, `barista`, `chef` (affiché « Cuisinier ») ; rôle `owner` supprimé (la raison `owner` de `POST /gifts` reste : offert à un patron) |
| v1.4 brouillon | 2026-10-15 | `VALIDATION_ERROR` : format de `details` précisé (`{ fields: [{ field, message }] }`) |
| v1.3 brouillon | 2026-10-15 | Groupes de choix : une liste d'options par groupe ; `eggs` (omelette ou brouillés) et `eggs_with_benedict` (Sweet Start) ; `MenuItem.choiceGroups` = liste de clés |
| v1.2 brouillon | 2026-10-15 | Décisions de la PR : `station` et droits de rupture par poste ; `choiceGroups` et `choices` (formules, Kids Menu) ; statut `expired` et `ORDER_PENDING_TTL_SECONDS` ; `NO_WAITER_ON_SHIFT` ; session ouverte à la confirmation ; tables `real` / `virtual` et `layout` ; `/direct-sales` ; champs des tâches caisse, `pay_table` (`cash` / `card`) et `print_bill` avec `expectedTotal` ; remise staff (`beneficiary`) ; annulation `waiting` et `CANCEL_WAITING` ; offert sans `orderLineId` |
| v1.1 brouillon | 2026-10-15 | Codes d'erreur 413/429/500/503 et `ACCOUNT_DISABLED` ; `clientRequestId` anti-doublon ; `unavailableReason` ; id et statut des lignes, `discountPercent` ; sessions de table ; statuts des tâches caisse, réessai et résolution manuelle ; tables et rotation du jeton QR ; `/shifts/current` ; authentification Socket.IO ; pagination ; `/health` |
| v1 brouillon | 2026-10-15 | Refonte : comptes et rôles, shifts, saisie serveur, horaires, extras, codes produit, file caisse |
