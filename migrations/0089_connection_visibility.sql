-- Settings → Connections: which linked accounts (Steam, Twitch, FACEIT) are
-- shown on the profile. JSON object provider → true; missing means hidden.
ALTER TABLE decave_account_preferences ADD COLUMN connection_visibility_json TEXT NOT NULL DEFAULT '{}';
