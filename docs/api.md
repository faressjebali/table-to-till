# Contrat d'API — Coffee QR

> Brouillon v1 (15 octobre 2026). À relire ensemble. Toute modification passe par une PR dédiée, annoncée à l'autre.

## 1. Règles générales

| Règle | Valeur |
| --- | --- |
| URL de base (local) | `http://localhost:3000/api` |
| Format | JSON (`Content-Type: application/json`), sauf upload photo (multipart) |
| Noms de champs | camelCase |
| IDs | entiers |
| Dates | ISO 8601 UTC (`2026-10-20T14:32:05Z`). Les horaires de disponibilité sont en heure locale Africa/Tunis. |
| Argent | **entiers en millimes** (1 DT = 1000). `5500` = 5,5 DT. Jamais de décimaux. |
| Langues | `{ "fr": "...", "en": "..." }` pour tout texte visible par le client |

### Authentification

| Appelant | Méthode |
| --- | --- |
| Client (menu QR) | aucune ; `tableToken` valide obligatoire |
| Staff (PWA) | `Authorization: Bearer <token>` obtenu par `POST /auth/login` (30 jours) |
| Agent caisse | `X-Agent-Key: <secret>` (dans le `.env` du PC de caisse) |

Rôles : `waiter`, `barista`, `chef`, `manager`, `owner`. Chaque endpoint staff indique les rôles autorisés.

### Erreurs

```json
{ "error": { "code": "ITEM_UNAVAILABLE", "message": "Croissant indisponible", "details": { "menuItemId": 12 } } }
```

| HTTP | Codes |
| --- | --- |
| 400 | `VALIDATION_ERROR` |
| 401 | `UNAUTHORIZED`, `PASSWORD_CHANGE_REQUIRED` |
| 403 | `FORBIDDEN` (mauvais rôle), `NOT_ON_SHIFT` |
| 404 | `NOT_FOUND`, `TABLE_NOT_FOUND` |
| 409 | `ITEM_UNAVAILABLE`, `OUTSIDE_HOURS`, `INVALID_STATUS` |
| 423 | `ACCOUNT_LOCKED` |

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
  "availability": { "days": [1,2,3,4,5,6,7], "from": null, "until": null },
  "suggestedExtraIds": [41, 42, 43],
  "noteHint": null,
  "posCode": "1234"
}
```
- `availability.days` : 1 = lundi … 7 = dimanche. `from`/`until` : `"HH:MM"` ou `null`.
- `noteHint` : aide affichée au client pour les articles à choix (ex. `{ "fr": "Précisez café ou thé", "en": "Coffee or tea?" }`).
- `posCode` : renvoyé seulement au staff et à l'agent, jamais aux clients.
- `available` : faux si rupture **ou** hors horaire (pour le client).

### Order
```json
{
  "id": 154,
  "table": { "id": 7, "number": 7 },
  "source": "qr",
  "status": "pending",
  "lines": [
    { "menuItemId": 3, "name": { "fr": "Cheese Burger", "en": "Cheese Burger" }, "quantity": 1, "note": "sans oignon", "unitPrice": 28500, "lineTotal": 28500 },
    { "menuItemId": 41, "name": { "fr": "Bacon de bœuf", "en": "Beef bacon" }, "quantity": 1, "note": null, "unitPrice": 8500, "lineTotal": 8500 }
  ],
  "total": 37000,
  "createdAt": "...", "confirmedAt": null, "confirmedBy": null,
  "pos": { "status": "not_sent", "error": null }
}
```
- `source` : `qr` (client) ou `waiter` (saisie serveur).
- `status` : `pending` → `confirmed` | `rejected`. Une commande `waiter` est créée directement `confirmed`.
- `pos.status` : `not_sent` → `queued` → `entered` | `failed`.
- Les prix sont copiés dans la commande à sa création.

### Table
```json
{ "id": 7, "number": 7, "state": "occupied", "openTotal": 37000, "pendingOrders": 1 }
```

### PosJob (file caisse)
```json
{ "id": 88, "type": "enter_order", "orderId": 154, "tableNumber": 7,
  "lines": [ { "posCode": "1234", "quantity": 1, "note": "sans oignon" }, { "posCode": "2041", "quantity": 1, "note": null } ],
  "status": "queued", "attempts": 0, "createdAt": "..." }
