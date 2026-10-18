-- Up Migration

-- Affichage d'une catégorie dans le menu QR (contrat v2.0.3) : 'list' (article par article, avec
-- description) ou 'grid' (tableau compact nom + prix, comme les Extras du menu papier).
ALTER TABLE categories
  ADD COLUMN display text NOT NULL DEFAULT 'list' CHECK (display IN ('list', 'grid'));

-- Down Migration

ALTER TABLE categories DROP COLUMN display;
