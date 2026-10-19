-- Up Migration

-- Abonnements Web Push, un par téléphone. Liés à la session : une déconnexion, une
-- désactivation ou une session expirée arrêtent les notifications, sans désabonnement explicite.
-- Un même endpoint (même navigateur) réabonné depuis un autre compte change de propriétaire.
CREATE TABLE push_subscriptions (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  endpoint text NOT NULL UNIQUE CHECK (endpoint <> ''),
  p256dh text NOT NULL CHECK (p256dh <> ''),
  auth text NOT NULL CHECK (auth <> ''),
  user_id integer NOT NULL REFERENCES users ON DELETE CASCADE,
  session_id integer NOT NULL REFERENCES sessions ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_subscriptions_user_id_idx ON push_subscriptions (user_id);

-- Down Migration

DROP TABLE push_subscriptions;
