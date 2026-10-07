-- DeCave Platform Security - Phase 2
CREATE TABLE IF NOT EXISTS decave_owner_mfa (
  user_id TEXT PRIMARY KEY,
  secret_ciphertext TEXT NOT NULL,
  enabled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES decave_users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS decave_owner_recovery_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  code_hash TEXT NOT NULL UNIQUE,
  used_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES decave_users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_decave_owner_recovery_user
ON decave_owner_recovery_codes(user_id, used_at);
CREATE TABLE IF NOT EXISTS decave_owner_reauth (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES decave_users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_decave_owner_reauth_user
ON decave_owner_reauth(user_id, expires_at);
