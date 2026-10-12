-- Durable R2 deletion: an object key is queued in the same D1 batch that drops
-- the last row pointing at it, and the hourly retention job (worker/retention.ts)
-- retries the R2 delete until R2 confirms. The Worker also creates this table
-- lazily (worker/lib/media.ts) with the identical shape.
CREATE TABLE IF NOT EXISTS decave_media_deletion_queue (
  object_key TEXT PRIMARY KEY,
  queued_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_decave_media_deletion_queue_order
  ON decave_media_deletion_queue(attempts, queued_at);

-- Presence "last online" times are Worker-lazy (HubRoom.ts, lib/hub-schema.ts);
-- define the identical shape so the retention sweep and its index always apply.
CREATE TABLE IF NOT EXISTS decave_presence_activity (
  user_id TEXT PRIMARY KEY,
  last_seen_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES decave_users(id) ON DELETE CASCADE
);

-- Indexes for the bounded retention sweeps and the orphaned-upload check.
CREATE INDEX IF NOT EXISTS idx_decave_presence_activity_last_seen
  ON decave_presence_activity(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_decave_attachment_access_created
  ON decave_attachment_access(created_at);
CREATE INDEX IF NOT EXISTS idx_decave_messages_attachment_key
  ON decave_messages(attachment_key) WHERE attachment_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_decave_push_tokens_session_hash
  ON decave_push_tokens(session_hash);
