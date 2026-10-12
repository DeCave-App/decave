-- Forms a builder bot opened for one member (openForm after a button, select or
-- command). A submit must match an open row here, so arbitrary form ids can't
-- be posted; the row is removed on submit and ignored once expired.
CREATE TABLE IF NOT EXISTS decave_bot_pending_forms (
  hub_id INTEGER NOT NULL,
  room_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  form_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  fields_json TEXT NOT NULL DEFAULT '[]',
  expires_at INTEGER NOT NULL,
  PRIMARY KEY(hub_id, room_id, user_id, form_id),
  FOREIGN KEY(hub_id) REFERENCES decave_hubs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_decave_bot_pending_forms_expiry ON decave_bot_pending_forms(expires_at);
CREATE INDEX IF NOT EXISTS idx_decave_bot_pending_forms_user ON decave_bot_pending_forms(user_id);
