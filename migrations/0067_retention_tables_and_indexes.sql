-- Steam link states were only created lazily by the Worker (worker/lib/activity.ts).
-- The scheduled retention job deletes expired rows, so define the identical
-- shape here so the table always exists after migration.
CREATE TABLE IF NOT EXISTS decave_steam_link_states (
  state TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES decave_users(id) ON DELETE CASCADE
);

-- Presence activity is also Worker-lazy (worker/lib/hub-schema.ts, HubRoom.ts).
CREATE TABLE IF NOT EXISTS decave_presence_activity (
  user_id TEXT PRIMARY KEY,
  last_seen_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES decave_users(id) ON DELETE CASCADE
);

-- Indexes for the bounded retention sweeps in worker/lib/retention.ts.
CREATE INDEX IF NOT EXISTS idx_decave_steam_link_states_expiry
  ON decave_steam_link_states(expires_at);
CREATE INDEX IF NOT EXISTS idx_decave_qr_login_challenges_expiry
  ON decave_qr_login_challenges(expires_at);
CREATE INDEX IF NOT EXISTS idx_decave_audit_created
  ON decave_audit(created_at);
CREATE INDEX IF NOT EXISTS idx_decave_known_devices_last_seen
  ON decave_known_devices(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_decave_presence_activity_last_seen
  ON decave_presence_activity(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_decave_push_tokens_created
  ON decave_push_tokens(created_at);
CREATE INDEX IF NOT EXISTS idx_decave_attachment_access_created
  ON decave_attachment_access(created_at);
