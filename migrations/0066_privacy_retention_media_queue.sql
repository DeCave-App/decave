-- Finite application retention and durable cleanup for orphaned R2 objects.

CREATE TABLE IF NOT EXISTS decave_media_deletion_queue (
  object_key TEXT PRIMARY KEY,
  queued_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_decave_media_deletion_queue_queued
  ON decave_media_deletion_queue(queued_at);

CREATE INDEX IF NOT EXISTS idx_decave_auth_tokens_expiry
  ON decave_auth_tokens(expires_at);

CREATE INDEX IF NOT EXISTS idx_decave_ws_tokens_expiry
  ON decave_ws_tokens(expires_at);

CREATE INDEX IF NOT EXISTS idx_decave_secure_account_tokens_expiry
  ON decave_secure_account_tokens(expires_at);

CREATE INDEX IF NOT EXISTS idx_decave_user_login_challenges_expiry
  ON decave_user_login_challenges(expires_at);

CREATE INDEX IF NOT EXISTS idx_decave_owner_login_challenges_expiry
  ON decave_owner_login_challenges(expires_at);

CREATE INDEX IF NOT EXISTS idx_decave_owner_reauth_expiry
  ON decave_owner_reauth(expires_at);

CREATE INDEX IF NOT EXISTS idx_decave_security_events_created
  ON decave_security_events(created_at);

CREATE INDEX IF NOT EXISTS idx_decave_feedback_created
  ON decave_feedback(created_at);

CREATE INDEX IF NOT EXISTS idx_decave_report_evidence_retention
  ON decave_report_evidence(retention_expires_at, created_at);

-- Evidence without an explicit override receives the same finite default as
-- newly submitted evidence. A legal hold still supersedes this expiry.
UPDATE decave_report_evidence
SET retention_expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+365 days')
WHERE retention_expires_at IS NULL;
