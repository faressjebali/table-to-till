-- Up Migration

-- Deux articles portaient le même nom anglais « Bulgur salad » : l'accompagnement est renommé.
-- Le seed retrouve les articles par catégorie et nom français : sans ce renommage, il créerait un doublon.
UPDATE menu_items SET name_fr = 'Salade de bulgur (accompagnement)', name_en = 'Bulgur salad (side)',
       updated_at = now()
  WHERE name_fr = 'Salade de bulgur'
    AND category_id = (SELECT id FROM categories WHERE name_fr = 'Accompagnements');

-- Down Migration

UPDATE menu_items SET name_fr = 'Salade de bulgur', name_en = 'Bulgur salad', updated_at = now()
  WHERE name_fr = 'Salade de bulgur (accompagnement)'
    AND category_id = (SELECT id FROM categories WHERE name_fr = 'Accompagnements');
