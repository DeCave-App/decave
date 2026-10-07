-- End-to-end encryption, part 2 (docs/security/DM-E2EE.md): key rotation, the
-- account's history setting, encrypted DM reactions, and which uploads an
-- encrypted DM uses.

-- A rotated key names the key it replaced, carries that key's signature over it,
-- and its seed sealed to the replaced key so the account's other devices can
-- pick it up. A key created fresh (first key or reset) has none of these.
ALTER TABLE decave_dm_keys ADD COLUMN previous_key_id TEXT;
ALTER TABLE decave_dm_keys ADD COLUMN certificate TEXT;
ALTER TABLE decave_dm_keys ADD COLUMN sealed_for_previous TEXT;

-- How long the account's devices keep replaced keys (NULL: always).
CREATE TABLE IF NOT EXISTS decave_dm_key_settings (
  user_id TEXT PRIMARY KEY,
  history_days INTEGER,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES decave_users(id) ON DELETE CASCADE
);

-- One envelope per account per encrypted DM, holding all of that account's
-- reactions and poll votes on it.
CREATE TABLE IF NOT EXISTS decave_dm_reaction_envelopes (
  message_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  envelope TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (message_id, user_id),
  FOREIGN KEY(user_id) REFERENCES decave_users(id) ON DELETE CASCADE
);

-- The uploads an encrypted DM refers to (space separated R2 keys). Plaintext DMs
-- name them in `text`; an encrypted one can't, so cleanup reads this instead.
ALTER TABLE decave_direct_messages ADD COLUMN attachment_refs TEXT;
