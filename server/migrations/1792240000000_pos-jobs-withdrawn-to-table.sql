-- Up Migration

-- Contrat v1.8.2 : une annulation retirée passe `waiting` → `withdrawn` (rien n'est tapé).
ALTER TABLE pos_jobs DROP CONSTRAINT pos_jobs_status_check;
ALTER TABLE pos_jobs ADD CONSTRAINT pos_jobs_status_check
  CHECK (status IN ('queued', 'in_progress', 'done', 'failed', 'waiting', 'manual', 'withdrawn'));
ALTER TABLE pos_jobs ADD CONSTRAINT pos_jobs_withdrawn_cancel
  CHECK (status <> 'withdrawn' OR type = 'cancel_line');

-- Table d'arrivée d'un transfert ou d'un changement de table (PosJob.toTableNumber) : une tâche
-- en échec bloque aussi les tâches suivantes de cette table (docs/api.md § PosJob).
ALTER TABLE pos_jobs ADD COLUMN to_table_id integer REFERENCES tables;
ALTER TABLE pos_jobs ADD CONSTRAINT pos_jobs_to_table
  CHECK ((type IN ('transfer_line', 'move_table')) = (to_table_id IS NOT NULL));

-- Down Migration

ALTER TABLE pos_jobs DROP CONSTRAINT pos_jobs_to_table;
ALTER TABLE pos_jobs DROP COLUMN to_table_id;
ALTER TABLE pos_jobs DROP CONSTRAINT pos_jobs_withdrawn_cancel;
ALTER TABLE pos_jobs DROP CONSTRAINT pos_jobs_status_check;
ALTER TABLE pos_jobs ADD CONSTRAINT pos_jobs_status_check
  CHECK (status IN ('queued', 'in_progress', 'done', 'failed', 'waiting', 'manual'));
