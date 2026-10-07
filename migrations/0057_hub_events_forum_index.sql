-- Hub calendar events (first-class rows instead of __DECAVE_EVENT__ chat
-- messages) and a denormalized forum post index so forum feeds are no longer
-- limited to the latest message-history page.

CREATE TABLE IF NOT EXISTS decave_hub_events (
  id TEXT PRIMARY KEY,
  hub_id INTEGER NOT NULL,
  channel_id INTEGER,
  voice_channel_id INTEGER,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 100),
  description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 2000),
  cover_url TEXT,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  recurrence TEXT NOT NULL DEFAULT 'none' CHECK(recurrence IN ('none','daily','weekly','monthly')),
  audience TEXT NOT NULL DEFAULT 'all' CHECK(audience IN ('all','roles','members')),
  audience_ids_json TEXT NOT NULL DEFAULT '[]',
  reminder_minutes INTEGER,
  capacity INTEGER CHECK(capacity IS NULL OR (capacity BETWEEN 1 AND 10000)),
  game_tag TEXT,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  cancelled_at INTEGER,
  CHECK(ends_at IS NULL OR ends_at > starts_at),
  FOREIGN KEY(hub_id) REFERENCES decave_hubs(id) ON DELETE CASCADE,
  FOREIGN KEY(channel_id) REFERENCES decave_rooms(id) ON DELETE SET NULL,
  FOREIGN KEY(voice_channel_id) REFERENCES decave_rooms(id) ON DELETE SET NULL,
  FOREIGN KEY(created_by) REFERENCES decave_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_decave_hub_events_hub_start
  ON decave_hub_events(hub_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_decave_hub_events_hub_recurring
  ON decave_hub_events(hub_id, recurrence) WHERE recurrence <> 'none';

CREATE TABLE IF NOT EXISTS decave_hub_event_rsvps (
  event_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('going','maybe','declined')),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(event_id, user_id),
  FOREIGN KEY(event_id) REFERENCES decave_hub_events(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES decave_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_decave_hub_event_rsvps_event_status
  ON decave_hub_event_rsvps(event_id, status, updated_at);

-- Moderator-defined forum tag list (JSON array of strings, max 20 x 24 chars).
ALTER TABLE decave_rooms ADD COLUMN forum_tags_json TEXT NOT NULL DEFAULT '[]';

CREATE TABLE IF NOT EXISTS decave_forum_post_state (
  message_id TEXT PRIMARY KEY,
  channel_id INTEGER NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0,1)),
  locked INTEGER NOT NULL DEFAULT 0 CHECK(locked IN (0,1)),
  solved_reply_id TEXT,
  last_activity_at TEXT NOT NULL,
  reply_count INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(message_id) REFERENCES decave_messages(id) ON DELETE CASCADE,
  FOREIGN KEY(channel_id) REFERENCES decave_rooms(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_decave_forum_post_state_activity
  ON decave_forum_post_state(channel_id, pinned DESC, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_decave_forum_post_state_created
  ON decave_forum_post_state(channel_id, pinned DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_decave_messages_reply_to
  ON decave_messages(reply_to_id, created_at);

-- Backfill every existing top-level forum post.
INSERT OR IGNORE INTO decave_forum_post_state
  (message_id, channel_id, pinned, locked, solved_reply_id, last_activity_at, reply_count, title, tags_json, created_at, updated_at)
SELECT
  m.id,
  m.room_id,
  0,
  0,
  NULL,
  COALESCE((SELECT MAX(r.created_at) FROM decave_messages r WHERE r.reply_to_id = m.id), m.created_at),
  (SELECT COUNT(*) FROM decave_messages r WHERE r.reply_to_id = m.id),
  CASE WHEN json_valid(substr(m.text, 25)) THEN COALESCE(substr(CAST(json_extract(substr(m.text, 25), '$.title') AS TEXT), 1, 200), '') ELSE '' END,
  CASE WHEN json_valid(substr(m.text, 25)) AND json_type(substr(m.text, 25), '$.tags') = 'array'
       THEN json_extract(substr(m.text, 25), '$.tags') ELSE '[]' END,
  m.created_at,
  m.created_at
FROM decave_messages m
JOIN decave_rooms room ON room.id = m.room_id
WHERE room.kind = 'forum'
  AND m.reply_to_id IS NULL
  AND substr(m.text, 1, 24) = '__DECAVE_FORUM_POST_V1__';

-- Keep the index consistent for every write path (WebSocket, REST delete,
-- account erasure, room/hub cascades) at the database level.
CREATE TRIGGER IF NOT EXISTS trg_decave_forum_post_insert
AFTER INSERT ON decave_messages
WHEN NEW.reply_to_id IS NULL
  AND substr(NEW.text, 1, 24) = '__DECAVE_FORUM_POST_V1__'
  AND EXISTS (SELECT 1 FROM decave_rooms WHERE id = NEW.room_id AND kind = 'forum')
BEGIN
  INSERT OR IGNORE INTO decave_forum_post_state
    (message_id, channel_id, last_activity_at, reply_count, title, tags_json, created_at, updated_at)
  VALUES (
    NEW.id,
    NEW.room_id,
    NEW.created_at,
    0,
    CASE WHEN json_valid(substr(NEW.text, 25)) THEN COALESCE(substr(CAST(json_extract(substr(NEW.text, 25), '$.title') AS TEXT), 1, 200), '') ELSE '' END,
    CASE WHEN json_valid(substr(NEW.text, 25)) AND json_type(substr(NEW.text, 25), '$.tags') = 'array'
         THEN json_extract(substr(NEW.text, 25), '$.tags') ELSE '[]' END,
    NEW.created_at,
    NEW.created_at
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_decave_forum_post_edit
AFTER UPDATE OF text ON decave_messages
WHEN NEW.reply_to_id IS NULL
BEGIN
  UPDATE decave_forum_post_state SET
    title = CASE WHEN json_valid(substr(NEW.text, 25)) THEN COALESCE(substr(CAST(json_extract(substr(NEW.text, 25), '$.title') AS TEXT), 1, 200), '') ELSE '' END,
    tags_json = CASE WHEN json_valid(substr(NEW.text, 25)) AND json_type(substr(NEW.text, 25), '$.tags') = 'array'
                     THEN json_extract(substr(NEW.text, 25), '$.tags') ELSE '[]' END,
    updated_at = COALESCE(NEW.edited_at, updated_at)
  WHERE message_id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_decave_forum_reply_insert
AFTER INSERT ON decave_messages
WHEN NEW.reply_to_id IS NOT NULL
BEGIN
  UPDATE decave_forum_post_state
  SET reply_count = reply_count + 1,
      last_activity_at = CASE WHEN NEW.created_at > last_activity_at THEN NEW.created_at ELSE last_activity_at END,
      updated_at = NEW.created_at
  WHERE message_id = NEW.reply_to_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_decave_forum_reply_delete
AFTER DELETE ON decave_messages
WHEN OLD.reply_to_id IS NOT NULL
BEGIN
  UPDATE decave_forum_post_state
  SET reply_count = (SELECT COUNT(*) FROM decave_messages WHERE reply_to_id = OLD.reply_to_id),
      last_activity_at = COALESCE(
        (SELECT MAX(created_at) FROM decave_messages WHERE reply_to_id = OLD.reply_to_id),
        (SELECT created_at FROM decave_messages WHERE id = OLD.reply_to_id),
        last_activity_at
      ),
      solved_reply_id = CASE WHEN solved_reply_id = OLD.id THEN NULL ELSE solved_reply_id END
  WHERE message_id = OLD.reply_to_id;
END;
