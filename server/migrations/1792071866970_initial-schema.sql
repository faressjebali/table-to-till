-- Up Migration

-- Schéma initial. Voir docs/api.md pour les formes renvoyées par l'API.
-- Argent en millimes entiers. Dates en timestamptz (UTC dans l'API).
-- Les valeurs fixes sont des CHECK sur du texte plutôt que des types ENUM : plus simples à faire évoluer.

-- Staff ---------------------------------------------------------------------

CREATE TABLE users (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  login text NOT NULL CHECK (login <> ''),
  name text NOT NULL CHECK (name <> ''),
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('waiter', 'barista', 'chef', 'manager', 'owner')),
  must_change_password boolean NOT NULL DEFAULT true,
  failed_logins integer NOT NULL DEFAULT 0 CHECK (failed_logins >= 0),
  locked_until timestamptz,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Identifiant unique sans tenir compte des majuscules.
CREATE UNIQUE INDEX users_login_key ON users (lower(login));

-- Le token n'est jamais stocké en clair : seulement son empreinte.
CREATE TABLE sessions (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);

CREATE TABLE shifts (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);
-- Un seul shift ouvert par personne.
CREATE UNIQUE INDEX shifts_one_open_per_user ON shifts (user_id) WHERE ended_at IS NULL;

-- Menu ----------------------------------------------------------------------

CREATE TABLE categories (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  section text NOT NULL CHECK (section IN ('food', 'drinks')),
  name_fr text NOT NULL UNIQUE CHECK (name_fr <> ''),
  -- Traductions en cours : l'anglais peut manquer pour l'instant.
  name_en text,
  sort_order integer NOT NULL DEFAULT 0
);

CREATE TABLE menu_items (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category_id integer NOT NULL REFERENCES categories,
  name_fr text NOT NULL CHECK (name_fr <> ''),
  name_en text,
  description_fr text,
  description_en text,
  -- NULL tant que le prix n'est pas fixé (ex. Plat de la semaine) : l'article n'est alors pas commandable.
  price integer CHECK (price > 0),
  -- Code produit LegacyPOS. NULL tant qu'il n'est pas relevé : l'article ne peut pas partir en caisse.
  pos_code text CHECK (pos_code <> ''),
  station text NOT NULL CHECK (station IN ('bar', 'kitchen', 'both')),
  -- Horaires en heure locale Africa/Tunis. 1 = lundi … 7 = dimanche.
  -- Sans available_from / available_until : pendant l'ouverture du café.
  days smallint[] NOT NULL DEFAULT '{1,2,3,4,5,6,7}'
    CHECK (cardinality(days) > 0 AND days <@ '{1,2,3,4,5,6,7}'::smallint[]),
  available_from time,
  available_until time,
  sold_out boolean NOT NULL DEFAULT false,
  note_hint_fr text,
  note_hint_en text,
  photo_url text,
  sort_order integer NOT NULL DEFAULT 0,
  -- Un article supprimé est archivé : les commandes passées y font référence.
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (available_from IS NULL OR available_until IS NULL OR available_from < available_until)
);
CREATE INDEX menu_items_category_id_idx ON menu_items (category_id);

-- Extras suggérés sous un plat (ce sont des articles normaux).
CREATE TABLE suggested_extras (
  menu_item_id integer NOT NULL REFERENCES menu_items ON DELETE CASCADE,
  extra_item_id integer NOT NULL REFERENCES menu_items ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  PRIMARY KEY (menu_item_id, extra_item_id),
  CHECK (menu_item_id <> extra_item_id)
);

-- Groupes de choix des formules et du Kids Menu (hot_drink, seasonal_juice, eggs, eggs_with_benedict).
CREATE TABLE choice_groups (
  key text PRIMARY KEY CHECK (key ~ '^[a-z_]+$'),
  name_fr text NOT NULL,
  name_en text
);

-- Une seule liste d'options par groupe ; chaque option est un article du menu.
CREATE TABLE choice_group_options (
  group_key text NOT NULL REFERENCES choice_groups ON DELETE CASCADE ON UPDATE CASCADE,
  menu_item_id integer NOT NULL REFERENCES menu_items ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  PRIMARY KEY (group_key, menu_item_id)
);

CREATE TABLE menu_item_choice_groups (
  menu_item_id integer NOT NULL REFERENCES menu_items ON DELETE CASCADE,
  group_key text NOT NULL REFERENCES choice_groups ON UPDATE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  PRIMARY KEY (menu_item_id, group_key)
);

-- Salle ---------------------------------------------------------------------

CREATE TABLE tables (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Numéro de la table dans LegacyPOS (ex. 7, ou 333 pour une table fictive).
  number integer NOT NULL UNIQUE CHECK (number > 0),
  kind text NOT NULL CHECK (kind IN ('real', 'virtual')),
  -- Jeton aléatoire du QR : seulement pour une table réelle.
  qr_token text UNIQUE,
  -- Position sur le plan de la salle, en cases d'une grille : seulement pour une table réelle.
  layout_x integer,
  layout_y integer,
  layout_w integer,
  layout_h integer,
  layout_shape text CHECK (layout_shape IN ('square', 'round')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (kind = 'real' AND qr_token IS NOT NULL)
    OR (kind = 'virtual' AND qr_token IS NULL AND layout_x IS NULL AND layout_y IS NULL
        AND layout_w IS NULL AND layout_h IS NULL AND layout_shape IS NULL)
  ),
  -- Layout : tout ou rien.
  CHECK (
    (layout_x IS NULL AND layout_y IS NULL AND layout_w IS NULL AND layout_h IS NULL AND layout_shape IS NULL)
    OR (layout_x >= 0 AND layout_y >= 0 AND layout_w > 0 AND layout_h > 0 AND layout_shape IS NOT NULL)
  )
);

-- Une « ouverture » de table, de la première commande confirmée jusqu'à l'encaissement.
CREATE TABLE table_sessions (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  table_id integer NOT NULL REFERENCES tables,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  -- Encaissement en une seule fois : un seul moyen de paiement.
  payment_method text CHECK (payment_method IN ('cash', 'card')),
  closed_by integer REFERENCES users,
  CHECK (closed_at IS NULL OR closed_at >= opened_at),
  CHECK (closed_at IS NOT NULL OR payment_method IS NULL)
);
-- Une seule session ouverte par table.
CREATE UNIQUE INDEX table_sessions_one_open_per_table ON table_sessions (table_id) WHERE closed_at IS NULL;

-- Commandes -----------------------------------------------------------------

CREATE TABLE orders (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Anti-doublon : même clientRequestId reçu deux fois → même commande.
  client_request_id uuid NOT NULL UNIQUE,
  table_id integer NOT NULL REFERENCES tables,
  -- NULL tant que la commande n'est pas confirmée : c'est la confirmation qui ouvre la session.
  table_session_id integer REFERENCES table_sessions,
  source text NOT NULL CHECK (source IN ('qr', 'waiter', 'direct')),
  status text NOT NULL CHECK (status IN ('pending', 'confirmed', 'rejected', 'expired')),
  -- NULL pour une commande QR (passée par le client).
  created_by integer REFERENCES users,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Seulement pour une commande QR en attente.
  expires_at timestamptz,
  confirmed_at timestamptz,
  confirmed_by integer REFERENCES users,
  rejected_at timestamptz,
  rejected_by integer REFERENCES users,
  reject_reason text,
  CHECK ((source = 'qr') = (created_by IS NULL)),
  CHECK (source = 'qr' OR status = 'confirmed'),
  CHECK ((status = 'confirmed') = (table_session_id IS NOT NULL)),
  CHECK ((status = 'confirmed') = (confirmed_at IS NOT NULL)),
  CHECK ((status = 'rejected') = (rejected_at IS NOT NULL)),
  CHECK (status <> 'pending' OR expires_at IS NOT NULL)
);
CREATE INDEX orders_table_id_idx ON orders (table_id);
CREATE INDEX orders_table_session_id_idx ON orders (table_session_id);
CREATE INDEX orders_pending_idx ON orders (expires_at) WHERE status = 'pending';

CREATE TABLE order_lines (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id integer NOT NULL REFERENCES orders ON DELETE CASCADE,
  menu_item_id integer NOT NULL REFERENCES menu_items,
  -- Nom et prix copiés à la création de la commande.
  name_fr text NOT NULL,
  name_en text,
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 20),
  unit_price integer NOT NULL CHECK (unit_price >= 0),
  -- Remise staff : toujours 20 % exactement.
  discount_percent integer NOT NULL DEFAULT 0 CHECK (discount_percent IN (0, 20)),
  note text CHECK (char_length(note) <= 200),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'cancelled', 'transferred', 'gifted')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_lines_order_id_idx ON order_lines (order_id);

