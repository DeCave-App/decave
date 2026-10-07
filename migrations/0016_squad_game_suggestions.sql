CREATE TABLE IF NOT EXISTS decave_squad_game_suggestions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  game_name TEXT NOT NULL,
  game_name_normalized TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by TEXT,
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  FOREIGN KEY(user_id) REFERENCES decave_users(id) ON DELETE CASCADE,
  FOREIGN KEY(reviewed_by) REFERENCES decave_users(id) ON DELETE SET NULL,
  UNIQUE(user_id, game_name_normalized)
);

CREATE INDEX IF NOT EXISTS idx_decave_squad_game_suggestions_status
  ON decave_squad_game_suggestions(status, created_at);
