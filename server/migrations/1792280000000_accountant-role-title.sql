-- Up Migration

-- Contrat v1.9 : rôle accountant (« Comptable » : rapports, clôtures, commandes sur sa
-- table d'offre) et titre affiché d'un compte (Manager, Patron, Patronne, Comptable…), sans droits.
-- `title` : null si aucun ; l'API enregistre une chaîne vide comme null.
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('manager', 'waiter', 'barista', 'chef', 'accountant'));
ALTER TABLE users ADD COLUMN title text;

-- Down Migration

-- Un comptable ne devient jamais manager (plus de droits) : retour arrière refusé tant qu'il
-- reste des comptes comptable, à changer de rôle d'abord depuis l'app.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE role = 'accountant') THEN
    RAISE EXCEPTION 'Retour arrière impossible : il reste des comptes comptable (role = accountant). Changez leur rôle avant.';
  END IF;
END
$$;
ALTER TABLE users DROP COLUMN title;
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('manager', 'waiter', 'barista', 'chef'));