-- Choix d'une formule ou du Kids Menu : un par groupe. Jamais tapés en caisse, gardés pour le stock.
CREATE TABLE order_line_choices (
  order_line_id integer NOT NULL REFERENCES order_lines ON DELETE CASCADE,
  group_key text NOT NULL REFERENCES choice_groups ON UPDATE CASCADE,
  menu_item_id integer NOT NULL REFERENCES menu_items,
  PRIMARY KEY (order_line_id, group_key)
);

-- Offerts : enregistrés seulement dans l'app, jamais tapés en caisse ; ils sortent du stock.
-- Sans table (offres du staff, des patrons) : seulement ici.
-- Article déjà commandé et offert : lié à sa ligne de commande, qui passe en statut « gifted ».
CREATE TABLE gifts (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_request_id uuid UNIQUE,
  table_id integer REFERENCES tables,
  order_line_id integer UNIQUE REFERENCES order_lines,
  menu_item_id integer NOT NULL REFERENCES menu_items,
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 20),
  reason text NOT NULL CHECK (reason IN ('unhappy_customer', 'staff', 'owner')),
  given_by integer NOT NULL REFERENCES users,
  beneficiary text,
  note text NOT NULL CHECK (note <> '' AND char_length(note) <= 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (order_line_id IS NULL OR table_id IS NOT NULL)
);
CREATE INDEX gifts_created_at_idx ON gifts (created_at);

