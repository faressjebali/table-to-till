-- Up Migration

-- Plan des tables en deux salles (contrat v2.4) : la salle de chaque table réelle.
-- Intérieur par défaut, comme `room` dans /admin/tables ; sans effet pour une table fictive
-- (elle n'est sur aucun plan : `layout` reste null dans l'API).
ALTER TABLE tables
  ADD COLUMN layout_room text NOT NULL DEFAULT 'inside'
  CHECK (layout_room IN ('inside', 'terrace'));

-- Down Migration

ALTER TABLE tables DROP COLUMN layout_room;
