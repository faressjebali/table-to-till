-- Up Migration

-- Quatre rôles : manager, waiter, barista, chef (affiché « Cuisinier »). Le rôle owner est supprimé.
-- Un éventuel compte owner devient manager (il en avait déjà tous les droits).
-- La raison 'owner' de gifts (offert à un patron) n'est pas un rôle : elle reste.
UPDATE users SET role = 'manager', updated_at = now() WHERE role = 'owner';
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('manager', 'waiter', 'barista', 'chef'));

-- Down Migration

ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('waiter', 'barista', 'chef', 'manager', 'owner'));
