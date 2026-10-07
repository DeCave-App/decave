-- Add account-erasure coordination and bounded evidence-upload reservations.
ALTER TABLE decave_users ADD COLUMN erasure_started_at TEXT;

CREATE TABLE IF NOT EXISTS decave_report_evidence_upload_reservations (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  ciphertext_sha256 TEXT NOT NULL CHECK(length(ciphertext_sha256) = 64),
  ciphertext_size INTEGER NOT NULL CHECK(ciphertext_size > 0),
  object_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(report_id, ciphertext_sha256)
);

CREATE INDEX IF NOT EXISTS idx_decave_report_evidence_upload_reservations_user_created
  ON decave_report_evidence_upload_reservations(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_decave_report_evidence_upload_reservations_report_created
  ON decave_report_evidence_upload_reservations(report_id, created_at);

-- Remove preferences belonging to accounts already finalized as erased.
DELETE FROM decave_account_preferences
WHERE user_id IN (SELECT id FROM decave_users WHERE erased_at IS NOT NULL);