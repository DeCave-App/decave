-- Hub Home: per-Hub landing page layout, Welcome message and Rules.
-- The Worker also creates this table at runtime (ensureHubFeatureSchema), so
-- this migration is idempotent on databases that already have it.
CREATE TABLE IF NOT EXISTS decave_hub_home (
  hub_id INTEGER PRIMARY KEY,
  sections_json TEXT NOT NULL DEFAULT '[]',
  welcome TEXT NOT NULL DEFAULT '',
  rules TEXT NOT NULL DEFAULT '',
  updated_by TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(hub_id) REFERENCES decave_hubs(id) ON DELETE CASCADE
);
