-- Hubs and rooms someone set to "All messages" (kept in sync with their
-- synced notification settings), so a new message finds who wants a phone
-- notification for every message without reading every member's settings.
CREATE TABLE IF NOT EXISTS decave_push_subscriptions (
  user_id TEXT NOT NULL,
  hub_id INTEGER,
  room_id INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES decave_users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_decave_push_subscriptions_hub ON decave_push_subscriptions(hub_id);
CREATE INDEX IF NOT EXISTS idx_decave_push_subscriptions_room ON decave_push_subscriptions(room_id);
CREATE INDEX IF NOT EXISTS idx_decave_push_subscriptions_user ON decave_push_subscriptions(user_id);

-- Hub insights and the pinned-messages panel read messages by room and time.
CREATE INDEX IF NOT EXISTS idx_decave_messages_hub_created ON decave_messages(hub_id, created_at);
CREATE INDEX IF NOT EXISTS idx_decave_messages_room_pinned ON decave_messages(room_id, pinned);
