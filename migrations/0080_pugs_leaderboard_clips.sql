-- Streamer Hub community features: PUGs (random-team community matches),
-- FACEIT-linked leaderboard, and Twitch clips imported into the clips forum.

-- One open or live PUG per Hub. Teams are drawn at random when the creator
-- starts it; the map is the most voted one from the creator's pool.
CREATE TABLE IF NOT EXISTS decave_streamer_pugs (
  id TEXT PRIMARY KEY,
  hub_id INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('open','live','done','cancelled')),
  team_size INTEGER NOT NULL CHECK(team_size BETWEEN 1 AND 5),
  maps_json TEXT NOT NULL DEFAULT '[]',
  map TEXT,
  voice_a INTEGER,
  voice_b INTEGER,
  score_a INTEGER,
  score_b INTEGER,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  FOREIGN KEY(hub_id) REFERENCES decave_hubs(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_decave_streamer_pugs_active
  ON decave_streamer_pugs(hub_id) WHERE status IN ('open','live');
CREATE INDEX IF NOT EXISTS idx_decave_streamer_pugs_hub_finished ON decave_streamer_pugs(hub_id, finished_at);

CREATE TABLE IF NOT EXISTS decave_streamer_pug_players (
  pug_id TEXT NOT NULL,
  hub_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  team TEXT CHECK(team IN ('a','b')),
  map_vote TEXT,
  joined_at TEXT NOT NULL,
  PRIMARY KEY(pug_id, user_id),
  FOREIGN KEY(pug_id) REFERENCES decave_streamer_pugs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_decave_streamer_pug_players_user ON decave_streamer_pug_players(user_id);
CREATE INDEX IF NOT EXISTS idx_decave_streamer_pug_players_hub ON decave_streamer_pug_players(hub_id, user_id);

-- A member's linked FACEIT account (opt-in). One DeCave account per FACEIT player.
CREATE TABLE IF NOT EXISTS decave_faceit_links (
  user_id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL UNIQUE,
  nickname TEXT NOT NULL,
  elo INTEGER,
  level INTEGER,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES decave_users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_decave_faceit_links_updated ON decave_faceit_links(updated_at);

-- Twitch clips already posted to a Hub's clips forum (so each is posted once).
CREATE TABLE IF NOT EXISTS decave_twitch_clips_posted (
  hub_id INTEGER NOT NULL,
  clip_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  posted_at TEXT NOT NULL,
  PRIMARY KEY(hub_id, clip_id),
  FOREIGN KEY(hub_id) REFERENCES decave_hubs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_decave_twitch_clips_posted_at ON decave_twitch_clips_posted(hub_id, posted_at);
