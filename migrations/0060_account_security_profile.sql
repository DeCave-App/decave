-- Two-factor sign-in for every account, and profile display name, pronouns
-- and banner. Platform owners keep their separate owner MFA tables (0007/0008);
-- these tables are for the account holder's own optional 2FA.

CREATE TABLE IF NOT EXISTS decave_user_mfa (
  user_id TEXT PRIMARY KEY,
  secret_ciphertext TEXT NOT NULL,
  enabled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES decave_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS decave_user_recovery_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES decave_users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_decave_user_recovery_codes_user
ON decave_user_recovery_codes(user_id, used_at);

CREATE TABLE IF NOT EXISTS decave_user_login_challenges (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  stay_signed_in INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES decave_users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_decave_user_login_challenges_user
ON decave_user_login_challenges(user_id, expires_at);

ALTER TABLE decave_users ADD COLUMN display_name TEXT NOT NULL DEFAULT '';
ALTER TABLE decave_users ADD COLUMN pronouns TEXT NOT NULL DEFAULT '';
ALTER TABLE decave_users ADD COLUMN banner_key TEXT;
ALTER TABLE decave_users ADD COLUMN banner_updated_at TEXT;
