-- Up Migration

-- Écran bar / cuisine (contrat v2.1) : chaque ligne garde le poste de son article
-- (copié à la création, comme le nom et le prix).
ALTER TABLE order_lines ADD COLUMN station text CHECK (station IN ('bar', 'kitchen', 'both'));
UPDATE order_lines l SET station = i.station FROM menu_items i WHERE i.id = l.menu_item_id;
ALTER TABLE order_lines ALTER COLUMN station SET NOT NULL;

-- Partie d'une commande marquée « Prêt » par le barista (bar) ou le cuisinier (kitchen).
CREATE TABLE order_ready (
  order_id integer NOT NULL REFERENCES orders ON DELETE CASCADE,
  station text NOT NULL CHECK (station IN ('bar', 'kitchen')),
  ready_at timestamptz NOT NULL,
  ready_by integer NOT NULL REFERENCES users,
  PRIMARY KEY (order_id, station)
);

-- Down Migration

DROP TABLE order_ready;
ALTER TABLE order_lines DROP COLUMN station;
