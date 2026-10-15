-- Up Migration

-- Dernière connexion réussie, montrée à la manager dans la liste des comptes (User.lastLoginAt).
ALTER TABLE users ADD COLUMN last_login_at timestamptz;

-- Down Migration

ALTER TABLE users DROP COLUMN last_login_at;
