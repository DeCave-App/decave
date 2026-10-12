-- No-code bot builder. decave_hub_bots itself is created and extended lazily by
-- worker/lib/hub-schema.ts, so these tables hold bot_id WITHOUT a foreign key to
-- it (a FK to a table that may not exist yet would fail every insert). Bot
-- children are removed explicitly by deleteBot() and the account-erasure pass;
-- hub deletion still cascades through hub_id.

CREATE TABLE IF NOT EXISTS decave_bot_rules (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL,
  hub_id INTEGER NOT NULL,
  draft_json TEXT NOT NULL,
  published_json TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  draft_deleted INTEGER NOT NULL DEFAULT 0,
  draft_position INTEGER,
  created_by TEXT,
  updated_by TEXT,
  published_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(hub_id) REFERENCES decave_hubs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_decave_bot_rules_bot ON decave_bot_rules(bot_id, position);
CREATE INDEX IF NOT EXISTS idx_decave_bot_rules_hub ON decave_bot_rules(hub_id);

CREATE TABLE IF NOT EXISTS decave_bot_commands (
  hub_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  bot_id TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  PRIMARY KEY(hub_id, name),
  FOREIGN KEY(hub_id) REFERENCES decave_hubs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_decave_bot_commands_bot ON decave_bot_commands(bot_id);

CREATE TABLE IF NOT EXISTS decave_bot_variables (
  hub_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  scope TEXT NOT NULL,
  user_id TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'text',
  value TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(hub_id, name, scope, user_id),
  FOREIGN KEY(hub_id) REFERENCES decave_hubs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_decave_bot_variables_user ON decave_bot_variables(user_id);

CREATE TABLE IF NOT EXISTS decave_bot_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hub_id INTEGER NOT NULL,
  bot_id TEXT NOT NULL,
  rule_id TEXT,
  trigger TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY(hub_id) REFERENCES decave_hubs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_decave_bot_runs_bot ON decave_bot_runs(bot_id, created_at);
CREATE INDEX IF NOT EXISTS idx_decave_bot_runs_created ON decave_bot_runs(created_at);

CREATE TABLE IF NOT EXISTS decave_bot_timers (
  key TEXT PRIMARY KEY,
  hub_id INTEGER NOT NULL,
  room_id INTEGER NOT NULL,
  bot_id TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  fire_at INTEGER NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY(hub_id) REFERENCES decave_hubs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_decave_bot_timers_room ON decave_bot_timers(room_id, fire_at);
CREATE INDEX IF NOT EXISTS idx_decave_bot_timers_bot ON decave_bot_timers(bot_id);

CREATE TABLE IF NOT EXISTS decave_bot_ai_usage (
  hub_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(hub_id, day),
  FOREIGN KEY(hub_id) REFERENCES decave_hubs(id) ON DELETE CASCADE
);

-- Messages posted by builder bots. bot_id names the posting bot (token bots set
-- it too); card_json holds an optional rich card; visible_to_user_id makes the
-- row a private notice that only that user can load.
ALTER TABLE decave_messages ADD COLUMN bot_id TEXT;
ALTER TABLE decave_messages ADD COLUMN card_json TEXT;
ALTER TABLE decave_messages ADD COLUMN visible_to_user_id TEXT;
