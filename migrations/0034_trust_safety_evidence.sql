-- DeCave Trust & Safety Phase 1: encrypted evidence metadata.
-- Plaintext evidence never belongs in D1.  Objects are written under the
-- dedicated safety-evidence/ prefix and are only retrievable through an
-- owner-authenticated, audited route.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS decave_trust_safety_keys (
  key_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL UNIQUE,
  algorithm TEXT NOT NULL,
  public_key TEXT NOT NULL,
  active_at TEXT NOT NULL,
  retired_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_decave_trust_safety_keys_active
  ON decave_trust_safety_keys(active_at)
  WHERE retired_at IS NULL;

CREATE TABLE IF NOT EXISTS decave_report_evidence (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  evidence_type TEXT NOT NULL
    CHECK(evidence_type IN ('message','attachment','profile','context','voice_participant')),
  source_message_id TEXT,
  source_context_type TEXT,
  source_context_id TEXT,
  object_key TEXT NOT NULL UNIQUE,
  ciphertext_sha256 TEXT NOT NULL,
  ciphertext_size INTEGER NOT NULL CHECK(ciphertext_size > 0),
  package_version TEXT NOT NULL,
  encryption_version TEXT NOT NULL,
  key_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  retention_expires_at TEXT,
  legal_hold INTEGER NOT NULL DEFAULT 0 CHECK(legal_hold IN (0,1)),
  deleted_at TEXT,
  FOREIGN KEY(report_id) REFERENCES decave_reports(id) ON DELETE CASCADE,
  FOREIGN KEY(case_id) REFERENCES decave_moderation_cases(id) ON DELETE RESTRICT,
  FOREIGN KEY(key_id) REFERENCES decave_trust_safety_keys(key_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_decave_report_evidence_report
  ON decave_report_evidence(report_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_decave_report_evidence_case
  ON decave_report_evidence(case_id, created_at DESC);
