-- DeCave Mobile Parity Pass
-- Client-aware login metadata. The existing decave_sessions table remains the
-- source of truth for authentication; this table only classifies its sessions.

CREATE TABLE IF NOT EXISTS decave_session_clients (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  client TEXT NOT NULL DEFAULT 'web'
    CHECK (client IN ('mobile','web','desktop')),
  device_label TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_decave_session_clients_user
ON decave_session_clients(user_id);
