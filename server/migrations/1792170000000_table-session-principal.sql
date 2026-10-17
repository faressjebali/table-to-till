-- Up Migration

-- Contrat v2.0 : pendant une passation, deux principaux encaissent chacun leurs tables.
-- Le principal d'une session est celui dont la table est la caisse (TableSession.principal, Table.principalId) :
-- le principal en cours à l'ouverture, ou celui à qui la table a été passée. Rempli par.
ALTER TABLE table_sessions ADD COLUMN principal_id integer REFERENCES users;

-- Down Migration

ALTER TABLE table_sessions DROP COLUMN principal_id;
