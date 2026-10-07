CREATE TABLE IF NOT EXISTS decave_official_hubs (
  key TEXT PRIMARY KEY,
  hub_id INTEGER NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  FOREIGN KEY(hub_id) REFERENCES decave_hubs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_decave_official_hubs_hub
  ON decave_official_hubs(hub_id);