```
`type` : `enter_order`, `discount`, `cancel_line`, `transfer_line`, `move_table` ; plus tard `pay_table`, `print_bill` (questions ouvertes). Chaque type a ses propres champs (`note`, `toTableNumber`, `percent`…).

## 3. Client (sans connexion)

| Méthode | Chemin | Corps | Réponse |
| --- | --- | --- | --- |
| GET | `/tables/:tableToken` | — | `{ id, number }` ou 404 `TABLE_NOT_FOUND` |
| GET | `/menu` | — | `{ categories: [ { id, name, sortOrder, items: [MenuItem sans posCode] } ] }` |
| POST | `/orders` | `{ tableToken, lines: [ { menuItemId, quantity, note } ] }` | 201 `{ orderId, status: "pending", total }` |

Règles `POST /orders` : 1–30 lignes, quantité 1–20, note ≤ 200 caractères, articles disponibles **à l'heure actuelle**. Le serveur calcule tous les prix.

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
| GET | `/tables` | — | `{ tables: [Table] }` |
| GET | `/tables/:id/orders` | — | `{ orders: [Order] }` (non encore encaissées) |
| GET | `/orders?status=pending` | — | `{ orders: [Order] }` |
| POST | `/orders/:id/confirm` | — | Order (doit être en shift) |
| POST | `/orders/:id/reject` | `{ reason? }` | Order |
| POST | `/staff-orders` | `{ tableId, lines: [ { menuItemId, quantity, note } ] }` | 201 Order (`source: "waiter"`, `confirmed`) |
| PATCH | `/menu-items/:id/availability` | `{ available }` | MenuItem (serveur, barista, manager) |
| POST | `/push/subscribe` | abonnement Web Push | 204 |

### Actions sur une table (chacune crée une tâche dans la file caisse, sauf « offrir »)

| Méthode | Chemin | Corps | Effet caisse |
| --- | --- | --- | --- |
| POST | `/tables/:id/discount` | `{ percent: 20, lineIds?: [..], note }` (note obligatoire) | tâche `discount` |
| POST | `/order-lines/:id/cancel` | `{ quantity?, note }` (note obligatoire) | tâche `cancel_line` |
| POST | `/order-lines/:id/transfer` | `{ toTableId, quantity? }` | tâche `transfer_line` |
| POST | `/tables/:id/move` | `{ toTableId }` | tâche `move_table` |
| POST | `/gifts` | `{ tableId?, menuItemId, quantity, reason: "unhappy_customer" \| "staff" \| "owner", beneficiary?, note }` | **aucune** (jamais tapé en caisse) |
| POST | `/tables/:id/pay` | à définir | tâche `pay_table` (question ouverte) |
| POST | `/tables/:id/print-bill` | — | tâche `print_bill` (question ouverte) |

Toutes ces actions sont écrites dans le journal d'actions.

## 6. Manager (rôle `manager`, `owner`)

| Méthode | Chemin | Rôle |
| --- | --- | --- |
| GET/POST | `/users` | lister / créer (nom, login, rôle, mot de passe temporaire) |
| PATCH | `/users/:id` | changer rôle, désactiver/réactiver |
| POST | `/users/:id/reset-password` | nouveau mot de passe temporaire |
| GET/POST/PUT/DELETE | `/categories`, `/menu-items` | édition du menu (noms FR/EN, prix, code, horaires, extras suggérés) |
| POST | `/uploads` | photo (jpg/png ≤ 5 Mo) → `{ photoUrl }` (redimensionnée 800 px, WebP) |
| GET | `/audit-log` | journal d'actions |

Rôles barista / chef / owner : endpoints ajoutés au fur et à mesure (achats, arrivages, avaries, offres staff).

## 7. Agent caisse

| Méthode | Chemin | Corps | Réponse |
| --- | --- | --- | --- |
| GET | `/pos/jobs/next` | — | PosJob le plus ancien `queued`, ou 204 |
| POST | `/pos/jobs/:id/start` | — | 200 (passe en `in_progress`) |
| POST | `/pos/jobs/:id/done` | — | 200 (`entered`) |
| POST | `/pos/jobs/:id/fail` | `{ error, step, screenshot? }` | 200 (`failed`, staff alerté) |
| POST | `/pos/heartbeat` | `{ state: "idle" \| "busy" \| "waiting_for_human" }` | 204 |

## 8. Temps réel (Socket.IO)

| Événement | Destinataires | Données |
| --- | --- | --- |
| `order:new` | serveurs en shift | Order |
| `order:updated` | staff | Order |
| `table:updated` | staff | Table |
| `menu:updated` | staff, clients | `{ menuItemId, available }` |
| `pos:job` | agent | `{ jobId }` |
| `pos:failed` | staff | `{ orderId, error }` |
| `pos:status` | manager | `{ state, lastSeenAt }` |

Après reconnexion, chaque client recharge via REST.

## 9. Historique

| Version | Date | Changement |
| --- | --- | --- |
| v1 brouillon | 2026-10-15 | Refonte : comptes et rôles, shifts, saisie serveur, horaires, extras, codes produit, file caisse |
