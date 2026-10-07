-- End-to-end encrypted direct messages (docs/security/DM-E2EE.md).
-- The server stores public keys, an account key backup it cannot open, short-lived
-- device-link requests and message envelopes. It never sees an account's private key.

CREATE TABLE IF NOT EXISTS decave_dm_keys (
  key_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  x25519_public TEXT NOT NULL,
  ed25519_public TEXT NOT NULL,
  created_at TEXT NOT NULL,
  -- Set when the account resets its key. Old keys stay so old signatures still verify.
  retired_at TEXT,
  FOREIGN KEY(user_id) REFERENCES decave_users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_decave_dm_keys_current
ON decave_dm_keys(user_id) WHERE retired_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_decave_dm_keys_user
ON decave_dm_keys(user_id, created_at);

-- The account key encrypted under the user's recovery code.
CREATE TABLE IF NOT EXISTS decave_dm_key_backups (
  user_id TEXT PRIMARY KEY,
  key_id TEXT NOT NULL,
  backup TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES decave_users(id) ON DELETE CASCADE
);

-- A new device asking one of the account's existing devices for the key.
CREATE TABLE IF NOT EXISTS decave_dm_link_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  requester_session_hash TEXT NOT NULL,
  link_public TEXT NOT NULL,
  device_label TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  sealed TEXT,
  resolved_at TEXT,
  FOREIGN KEY(user_id) REFERENCES decave_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_decave_dm_link_requests_user
ON decave_dm_link_requests(user_id, expires_at);

-- An encrypted message keeps text='' and stores its envelope here.
ALTER TABLE decave_direct_messages ADD COLUMN envelope TEXT;
