PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS decave_room_members (
  room_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  granted_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(room_id, user_id),
  FOREIGN KEY(room_id) REFERENCES decave_rooms(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES decave_users(id) ON DELETE CASCADE,
  FOREIGN KEY(granted_by) REFERENCES decave_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_decave_room_members_user
  ON decave_room_members(user_id, room_id);
