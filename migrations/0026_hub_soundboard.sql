CREATE TABLE IF NOT EXISTS decave_soundboard_sounds (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES decave_users(id) ON DELETE CASCADE
);
ALTER TABLE decave_soundboard_sounds ADD COLUMN hub_id INTEGER REFERENCES decave_hubs(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_decave_soundboard_hub ON decave_soundboard_sounds(hub_id, created_at);
