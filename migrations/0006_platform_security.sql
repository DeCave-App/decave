-- DeCave Platform Security - Phase 1
-- Adds platform-level ownership independent from Hub ownership.
-- Existing users remain normal platform users by default.

ALTER TABLE decave_users
ADD COLUMN platform_role TEXT NOT NULL DEFAULT 'user'
CHECK (platform_role IN ('user', 'admin', 'owner'));

CREATE INDEX IF NOT EXISTS idx_decave_users_platform_role
ON decave_users(platform_role);

CREATE TABLE IF NOT EXISTS decave_platform_audit (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  target_user_id TEXT,
  action TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  request_ray TEXT,
  request_country TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (actor_user_id) REFERENCES decave_users(id) ON DELETE RESTRICT,
  FOREIGN KEY (target_user_id) REFERENCES decave_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_decave_platform_audit_created
ON decave_platform_audit(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_decave_platform_audit_actor
ON decave_platform_audit(actor_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_decave_platform_audit_target
ON decave_platform_audit(target_user_id, created_at DESC);

-- Database-level backstop:
-- once DeCave has two owners, SQL updates/deletes are prevented from
-- taking the project below two owners. Promote a third owner before
-- intentionally removing one of the two existing owners.

CREATE TRIGGER IF NOT EXISTS decave_protect_minimum_platform_owners_update
BEFORE UPDATE OF platform_role ON decave_users
WHEN
  OLD.platform_role = 'owner'
  AND NEW.platform_role <> 'owner'
  AND (SELECT COUNT(*) FROM decave_users WHERE platform_role = 'owner') <= 2
BEGIN
  SELECT RAISE(ABORT, 'decave_requires_two_platform_owners');
END;

CREATE TRIGGER IF NOT EXISTS decave_protect_minimum_platform_owners_delete
BEFORE DELETE ON decave_users
WHEN
  OLD.platform_role = 'owner'
  AND (SELECT COUNT(*) FROM decave_users WHERE platform_role = 'owner') <= 2
BEGIN
  SELECT RAISE(ABORT, 'decave_requires_two_platform_owners');
END;
