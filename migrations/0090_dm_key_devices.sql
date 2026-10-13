-- Settings → Privacy & encryption → Devices with your key: the sessions that
-- hold this account's DM key (the one that created it and each device approved
-- through device linking), and a flag asking the next unlocked device to rotate
-- the key after one of them was removed.
CREATE TABLE IF NOT EXISTS decave_dm_key_holders (
  user_id TEXT NOT NULL,
  session_hash TEXT NOT NULL,
  added_at TEXT NOT NULL,
  PRIMARY KEY(user_id, session_hash),
  FOREIGN KEY(user_id) REFERENCES decave_users(id) ON DELETE CASCADE
);

ALTER TABLE decave_dm_key_settings ADD COLUMN rotation_requested_at TEXT;
