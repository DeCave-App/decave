-- FACEIT links now require signing in with FACEIT (OAuth 2 + PKCE). Links made
-- by typing a nickname were never verified, so they are removed; members link
-- again through FACEIT login.
DELETE FROM decave_faceit_links;

-- One pending FACEIT login per user, valid for 10 minutes.
CREATE TABLE IF NOT EXISTS decave_faceit_link_states (
  state TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES decave_users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_decave_faceit_link_states_user ON decave_faceit_link_states(user_id);
