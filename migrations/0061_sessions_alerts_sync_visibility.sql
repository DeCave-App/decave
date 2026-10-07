-- Last-active time per session, sign-in alerts for new devices, settings that
-- follow the account, and who can see the game you're playing.

ALTER TABLE decave_session_clients ADD COLUMN last_seen_at TEXT;

ALTER TABLE decave_account_preferences ADD COLUMN login_alerts INTEGER NOT NULL DEFAULT 1;
ALTER TABLE decave_account_preferences ADD COLUMN client_settings_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE decave_account_preferences ADD COLUMN client_settings_updated_at TEXT;

-- Who can see the game you're playing: everyone, friends or nobody. On the
-- user row so every serializer can apply it.
ALTER TABLE decave_users ADD COLUMN activity_visibility TEXT NOT NULL DEFAULT 'everyone';

-- Devices an account has signed in from, so only a new one triggers an alert.
-- fingerprint = hash of the app, operating system and browser family
-- (never the IP address).
CREATE TABLE IF NOT EXISTS decave_known_devices (
  user_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (user_id, fingerprint),
  FOREIGN KEY (user_id) REFERENCES decave_users(id) ON DELETE CASCADE
);

-- One-time "This wasn't me" links sent in sign-in alerts.
CREATE TABLE IF NOT EXISTS decave_secure_account_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_label TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  FOREIGN KEY (user_id) REFERENCES decave_users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_decave_secure_account_tokens_user
ON decave_secure_account_tokens(user_id, expires_at);
