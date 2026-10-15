-- Up Migration

-- Une seule caisse (contrat v1.8) : parmi les serveurs en shift, un seul est principal
-- (le premier arrivé, ou celui qui a accepté la passation) ; les autres sont renforts.
ALTER TABLE shifts ADD COLUMN principal boolean NOT NULL DEFAULT false;

-- Shifts déjà ouverts : le plus ancien devient principal.
UPDATE shifts SET principal = true
 WHERE id = (SELECT id FROM shifts WHERE ended_at IS NULL ORDER BY started_at, id LIMIT 1);

-- Au plus un principal à la fois.
CREATE UNIQUE INDEX shifts_one_principal ON shifts ((true)) WHERE ended_at IS NULL AND principal;

-- Down Migration

DROP INDEX shifts_one_principal;
ALTER TABLE shifts DROP COLUMN principal;
