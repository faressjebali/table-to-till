-- Up Migration

-- Contrats v1.7 et v1.8.

-- Un offert n'est jamais une ligne de commande : il est seulement dans gifts.
-- Plus de statut de ligne « gifted », plus de lien entre un offert et une ligne.
ALTER TABLE order_lines DROP CONSTRAINT order_lines_status_check;
ALTER TABLE order_lines ADD CONSTRAINT order_lines_status_check
  CHECK (status IN ('active', 'cancelled', 'transferred'));
-- Supprime aussi les contraintes qui portent sur cette colonne.
ALTER TABLE gifts DROP COLUMN order_line_id;

-- Offert sur une table : rattaché à la session ouverte de la table (GET /tables/:id/session).
ALTER TABLE gifts ADD COLUMN table_session_id integer REFERENCES table_sessions;
ALTER TABLE gifts ADD CONSTRAINT gifts_session_needs_table
  CHECK (table_session_id IS NULL OR table_id IS NOT NULL);
CREATE INDEX gifts_table_session_id_idx ON gifts (table_session_id);

-- Plus d'offre « patron » : patrons et managers passent par leurs commandes (contrat v1.8).
ALTER TABLE gifts DROP CONSTRAINT gifts_reason_check;
ALTER TABLE gifts ADD CONSTRAINT gifts_reason_check CHECK (reason IN ('unhappy_customer', 'staff'));

-- Down Migration

ALTER TABLE gifts DROP CONSTRAINT gifts_reason_check;
ALTER TABLE gifts ADD CONSTRAINT gifts_reason_check
  CHECK (reason IN ('unhappy_customer', 'staff', 'owner'));

DROP INDEX gifts_table_session_id_idx;
ALTER TABLE gifts DROP CONSTRAINT gifts_session_needs_table;
ALTER TABLE gifts DROP COLUMN table_session_id;

ALTER TABLE gifts ADD COLUMN order_line_id integer UNIQUE REFERENCES order_lines;
ALTER TABLE gifts ADD CONSTRAINT gifts_check CHECK (order_line_id IS NULL OR table_id IS NOT NULL);
ALTER TABLE order_lines DROP CONSTRAINT order_lines_status_check;
ALTER TABLE order_lines ADD CONSTRAINT order_lines_status_check
  CHECK (status IN ('active', 'cancelled', 'transferred', 'gifted'));
