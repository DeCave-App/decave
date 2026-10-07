-- Provenance for reviewed Discord structure imports. Rollback must only act on
-- records created by the server for this import and must retain any record
-- whose state acquired user content or later edits.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS decave_hub_imports (
  id TEXT PRIMARY KEY,
  hub_id INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL,
  rolled_back_at TEXT,
  FOREIGN KEY(hub_id) REFERENCES decave_hubs(id) ON DELETE CASCADE,
  FOREIGN KEY(created_by) REFERENCES decave_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_decave_hub_imports_hub_created
  ON decave_hub_imports(hub_id, created_at DESC);

CREATE TABLE IF NOT EXISTS decave_hub_import_rooms (
  import_id TEXT NOT NULL,
  room_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('text','voice')),
  kind TEXT NOT NULL CHECK(kind IN ('chat','forum')),
  category TEXT NOT NULL,
  position INTEGER NOT NULL,
  private INTEGER NOT NULL CHECK(private IN (0,1)),
  icon TEXT NOT NULL,
  forum_guidelines TEXT NOT NULL,
  forum_post_policy TEXT NOT NULL,
  forum_post_role_ids_json TEXT NOT NULL,
  forum_post_member_ids_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(import_id, room_id),
  FOREIGN KEY(import_id) REFERENCES decave_hub_imports(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_decave_hub_import_rooms_room
  ON decave_hub_import_rooms(room_id);

CREATE TABLE IF NOT EXISTS decave_hub_import_roles (
  import_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  icon TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(import_id, role_id),
  FOREIGN KEY(import_id) REFERENCES decave_hub_imports(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_decave_hub_import_roles_role
  ON decave_hub_import_roles(role_id);
