-- DeCave Platform Security - Phase 3
-- One-time MFA login challenges for MFA-enrolled platform owners.

CREATE TABLE IF NOT EXISTS decave_owner_login_challenges (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  stay_signed_in INTEGER NOT NULL DEFAULT 0 CHECK (stay_signed_in IN (0, 1)),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES decave_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_decave_owner_login_challenges_user
ON decave_owner_login_challenges(user_id, expires_at);
