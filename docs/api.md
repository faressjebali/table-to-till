# Contrat d'API — Coffee QR

> Brouillon v1.1 (15 octobre 2026). À relire ensemble. Toute modification passe par une PR dédiée, annoncée à l'autre.

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

Rôles : `waiter`, `barista`, `chef`, `manager`, `owner`. Chaque endpoint staff indique les rôles autorisés.
Un compte désactivé est refusé partout (`ACCOUNT_DISABLED`) et ses connexions temps réel sont coupées.

### Erreurs

```json
{ "error": { "code": "ITEM_UNAVAILABLE", "message": "Croissant indisponible", "details": { "menuItemId": 12 } } }
```

| HTTP | Codes | Quand |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Corps ou paramètres invalides (`details` liste les champs) |
| 401 | `UNAUTHORIZED` | Token absent, invalide ou expiré |
| 401 | `PASSWORD_CHANGE_REQUIRED` | Première connexion : changer le mot de passe d'abord |
| 403 | `FORBIDDEN` | Mauvais rôle |
| 403 | `NOT_ON_SHIFT` | Action réservée aux serveurs en shift |
| 403 | `ACCOUNT_DISABLED` | Compte désactivé par la manager |
| 404 | `NOT_FOUND`, `TABLE_NOT_FOUND` | Ressource ou jeton de table inconnu |
| 409 | `ITEM_UNAVAILABLE` | Article en rupture |
| 409 | `OUTSIDE_HOURS` | Article hors de ses horaires |
| 409 | `INVALID_STATUS` | Action impossible dans l'état actuel (ex. commande déjà confirmée par un autre serveur) |
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
  "noteHint": null,
  "posCode": "1234"
}
```
- `availability.days` : 1 = lundi … 7 = dimanche. `from`/`until` : `"HH:MM"` ou `null`.
- `available` : vrai si commandable **maintenant**.
- `unavailableReason` : `null`, `"sold_out"` (rupture → **grisé** chez le client) ou `"outside_hours"` (hors horaire → **masqué** chez le client).
- `noteHint` : aide affichée pour les articles à choix (ex. `{ "fr": "Précisez café ou thé", "en": "Coffee or tea?" }`).
- `posCode` : renvoyé seulement au staff et à l'agent, jamais aux clients.

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
      "lineTotal": 8500, "status": "active" }
  ],
  "total": 37000,
  "createdAt": "...", "confirmedAt": null, "confirmedBy": null,
  "pos": { "status": "not_sent", "error": null }
}
```
- `source` : `qr` (client) ou `waiter` (saisie serveur).
- `status` : `pending` → `confirmed` | `rejected`. Une commande `waiter` est créée directement `confirmed`.
- Ligne `status` : `active`, `cancelled` (annulée, avec note), `transferred` (déplacée vers une autre table), `gifted` (offerte, jamais en caisse).
- `discountPercent` : 0 ou 20. `lineTotal = quantity × unitPrice × (100 − discountPercent) / 100`, arrondi au millime. Les lignes `cancelled`, `transferred` et `gifted` comptent 0 dans `total`.
- `pos.status` : `not_sent` → `queued` → `entered` | `failed` | `manual` (saisie à la main au comptoir).
- Les prix sont copiés dans la commande à sa création.

### TableSession (une « ouverture » de table, jusqu'à l'encaissement)
```json
{ "id": 61, "tableId": 7, "openedAt": "...", "closedAt": null, "status": "open", "total": 37000, "orderIds": [154] }
```
- Ouverte automatiquement par la première commande sur une table libre ; fermée par l'encaissement.
- Le changement de table (`move`) déplace la session entière.

### Table
```json
{ "id": 7, "number": 7, "state": "occupied", "openSessionId": 61, "openTotal": 37000, "pendingOrders": 1 }
```
`state` : `free` ou `occupied`.

### PosJob (file caisse)
```json
{ "id": 88, "type": "enter_order", "orderId": 154, "tableNumber": 7,
  "lines": [ { "orderLineId": 901, "posCode": "1234", "quantity": 1, "note": "sans oignon" },
             { "orderLineId": 902, "posCode": "2041", "quantity": 1, "note": null } ],
  "status": "queued", "attempts": 0, "lastError": null, "createdAt": "...", "startedAt": null }
```
- `type` : `enter_order`, `discount`, `cancel_line`, `transfer_line`, `move_table` ; plus tard `pay_table`, `print_bill` (questions ouvertes). Chaque type a ses propres champs (`note`, `toTableNumber`, `percent`…).
- `status` : `queued` → `in_progress` → `done` | `failed` ; `failed` → `queued` (réessai) ou `manual` (fait à la main).
- **Une seule** tâche `in_progress` à la fois. Les tâches sont traitées dans l'ordre de création.
- Si une tâche reste `in_progress` plus de 2 minutes sans heartbeat de l'agent, elle passe `failed` (`lastError: "AGENT_TIMEOUT"`) et le staff est alerté — **jamais remise automatiquement en file**, pour ne pas saisir deux fois la même chose.

## 3. Client (sans connexion)

| Méthode | Chemin | Corps | Réponse |
| --- | --- | --- | --- |
| GET | `/tables/:tableToken` | — | `{ id, number }` ou 404 `TABLE_NOT_FOUND` |
| GET | `/menu` | — | `{ categories: [ { id, name, sortOrder, items: [MenuItem sans posCode] } ] }` |
| POST | `/orders` | `{ clientRequestId, tableToken, lines: [ { menuItemId, quantity, note } ] }` | 201 `{ orderId, status: "pending", total }` |

Règles `POST /orders` : 1–30 lignes, quantité 1–20, note ≤ 200 caractères, articles disponibles **à l'heure actuelle**. Le serveur calcule tous les prix. Limite : voir anti-abus.

