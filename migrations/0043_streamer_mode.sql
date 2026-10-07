-- Streamer Mode community queue, sessions, highlights, giveaways and audit data.
-- The host gates use of these tables on this migration's decave_streamer_hubs marker.
PRAGMA foreign_keys = ON;

CREATE TABLE decave_streamer_hubs (
  hub_id INTEGER PRIMARY KEY REFERENCES decave_hubs(id) ON DELETE CASCADE,
  config_json TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE decave_streamer_sessions (
  id TEXT PRIMARY KEY,
  hub_id INTEGER NOT NULL REFERENCES decave_streamer_hubs(hub_id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  game TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('open','paused','ended')),
  party_size INTEGER NOT NULL CHECK(party_size BETWEEN 1 AND 16),
  ready_seconds INTEGER NOT NULL CHECK(ready_seconds BETWEEN 30 AND 300),
  created_at TEXT NOT NULL,
  ended_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  UNIQUE(id,hub_id)
);
CREATE UNIQUE INDEX decave_streamer_one_active_session
  ON decave_streamer_sessions(hub_id) WHERE status != 'ended';
CREATE INDEX decave_streamer_session_history
  ON decave_streamer_sessions(hub_id,created_at DESC);

CREATE TABLE decave_streamer_queue (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL,
  hub_id INTEGER NOT NULL,
  user_id TEXT NOT NULL REFERENCES decave_users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('waiting','called','ready','playing','done','skipped','left')),
  joined_at TEXT NOT NULL,
  call_expires_at TEXT,
  finished_at TEXT,
  FOREIGN KEY(session_id,hub_id) REFERENCES decave_streamer_sessions(id,hub_id) ON DELETE CASCADE,
  UNIQUE(session_id,user_id)
);
CREATE INDEX decave_streamer_queue_order ON decave_streamer_queue(session_id,status,seq);
CREATE INDEX decave_streamer_queue_user ON decave_streamer_queue(user_id,session_id);

CREATE TABLE decave_streamer_highlights (
  id TEXT PRIMARY KEY,
  hub_id INTEGER NOT NULL REFERENCES decave_streamer_hubs(hub_id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  thumbnail_path TEXT NOT NULL DEFAULT '',
  created_by TEXT REFERENCES decave_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX decave_streamer_highlight_hub ON decave_streamer_highlights(hub_id,created_at DESC);

CREATE TABLE decave_streamer_giveaways (
  id TEXT PRIMARY KEY,
  hub_id INTEGER NOT NULL REFERENCES decave_streamer_hubs(hub_id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  rules TEXT NOT NULL,
  closes_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','drawn','cancelled')),
  winner_user_id TEXT REFERENCES decave_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  drawn_at TEXT,
  UNIQUE(id,hub_id)
);
CREATE INDEX decave_streamer_giveaway_hub ON decave_streamer_giveaways(hub_id,created_at DESC);

CREATE TABLE decave_streamer_giveaway_entries (
  giveaway_id TEXT NOT NULL,
  hub_id INTEGER NOT NULL,
  user_id TEXT NOT NULL REFERENCES decave_users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY(giveaway_id,user_id),
  FOREIGN KEY(giveaway_id,hub_id) REFERENCES decave_streamer_giveaways(id,hub_id) ON DELETE CASCADE
);

CREATE TABLE decave_streamer_audit (
  id TEXT PRIMARY KEY,
  hub_id INTEGER NOT NULL REFERENCES decave_streamer_hubs(hub_id) ON DELETE CASCADE,
  actor_user_id TEXT REFERENCES decave_users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX decave_streamer_audit_hub ON decave_streamer_audit(hub_id,created_at DESC);

CREATE TABLE decave_streamer_rate (
  hub_id INTEGER NOT NULL REFERENCES decave_hubs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES decave_users(id) ON DELETE CASCADE,
  minute INTEGER NOT NULL,
  count INTEGER NOT NULL CHECK(count > 0),
  PRIMARY KEY(hub_id,user_id,minute)
);

CREATE TRIGGER decave_streamer_member_removed AFTER DELETE ON decave_hub_members BEGIN
  DELETE FROM decave_streamer_queue WHERE hub_id=OLD.hub_id AND user_id=OLD.user_id;
  DELETE FROM decave_streamer_giveaway_entries WHERE hub_id=OLD.hub_id AND user_id=OLD.user_id;
END;
