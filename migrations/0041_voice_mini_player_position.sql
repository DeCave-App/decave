-- The account-preferences table was historically created lazily by the
-- Worker. Keep fresh D1 migration chains self-contained before adding the
-- voice mini-player columns; the later repair migration covers databases
-- where this migration was already recorded.
CREATE TABLE IF NOT EXISTS decave_account_preferences (
  user_id TEXT PRIMARY KEY,
  phone_number TEXT NOT NULL DEFAULT '',
  username_changed_at TEXT,
  friend_request_policy TEXT NOT NULL DEFAULT 'everyone',
  allow_stream_previews INTEGER NOT NULL DEFAULT 1,
  streamer_mode INTEGER NOT NULL DEFAULT 0,
  language TEXT NOT NULL DEFAULT 'en',
  time_format TEXT NOT NULL DEFAULT 'system',
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES decave_users(id) ON DELETE CASCADE
);

ALTER TABLE decave_account_preferences ADD COLUMN voice_mini_player_x REAL;
ALTER TABLE decave_account_preferences ADD COLUMN voice_mini_player_y REAL;
