-- DeCave Phase 5 - Platform account controls

ALTER TABLE decave_users ADD COLUMN suspended_at TEXT;
ALTER TABLE decave_users ADD COLUMN suspended_until TEXT;
ALTER TABLE decave_users ADD COLUMN suspension_reason TEXT NOT NULL DEFAULT '';

ALTER TABLE decave_users ADD COLUMN must_reset_password INTEGER NOT NULL DEFAULT 0
CHECK (must_reset_password IN (0,1));

ALTER TABLE decave_users ADD COLUMN deleted_at TEXT;
ALTER TABLE decave_users ADD COLUMN delete_after TEXT;
ALTER TABLE decave_users ADD COLUMN deletion_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE decave_users ADD COLUMN erased_at TEXT;

CREATE INDEX IF NOT EXISTS idx_decave_users_suspended
ON decave_users(suspended_at, suspended_until);

CREATE INDEX IF NOT EXISTS idx_decave_users_deleted
ON decave_users(deleted_at, delete_after);

CREATE INDEX IF NOT EXISTS idx_decave_users_reset_required
ON decave_users(must_reset_password);
