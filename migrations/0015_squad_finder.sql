CREATE TABLE IF NOT EXISTS decave_squad_searches (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  game TEXT NOT NULL,
  platform TEXT NOT NULL,
  language TEXT NOT NULL,
  region TEXT NOT NULL,
  microphone_required INTEGER NOT NULL DEFAULT 0,
  group_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES decave_users(id) ON DELETE CASCADE,
  FOREIGN KEY(group_id) REFERENCES decave_group_chats(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_decave_squad_match
ON decave_squad_searches(status, game, platform, language, region, microphone_required, expires_at);
