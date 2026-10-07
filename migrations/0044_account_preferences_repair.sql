-- Repair databases that recorded migration 0041 before the Worker-created
-- preferences table was represented in the migration chain.
CREATE TABLE IF NOT EXISTS decave_account_preferences (
  user_id TEXT PRIMARY KEY,
  phone_number TEXT NOT NULL DEFAULT '',
  username_changed_at TEXT,
  friend_request_policy TEXT NOT NULL DEFAULT 'everyone',
  allow_stream_previews INTEGER NOT NULL DEFAULT 1,
  streamer_mode INTEGER NOT NULL DEFAULT 0,
  language TEXT NOT NULL DEFAULT 'en',
  time_format TEXT NOT NULL DEFAULT 'system',
  voice_mini_player_x REAL,
  voice_mini_player_y REAL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES decave_users(id) ON DELETE CASCADE
);
