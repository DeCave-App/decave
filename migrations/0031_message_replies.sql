-- Reply targets for private conversations. Group-chat messages are created
-- lazily by worker/db.ts and are upgraded there for existing installations.
ALTER TABLE decave_direct_messages ADD COLUMN reply_to_id TEXT;

CREATE INDEX IF NOT EXISTS idx_decave_direct_messages_reply
  ON decave_direct_messages(reply_to_id);
