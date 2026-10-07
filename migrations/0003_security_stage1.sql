ALTER TABLE decave_users ADD COLUMN email TEXT;
ALTER TABLE decave_users ADD COLUMN email_normalized TEXT;
ALTER TABLE decave_users ADD COLUMN email_verified_at TEXT;
ALTER TABLE decave_users ADD COLUMN requires_email_verification INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_decave_users_email_normalized
ON decave_users(email_normalized)
WHERE email_normalized IS NOT NULL;

CREATE TABLE IF NOT EXISTS decave_auth_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify_email','reset_password')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  consumed_at TEXT,
  FOREIGN KEY (user_id) REFERENCES decave_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_decave_auth_tokens_user_purpose
ON decave_auth_tokens(user_id, purpose, expires_at);

CREATE TABLE IF NOT EXISTS decave_security_events (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  event TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  user_agent TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES decave_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_decave_security_events_user_created
ON decave_security_events(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_decave_sessions_user_expires
ON decave_sessions(user_id, expires_at);
