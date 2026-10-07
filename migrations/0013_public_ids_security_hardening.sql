PRAGMA foreign_keys = ON;

-- Public DeCave IDs are opaque, shareable account references. Internal UUIDs stay server-side.
ALTER TABLE decave_users ADD COLUMN public_id TEXT;

UPDATE decave_users
SET public_id = 'DC-' || UPPER(HEX(RANDOMBLOB(8)))
WHERE public_id IS NULL OR TRIM(public_id) = '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_decave_users_public_id
ON decave_users(public_id COLLATE NOCASE);

-- Keep rollout compatible with the currently deployed Worker. If an account is
-- created in the short window after this migration but before the new Worker is
-- deployed, SQLite assigns its public DeCave ID automatically.
CREATE TRIGGER IF NOT EXISTS trg_decave_users_public_id_after_insert
AFTER INSERT ON decave_users
WHEN NEW.public_id IS NULL OR TRIM(NEW.public_id) = ''
BEGIN
  UPDATE decave_users
  SET public_id = 'DC-' || UPPER(HEX(RANDOMBLOB(8)))
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_decave_users_public_id_update
BEFORE UPDATE OF public_id ON decave_users
WHEN NEW.public_id IS NULL
  OR LENGTH(NEW.public_id) <> 19
  OR UPPER(NEW.public_id) NOT GLOB 'DC-[0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F]'
BEGIN
  SELECT RAISE(ABORT, 'invalid public DeCave ID');
END;

-- WebSocket credentials are deliberately separate from normal HTTP sessions.
CREATE TABLE IF NOT EXISTS decave_ws_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  used_at TEXT,
  FOREIGN KEY(user_id) REFERENCES decave_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_decave_ws_tokens_user_expiry
ON decave_ws_tokens(user_id, expires_at);

-- Authorization metadata for private R2 objects. Object names no longer encode account UUIDs.
CREATE TABLE IF NOT EXISTS decave_attachment_access (
  r2_key TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('dm','channel')),
  owner_user_id TEXT NOT NULL,
  peer_user_id TEXT,
  hub_id INTEGER,
  room_id INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY(owner_user_id) REFERENCES decave_users(id) ON DELETE CASCADE,
  FOREIGN KEY(peer_user_id) REFERENCES decave_users(id) ON DELETE CASCADE,
  FOREIGN KEY(hub_id) REFERENCES decave_hubs(id) ON DELETE CASCADE,
  FOREIGN KEY(room_id) REFERENCES decave_rooms(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_decave_attachment_access_owner
ON decave_attachment_access(owner_user_id, created_at);
