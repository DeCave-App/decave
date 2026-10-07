-- DeCave DM reactions
CREATE TABLE IF NOT EXISTS decave_dm_reactions (
  message_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (message_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_decave_dm_reactions_message
ON decave_dm_reactions(message_id);
