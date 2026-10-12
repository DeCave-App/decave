-- Custom Streamer Hub features (per Hub, set by DeCave staff):
-- voice room player caps, Twitch subscriber roles and giveaway entry rules.

-- Voice room player cap; 0 = no limit. Only Hubs with the voiceLimits feature can set it.
ALTER TABLE decave_rooms ADD COLUMN user_limit INTEGER NOT NULL DEFAULT 0;

-- A member's linked Twitch account (signed in with Twitch, scope user:read:subscriptions).
-- The refresh token is AES-GCM encrypted; it lets the daily job re-check subscriptions.
CREATE TABLE IF NOT EXISTS decave_twitch_member_links (
  user_id TEXT PRIMARY KEY,
  twitch_user_id TEXT NOT NULL UNIQUE,
  login TEXT NOT NULL,
  refresh_token_enc TEXT NOT NULL,
  linked_at TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES decave_users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_decave_twitch_member_links_checked ON decave_twitch_member_links(checked_at);

CREATE TABLE IF NOT EXISTS decave_twitch_member_link_states (
  state TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES decave_users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_decave_twitch_member_link_states_user ON decave_twitch_member_link_states(user_id);

-- Verified subscriptions of a member to a Hub's linked Twitch channel.
CREATE TABLE IF NOT EXISTS decave_twitch_hub_subscribers (
  hub_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  tier TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  PRIMARY KEY(hub_id, user_id),
  FOREIGN KEY(hub_id) REFERENCES decave_hubs(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES decave_users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_decave_twitch_hub_subscribers_user ON decave_twitch_hub_subscribers(user_id);

-- Giveaway entry rules: {"subsOnly":bool,"minMemberDays":int,"subBonus":bool}.
ALTER TABLE decave_streamer_giveaways ADD COLUMN conditions_json TEXT NOT NULL DEFAULT '{}';
