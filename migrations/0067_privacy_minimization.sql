-- Data minimization (privacy review, Oct 2026). One-time cleanup of data that
-- the Worker no longer collects; ongoing retention runs hourly in
-- worker/retention.ts.

-- Security events no longer store an IP hash (it was an unsalted SHA-256 of
-- the address, i.e. reversible). Keep the column, blank every value, and drop
-- events older than the 180-day retention period.
UPDATE decave_security_events SET ip_hash='' WHERE ip_hash<>'';
DELETE FROM decave_security_events
WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-180 days');

-- Phone numbers had no use and are no longer collected.
UPDATE decave_account_preferences SET phone_number='' WHERE phone_number<>'';

-- Known devices keep only the fingerprint used to spot new sign-ins.
UPDATE decave_known_devices SET label='' WHERE label<>'';

-- Audit logs no longer record the request country.
UPDATE decave_platform_audit SET request_country=NULL WHERE request_country IS NOT NULL;

-- The moderation audit log stays tamper-proof (no edits, no deleting recent
-- entries) but entries can now expire after the 365-day retention period.
DROP TRIGGER IF EXISTS decave_moderation_audit_no_update;
DROP TRIGGER IF EXISTS decave_moderation_audit_no_delete;
UPDATE decave_moderation_audit_log SET request_country=NULL WHERE request_country IS NOT NULL;
CREATE TRIGGER IF NOT EXISTS decave_moderation_audit_no_update
BEFORE UPDATE ON decave_moderation_audit_log
BEGIN
  SELECT RAISE(ABORT, 'decave_moderation_audit_is_append_only');
END;
CREATE TRIGGER IF NOT EXISTS decave_moderation_audit_no_delete
BEFORE DELETE ON decave_moderation_audit_log
WHEN OLD.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-365 days')
BEGIN
  SELECT RAISE(ABORT, 'decave_moderation_audit_is_append_only');
END;

-- Spent realtime tokens formed a history of when each person connected.
DELETE FROM decave_ws_tokens
WHERE used_at IS NOT NULL OR expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now');

-- Tables from the first prototype schema (0001). Nothing reads or writes
-- them and production holds no rows; children before parents.
DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS timeouts;
DROP TABLE IF EXISTS bans;
DROP TABLE IF EXISTS invites;
DROP TABLE IF EXISTS dm_messages;
DROP TABLE IF EXISTS dm_members;
DROP TABLE IF EXISTS dm_conversations;
DROP TABLE IF EXISTS friendships;
DROP TABLE IF EXISTS friend_requests;
DROP TABLE IF EXISTS attachments;
DROP TABLE IF EXISTS message_pins;
DROP TABLE IF EXISTS message_reactions;
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS member_roles;
DROP TABLE IF EXISTS custom_roles;
DROP TABLE IF EXISTS rooms;
DROP TABLE IF EXISTS hub_members;
DROP TABLE IF EXISTS hub_tags;
DROP TABLE IF EXISTS hubs;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;
