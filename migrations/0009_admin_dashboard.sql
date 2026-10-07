-- DeCave Platform Security / Admin Dashboard - Phase 4
-- Read-path indexes for owner-only security/admin views.

CREATE INDEX IF NOT EXISTS idx_decave_security_events_created
ON decave_security_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_decave_security_events_user_created
ON decave_security_events(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_decave_platform_audit_created
ON decave_platform_audit(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_decave_sessions_user_expires
ON decave_sessions(user_id, expires_at);
