-- Up Migration

-- Nouveau menu food du 24/10/2026 (docs/menu/menu.csv) dans les bases déjà remplies :
-- le seed ajoute les nouveaux articles mais ne modifie jamais rien d'existant.
-- Les articles retirés de la carte sont archivés (pas supprimés : d'anciennes commandes y renvoient).
UPDATE menu_items SET archived_at = now(), updated_at = now()
  WHERE archived_at IS NULL AND name_fr IN (
    'Classic Start', 'Boost Start', 'Sweet Start',
    'Gruyère', 'Feta', 'Anchois',
    'Salade bulgur',
    'Sardines à l''huile, pan con tomato', 'Filet de poulet, sauce César',
    'Salade de bulgur (accompagnement)', 'Bulgur sauté aux champignons et épinards', 'Masala rice',
    'Club sandwich thon',
    'Fruits'
  );

UPDATE menu_items SET price = 10500, updated_at = now() WHERE name_fr = 'Early Bird';
UPDATE menu_items SET price = 37500, updated_at = now() WHERE name_fr = 'Salade César';
UPDATE menu_items SET price = 29000,
    description_fr = 'Riz Masala, œufs brouillés, Crispy chicken, concombre sunomono, sauce Général Tao, sweet chili sauce, pickles',
    description_en = 'Masala rice, scrambled eggs, Crispy chicken, sunomono cucumber, General Tso sauce, sweet chili sauce, pickles',
    updated_at = now()
  WHERE name_fr = 'Spiced Lentil Bowl';
UPDATE menu_items SET
    description_fr = 'Mini Burger + frites + Cookie + Jus de saison',
    description_en = 'Mini burger + fries + cookie + seasonal juice',
    updated_at = now()
  WHERE name_fr = 'Kids Menu (Cookie)';
UPDATE menu_items SET
    description_fr = 'Mini Burger + frites + Pancakes au chocolat + Jus de saison',
    description_en = 'Mini burger + fries + chocolate pancakes + seasonal juice',
    updated_at = now()
  WHERE name_fr = 'Kids Menu (Pancakes)';

-- Down Migration

UPDATE menu_items SET
    description_fr = 'Mini Burger + Pancakes + Jus de saison',
    description_en = 'Mini burger + pancakes + seasonal juice',
    updated_at = now()
  WHERE name_fr = 'Kids Menu (Pancakes)';
UPDATE menu_items SET
    description_fr = 'Mini Burger + Cookie + Jus de saison',
    description_en = 'Mini burger + cookie + seasonal juice',
    updated_at = now()
  WHERE name_fr = 'Kids Menu (Cookie)';
UPDATE menu_items SET price = 36500,
    description_fr = 'Riz Masala, œufs brouillés, Crispy chicken, avocat, sauce Général Tao, sweet chili sauce, pickles',
    description_en = 'Masala rice, scrambled eggs, Crispy chicken, avocado, General Tso sauce, sweet chili sauce, pickles',
    updated_at = now()
  WHERE name_fr = 'Spiced Lentil Bowl';
UPDATE menu_items SET price = 31500, updated_at = now() WHERE name_fr = 'Salade César';
UPDATE menu_items SET price = 8500, updated_at = now() WHERE name_fr = 'Early Bird';

UPDATE menu_items SET archived_at = NULL, updated_at = now()
  WHERE archived_at IS NOT NULL AND name_fr IN (
    'Classic Start', 'Boost Start', 'Sweet Start',
    'Gruyère', 'Feta', 'Anchois',
    'Salade bulgur',
    'Sardines à l''huile, pan con tomato', 'Filet de poulet, sauce César',
    'Salade de bulgur (accompagnement)', 'Bulgur sauté aux champignons et épinards', 'Masala rice',
    'Club sandwich thon',
    'Fruits'
  );
