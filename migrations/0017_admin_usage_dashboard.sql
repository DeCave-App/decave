-- Distinct-user activity lookups for the platform admin dashboard.
-- Login events remain append-only; COUNT(DISTINCT user_id) prevents repeat
-- sign-ins by one account from inflating the daily total.

CREATE INDEX IF NOT EXISTS idx_decave_security_events_event_created_user
ON decave_security_events(event, created_at, user_id);

CREATE INDEX IF NOT EXISTS idx_decave_squad_searches_status_expires_user
ON decave_squad_searches(status, expires_at, user_id);
