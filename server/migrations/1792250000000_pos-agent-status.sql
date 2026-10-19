-- Up Migration

-- État de l'agent caisse (contrat v2.3) : dernier heartbeat, relu par GET /pos/status.
-- Une seule ligne : il n'y a qu'un agent.
CREATE TABLE pos_agent (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  state text NOT NULL CHECK (state IN ('idle', 'busy', 'waiting_for_human', 'offline')),
  last_seen_at timestamptz NOT NULL
);

-- Down Migration

DROP TABLE pos_agent;
