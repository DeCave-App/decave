ALTER TABLE decave_hubs ADD COLUMN chat_background_key TEXT;
ALTER TABLE decave_hubs ADD COLUMN use_chat_background INTEGER NOT NULL DEFAULT 0;