## 4. Authentification staff

| Méthode | Chemin | Corps | Réponse |
| --- | --- | --- | --- |
| POST | `/auth/login` | `{ login, password }` | `{ token, user: { id, name, role, mustChangePassword } }` |
| POST | `/auth/change-password` | `{ currentPassword, newPassword }` | 204 |
| POST | `/auth/logout` | — | 204 |
| GET | `/me` | — | `{ id, name, role, onShift }` |

## 5. Serveur (rôle `waiter`, sauf mention)

| Méthode | Chemin | Corps | Réponse |
| --- | --- | --- | --- |
| POST | `/shifts/start` | — | `{ shiftId, startedAt }` |
| POST | `/shifts/end` | — | 204 |
| GET | `/shifts/current` | — | `{ waiters: [ { id, name, startedAt } ] }` (tout le staff) |
| GET | `/tables` | — | `{ tables: [Table] }` |
| GET | `/tables/:id/session` | — | `{ session: TableSession, orders: [Order] }` (session ouverte) |
| GET | `/orders?status=pending` | — | `{ items: [Order], nextCursor }` |
| POST | `/orders/:id/confirm` | — | Order (doit être en shift ; 409 si déjà traitée) |
| POST | `/orders/:id/reject` | `{ reason? }` | Order |
| POST | `/staff-orders` | `{ clientRequestId, tableId, lines: [ { menuItemId, quantity, note } ] }` | 201 Order (`source: "waiter"`, `confirmed`) |
| PATCH | `/menu-items/:id/availability` | `{ available }` | MenuItem (serveur, barista, manager) |
| POST | `/push/subscribe` | abonnement Web Push | 204 (tout le staff) |

### Actions sur une table (chacune crée une tâche dans la file caisse, sauf « offrir »)

| Méthode | Chemin | Corps | Effet caisse |
| --- | --- | --- | --- |
| POST | `/tables/:id/discount` | `{ percent: 20, lineIds?: [..], note }` (note obligatoire ; sans `lineIds` = toute la table) | tâche `discount` |
| POST | `/order-lines/:id/cancel` | `{ quantity?, note }` (note obligatoire) | tâche `cancel_line` |
| POST | `/order-lines/:id/transfer` | `{ toTableId, quantity? }` | tâche `transfer_line` |
| POST | `/tables/:id/move` | `{ toTableId }` | tâche `move_table` |
| POST | `/gifts` | `{ clientRequestId, tableId?, orderLineId?, menuItemId, quantity, reason: "unhappy_customer" \| "staff" \| "owner", beneficiary?, note }` | **aucune** (jamais tapé en caisse) |
| POST | `/tables/:id/pay` | à définir | tâche `pay_table` (question ouverte) |
| POST | `/tables/:id/print-bill` | — | tâche `print_bill` (question ouverte) |

Toutes ces actions sont écrites dans le journal d'actions.

### Échecs caisse (serveur, manager)

| Méthode | Chemin | Corps | Effet |
| --- | --- | --- | --- |
| GET | `/pos/jobs?status=failed` | — | `{ items: [PosJob], nextCursor }` |
| POST | `/pos/jobs/:id/retry` | — | `failed` → `queued` |
| POST | `/pos/jobs/:id/resolve-manually` | `{ note? }` | `failed` → `manual` (saisi à la main au comptoir) ; commande `pos.status = "manual"` |

## 6. Manager (rôle `manager`, `owner`)

| Méthode | Chemin | Rôle |
| --- | --- | --- |
| GET/POST | `/users` | lister / créer (nom, login, rôle, mot de passe temporaire) |
| PATCH | `/users/:id` | changer rôle, désactiver/réactiver |
| POST | `/users/:id/reset-password` | nouveau mot de passe temporaire |
| GET/POST/PUT/DELETE | `/categories`, `/menu-items` | édition du menu (noms FR/EN, prix, code, horaires, extras suggérés) |
| GET/POST/PATCH | `/admin/tables` | lister, créer, renommer les tables |
| POST | `/admin/tables/:id/rotate-token` | nouveau jeton QR (l'ancien QR ne marche plus) → `{ tableToken }` |
| POST | `/uploads` | photo (jpg/png ≤ 5 Mo) → `{ photoUrl }` (redimensionnée 800 px, WebP) |
| GET | `/audit-log` | journal d'actions, paginé |

Rôles barista / chef / owner : endpoints ajoutés au fur et à mesure (achats, arrivages, avaries, offres staff).

## 7. Agent caisse

| Méthode | Chemin | Corps | Réponse |
| --- | --- | --- | --- |
| GET | `/pos/jobs/next` | — | PosJob le plus ancien `queued`, ou 204 (rien, ou une tâche déjà `in_progress`) |
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
| `order:updated` | staff (+ la table concernée : `{ orderId, status }`) | Order |
| `table:updated` | staff | Table |
| `menu:updated` | staff, clients | `{ menuItemId, available, unavailableReason }` |
| `pos:job` | agent | `{ jobId }` |
| `pos:failed` | staff | `{ jobId, orderId, error }` |
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
| v1.1 brouillon | 2026-10-15 | Codes d'erreur 413/429/500/503 et `ACCOUNT_DISABLED` ; `clientRequestId` anti-doublon ; `unavailableReason` ; id et statut des lignes, `discountPercent` ; sessions de table ; statuts des tâches caisse, réessai et résolution manuelle ; tables et rotation du jeton QR ; `/shifts/current` ; authentification Socket.IO ; pagination ; `/health` |
| v1 brouillon | 2026-10-15 | Refonte : comptes et rôles, shifts, saisie serveur, horaires, extras, codes produit, file caisse |