-- Choix d'un offert sans ligne de commande (sinon les choix sont sur la ligne).
CREATE TABLE gift_choices (
  gift_id integer NOT NULL REFERENCES gifts ON DELETE CASCADE,
  group_key text NOT NULL REFERENCES choice_groups ON UPDATE CASCADE,
  menu_item_id integer NOT NULL REFERENCES menu_items,
  PRIMARY KEY (gift_id, group_key)
);

-- File caisse ---------------------------------------------------------------

CREATE TABLE pos_jobs (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type text NOT NULL CHECK (type IN (
    'enter_order', 'discount', 'cancel_line', 'transfer_line', 'move_table', 'pay_table', 'print_bill'
  )),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'in_progress', 'done', 'failed', 'waiting', 'manual')),
  table_id integer NOT NULL REFERENCES tables,
  order_id integer REFERENCES orders,
  -- Champs propres au type (lignes, posCode, percent, method, expectedTotal…), voir docs/api.md § PosJob.
  payload jsonb NOT NULL DEFAULT '{}',
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text,
  last_step text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  heartbeat_at timestamptz,
  finished_at timestamptz,
  resolved_by integer REFERENCES users,
  resolve_note text,
  CHECK (type <> 'enter_order' OR order_id IS NOT NULL),
  -- Seule une annulation peut attendre (dernier article de la table en caisse).
  CHECK (status <> 'waiting' OR type = 'cancel_line')
);
-- Une seule tâche en cours à la fois.
CREATE UNIQUE INDEX pos_jobs_one_in_progress ON pos_jobs ((true)) WHERE status = 'in_progress';
CREATE INDEX pos_jobs_queue_idx ON pos_jobs (created_at, id) WHERE status = 'queued';
CREATE INDEX pos_jobs_status_idx ON pos_jobs (status);

-- Journal d'actions -----------------------------------------------------------

CREATE TABLE audit_log (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- NULL pour une action du système (ex. expiration d'une commande, agent caisse).
  user_id integer REFERENCES users,
  action text NOT NULL,
  entity_type text,
  entity_id integer,
  table_id integer REFERENCES tables,
  note text,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_created_at_idx ON audit_log (created_at DESC, id DESC);

-- Down Migration

DROP TABLE audit_log;
DROP TABLE pos_jobs;
DROP TABLE gift_choices;
DROP TABLE gifts;
DROP TABLE order_line_choices;
DROP TABLE order_lines;
DROP TABLE orders;
DROP TABLE table_sessions;
DROP TABLE tables;
DROP TABLE menu_item_choice_groups;
DROP TABLE choice_group_options;
DROP TABLE choice_groups;
DROP TABLE suggested_extras;
DROP TABLE menu_items;
DROP TABLE categories;
DROP TABLE shifts;
DROP TABLE sessions;
DROP TABLE users;
