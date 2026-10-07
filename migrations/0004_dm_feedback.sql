-- DeCave DM conversation clears + user feedback
CREATE TABLE IF NOT EXISTS decave_dm_conversation_clears (
  user_id TEXT NOT NULL,
  partner_id TEXT NOT NULL,
  cleared_at TEXT NOT NULL,
  PRIMARY KEY (user_id, partner_id)
);

CREATE INDEX IF NOT EXISTS idx_decave_dm_clears_user
ON decave_dm_conversation_clears(user_id);

CREATE TABLE IF NOT EXISTS decave_feedback (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  contact_email TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL CHECK(type IN ('bug','feature')),
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_decave_feedback_created
ON decave_feedback(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_decave_feedback_status
ON decave_feedback(status, created_at DESC);
