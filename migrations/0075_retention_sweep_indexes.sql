-- Tables and indexes the hourly retention job (worker/retention.ts) relies on
-- that 0070-0074 do not define. Carried over from the earlier, never-applied
-- retention migrations so a fresh database has every swept table and an
-- index for each bounded sweep.

-- Steam link states were only created lazily by the Worker (worker/lib/activity.ts);
-- define the identical shape so the expiry sweep always has a table.
CREATE TABLE IF NOT EXISTS decave_steam_link_states (
  state TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES decave_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_decave_steam_link_states_expiry
  ON decave_steam_link_states(expires_at);
CREATE INDEX IF NOT EXISTS idx_decave_auth_tokens_expiry
  ON decave_auth_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_decave_ws_tokens_expiry
  ON decave_ws_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_decave_secure_account_tokens_expiry
  ON decave_secure_account_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_decave_user_login_challenges_expiry
  ON decave_user_login_challenges(expires_at);
CREATE INDEX IF NOT EXISTS idx_decave_owner_login_challenges_expiry
  ON decave_owner_login_challenges(expires_at);
CREATE INDEX IF NOT EXISTS idx_decave_owner_reauth_expiry
  ON decave_owner_reauth(expires_at);
CREATE INDEX IF NOT EXISTS idx_decave_qr_login_challenges_expiry
  ON decave_qr_login_challenges(expires_at);
CREATE INDEX IF NOT EXISTS idx_decave_audit_created
  ON decave_audit(created_at);
CREATE INDEX IF NOT EXISTS idx_decave_known_devices_last_seen
  ON decave_known_devices(last_seen_at);
