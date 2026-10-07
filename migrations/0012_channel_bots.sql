-- DeCave channel-level bot assignments

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS decave_bots (
  id TEXT PRIMARY KEY,
  hub_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  avatar_emoji TEXT NOT NULL DEFAULT '🤖',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  built_in INTEGER NOT NULL DEFAULT 0 CHECK (built_in IN (0,1)),
  created_by TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(hub_id, slug),
  FOREIGN KEY(hub_id) REFERENCES decave_hubs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS decave_bot_channels (
  bot_id TEXT NOT NULL,
  room_id INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY(bot_id, room_id),
  FOREIGN KEY(bot_id) REFERENCES decave_bots(id) ON DELETE CASCADE,
  FOREIGN KEY(room_id) REFERENCES decave_rooms(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_decave_bots_hub
  ON decave_bots(hub_id);

CREATE INDEX IF NOT EXISTS idx_decave_bot_channels_room
  ON decave_bot_channels(room_id);
