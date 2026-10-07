-- Bind push and WebSocket credentials to the authenticated session that created them.
-- Deploy this migration before the Worker version that lazily creates push tokens
-- with session_hash, so existing runtime-created tables can be upgraded here.
CREATE TABLE IF NOT EXISTS decave_push_tokens (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES decave_users(id) ON DELETE CASCADE
);

ALTER TABLE decave_push_tokens ADD COLUMN session_hash TEXT;
ALTER TABLE decave_ws_tokens ADD COLUMN session_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_decave_push_tokens_user_session_hash
  ON decave_push_tokens(user_id, session_hash);
CREATE INDEX IF NOT EXISTS idx_decave_ws_tokens_user_session_hash
  ON decave_ws_tokens(user_id, session_hash);