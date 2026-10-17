-- Up Migration

-- Tables d'offre (contrat v1.9 et v2.0.2) : une table fictive dont tout est offert.
-- offer_label = pour qui (« Rania », « Table des artistes ») ; offer_user_id = le compte manager ou
-- comptable à qui elle est réservée, NULL pour une table sans compte.
ALTER TABLE tables
  ADD COLUMN offer_label text CHECK (offer_label <> '' AND char_length(offer_label) <= 100),
  ADD COLUMN offer_user_id integer REFERENCES users,
  ADD CONSTRAINT tables_offer_only_virtual CHECK (offer_label IS NULL OR kind = 'virtual'),
  ADD CONSTRAINT tables_offer_user_needs_label CHECK (offer_user_id IS NULL OR offer_label IS NOT NULL);

-- Une table d'offre au plus par compte.
CREATE UNIQUE INDEX tables_one_offer_per_user ON tables (offer_user_id) WHERE offer_user_id IS NOT NULL;

-- Down Migration

DROP INDEX tables_one_offer_per_user;
ALTER TABLE tables
  DROP CONSTRAINT tables_offer_user_needs_label,
  DROP CONSTRAINT tables_offer_only_virtual,
  DROP COLUMN offer_user_id,
  DROP COLUMN offer_label;
