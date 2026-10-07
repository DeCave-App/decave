-- Extensible channel presentation kind. Transport remains text or voice so
-- structured content reuses the existing room authorization context.
ALTER TABLE decave_rooms ADD COLUMN kind TEXT NOT NULL DEFAULT 'chat'
  CHECK(kind IN ('chat', 'forum'));

CREATE INDEX IF NOT EXISTS idx_decave_rooms_hub_kind_position
  ON decave_rooms(hub_id, kind, position, id);
