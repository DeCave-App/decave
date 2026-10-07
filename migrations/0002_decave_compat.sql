PRAGMA foreign_keys = ON;

-- Stage 2 compatibility tables. These intentionally use a decave_ prefix so
-- this migration is safe to apply after the Stage 1 foundation schema.

CREATE TABLE IF NOT EXISTS decave_users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  avatar_key TEXT,
  avatar_updated_at TEXT,
  bio TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'online'
    CHECK(status IN ('online','idle','dnd','invisible')),
  status_text TEXT NOT NULL DEFAULT '',
  activity_text TEXT NOT NULL DEFAULT '',
  accent TEXT NOT NULL DEFAULT '#7c5cff'
);

CREATE TABLE IF NOT EXISTS decave_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES decave_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS decave_hubs (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private'
    CHECK(visibility IN ('private','public')),
  description TEXT NOT NULL DEFAULT '',
  accent TEXT NOT NULL DEFAULT '#7c5cff',
  category TEXT NOT NULL DEFAULT 'Gaming',
  slow_mode_seconds INTEGER NOT NULL DEFAULT 0,
  icon_key TEXT,
  banner_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(owner_id) REFERENCES decave_users(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS decave_hub_tags (
  hub_id INTEGER NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY(hub_id, tag),
  FOREIGN KEY(hub_id) REFERENCES decave_hubs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS decave_hub_members (
  hub_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member'
    CHECK(role IN ('owner','admin','member')),
  joined_at TEXT NOT NULL,
  PRIMARY KEY(hub_id, user_id),
  FOREIGN KEY(hub_id) REFERENCES decave_hubs(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES decave_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS decave_rooms (
  id INTEGER PRIMARY KEY,
  hub_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('text','voice')),
  category TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  private INTEGER NOT NULL DEFAULT 0 CHECK(private IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(hub_id) REFERENCES decave_hubs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS decave_messages (
  id TEXT PRIMARY KEY,
  room_id INTEGER NOT NULL,
  hub_id INTEGER NOT NULL,
  author_user_id TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  edited_at TEXT,
  reply_to_id TEXT,
  pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0,1)),
  attachment_id TEXT,
  attachment_name TEXT,
  attachment_mime TEXT,
  attachment_size INTEGER,
  attachment_key TEXT,
  FOREIGN KEY(room_id) REFERENCES decave_rooms(id) ON DELETE CASCADE,
  FOREIGN KEY(hub_id) REFERENCES decave_hubs(id) ON DELETE CASCADE,
  FOREIGN KEY(author_user_id) REFERENCES decave_users(id) ON DELETE CASCADE,
  FOREIGN KEY(reply_to_id) REFERENCES decave_messages(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS decave_message_reactions (
  message_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(message_id, user_id, emoji),
  FOREIGN KEY(message_id) REFERENCES decave_messages(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES decave_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS decave_friend_requests (
  sender_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(sender_id, recipient_id),
  CHECK(sender_id <> recipient_id),
  FOREIGN KEY(sender_id) REFERENCES decave_users(id) ON DELETE CASCADE,
  FOREIGN KEY(recipient_id) REFERENCES decave_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS decave_friendships (
  user_a TEXT NOT NULL,
  user_b TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(user_a, user_b),
  CHECK(user_a < user_b),
  FOREIGN KEY(user_a) REFERENCES decave_users(id) ON DELETE CASCADE,
  FOREIGN KEY(user_b) REFERENCES decave_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS decave_direct_messages (
  id TEXT PRIMARY KEY,
  from_user_id TEXT NOT NULL,
  to_user_id TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(from_user_id) REFERENCES decave_users(id) ON DELETE CASCADE,
  FOREIGN KEY(to_user_id) REFERENCES decave_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS decave_custom_roles (
  id TEXT PRIMARY KEY,
  hub_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#62d6ff',
  permissions_json TEXT NOT NULL DEFAULT '[]',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY(hub_id) REFERENCES decave_hubs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS decave_member_roles (
  hub_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  PRIMARY KEY(hub_id, user_id, role_id),
  FOREIGN KEY(hub_id, user_id) REFERENCES decave_hub_members(hub_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY(role_id) REFERENCES decave_custom_roles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS decave_invites (
  code TEXT PRIMARY KEY COLLATE NOCASE,
  hub_id INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  max_uses INTEGER,
  uses INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(hub_id) REFERENCES decave_hubs(id) ON DELETE CASCADE,
  FOREIGN KEY(created_by) REFERENCES decave_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS decave_bans (
  hub_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  banned_by TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  PRIMARY KEY(hub_id, user_id),
  FOREIGN KEY(hub_id) REFERENCES decave_hubs(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES decave_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS decave_timeouts (
  hub_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  timed_out_by TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(hub_id, user_id),
  FOREIGN KEY(hub_id) REFERENCES decave_hubs(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES decave_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS decave_audit (
  id TEXT PRIMARY KEY,
  hub_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  target_user_id TEXT,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY(hub_id) REFERENCES decave_hubs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_decave_sessions_user ON decave_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_decave_sessions_expiry ON decave_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_decave_hub_members_user ON decave_hub_members(user_id);
CREATE INDEX IF NOT EXISTS idx_decave_rooms_hub ON decave_rooms(hub_id, position);
CREATE INDEX IF NOT EXISTS idx_decave_messages_room_time ON decave_messages(room_id, created_at);
CREATE INDEX IF NOT EXISTS idx_decave_dm_pair_time ON decave_direct_messages(from_user_id, to_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_decave_audit_hub_time ON decave_audit(hub_id, created_at);
