-- Up Migration

-- Orthographe « bulgur » partout (docs/menu/menu.csv) : renomme les articles déjà chargés,
-- sinon le seed (qui retrouve les articles par nom) créerait des doublons.
UPDATE menu_items SET name_fr = 'Salade bulgur', updated_at = now()
  WHERE name_fr = 'Salade bourghoul';
UPDATE menu_items SET name_fr = 'Salade de bulgur', updated_at = now()
  WHERE name_fr = 'Salade de boulghour';
UPDATE menu_items SET name_fr = 'Bulgur sauté aux champignons et épinards', updated_at = now()
  WHERE name_fr = 'Boulghour sauté aux champignons et épinards';

-- Down Migration

UPDATE menu_items SET name_fr = 'Salade bourghoul', updated_at = now()
  WHERE name_fr = 'Salade bulgur';
UPDATE menu_items SET name_fr = 'Salade de boulghour', updated_at = now()
  WHERE name_fr = 'Salade de bulgur';
UPDATE menu_items SET name_fr = 'Boulghour sauté aux champignons et épinards', updated_at = now()
  WHERE name_fr = 'Bulgur sauté aux champignons et épinards';
