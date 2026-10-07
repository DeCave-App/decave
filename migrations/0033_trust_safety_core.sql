-- DeCave Trust & Safety Phase 1: reports, cases, actions and audit history.
-- Reported content is deliberately absent from this schema. Encrypted safety
-- evidence is stored separately in the dedicated evidence table and R2 prefix.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS decave_moderation_cases (
  id TEXT PRIMARY KEY,
  case_number TEXT NOT NULL UNIQUE,
  primary_subject_user_id TEXT,
  subject_public_id_snapshot TEXT,
  subject_username_snapshot TEXT,
  category TEXT NOT NULL,
  urgency_recommended TEXT NOT NULL
    CHECK(urgency_recommended IN ('critical','high','medium','low','spam_invalid')),
  urgency_effective TEXT NOT NULL
    CHECK(urgency_effective IN ('critical','high','medium','low','spam_invalid')),
  urgency_source TEXT NOT NULL DEFAULT 'system'
    CHECK(urgency_source IN ('system','reporter','owner')),
  status TEXT NOT NULL DEFAULT 'submitted'
    CHECK(status IN ('submitted','under_review','awaiting_information','action_taken','no_violation','escalated','appealed','closed')),
  assigned_owner_user_id TEXT,
  resolution_code TEXT,
  resolution_notes TEXT NOT NULL DEFAULT '',
  critical INTEGER NOT NULL DEFAULT 0 CHECK(critical IN (0,1)),
  legal_hold INTEGER NOT NULL DEFAULT 0 CHECK(legal_hold IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT,
  FOREIGN KEY(primary_subject_user_id) REFERENCES decave_users(id) ON DELETE SET NULL,
  FOREIGN KEY(assigned_owner_user_id) REFERENCES decave_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_decave_moderation_cases_queue
  ON decave_moderation_cases(status, urgency_effective, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_decave_moderation_cases_subject
  ON decave_moderation_cases(primary_subject_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS decave_reports (
  id TEXT PRIMARY KEY,
  reporter_user_id TEXT,
  subject_user_id TEXT,
  target_type TEXT NOT NULL
    CHECK(target_type IN ('user','message','content','attachment','profile','voice_participant')),
  target_id TEXT NOT NULL,
  target_public_id_snapshot TEXT,
  target_username_snapshot TEXT,
  context_type TEXT,
  context_id TEXT,
  context_label TEXT,
  hub_id INTEGER,
  room_id INTEGER,
  category TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  urgency_recommended TEXT NOT NULL
    CHECK(urgency_recommended IN ('critical','high','medium','low','spam_invalid')),
  urgency_effective TEXT NOT NULL
    CHECK(urgency_effective IN ('critical','high','medium','low','spam_invalid')),
  urgency_source TEXT NOT NULL DEFAULT 'reporter'
    CHECK(urgency_source IN ('system','reporter','owner')),
  status TEXT NOT NULL DEFAULT 'submitted'
    CHECK(status IN ('submitted','under_review','awaiting_information','action_taken','no_violation','escalated','appealed','closed')),
  case_id TEXT NOT NULL,
  client_version TEXT,
  submitted_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT,
  FOREIGN KEY(reporter_user_id) REFERENCES decave_users(id) ON DELETE SET NULL,
  FOREIGN KEY(subject_user_id) REFERENCES decave_users(id) ON DELETE SET NULL,
  FOREIGN KEY(case_id) REFERENCES decave_moderation_cases(id) ON DELETE RESTRICT,
  FOREIGN KEY(hub_id) REFERENCES decave_hubs(id) ON DELETE SET NULL,
  FOREIGN KEY(room_id) REFERENCES decave_rooms(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_decave_reports_reporter
  ON decave_reports(reporter_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_decave_reports_subject
  ON decave_reports(subject_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_decave_reports_queue
  ON decave_reports(status, urgency_effective, category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_decave_reports_case
  ON decave_reports(case_id, created_at DESC);

CREATE TABLE IF NOT EXISTS decave_case_links (
  case_id TEXT NOT NULL,
  linked_case_id TEXT NOT NULL,
  relation TEXT NOT NULL DEFAULT 'related'
    CHECK(relation IN ('related','duplicate','escalated_from')),
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(case_id, linked_case_id),
  CHECK(case_id < linked_case_id),
  FOREIGN KEY(case_id) REFERENCES decave_moderation_cases(id) ON DELETE CASCADE,
  FOREIGN KEY(linked_case_id) REFERENCES decave_moderation_cases(id) ON DELETE CASCADE,
  FOREIGN KEY(created_by_user_id) REFERENCES decave_users(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS decave_moderation_case_notes (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  author_user_id TEXT NOT NULL,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(case_id) REFERENCES decave_moderation_cases(id) ON DELETE CASCADE,
  FOREIGN KEY(author_user_id) REFERENCES decave_users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_decave_moderation_case_notes_case
  ON decave_moderation_case_notes(case_id, created_at DESC);

CREATE TABLE IF NOT EXISTS decave_moderation_actions (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  report_id TEXT,
  target_user_id TEXT,
  action_type TEXT NOT NULL
    CHECK(action_type IN ('warning','restrict','suspend','unsuspend','ban','account_delete','account_restore')),
  reason_code TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  duration_hours INTEGER,
  starts_at TEXT NOT NULL,
  expires_at TEXT,
  reversed_at TEXT,
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(case_id) REFERENCES decave_moderation_cases(id) ON DELETE RESTRICT,
  FOREIGN KEY(report_id) REFERENCES decave_reports(id) ON DELETE SET NULL,
  FOREIGN KEY(target_user_id) REFERENCES decave_users(id) ON DELETE SET NULL,
  FOREIGN KEY(created_by_user_id) REFERENCES decave_users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_decave_moderation_actions_case
  ON decave_moderation_actions(case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_decave_moderation_actions_target
  ON decave_moderation_actions(target_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS decave_moderation_audit_log (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT,
  case_id TEXT,
  report_id TEXT,
  action_id TEXT,
  evidence_id TEXT,
  event_type TEXT NOT NULL,
  old_value_json TEXT NOT NULL DEFAULT '{}',
  new_value_json TEXT NOT NULL DEFAULT '{}',
  reason TEXT NOT NULL DEFAULT '',
  request_ray TEXT,
  request_country TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(actor_user_id) REFERENCES decave_users(id) ON DELETE SET NULL,
  FOREIGN KEY(case_id) REFERENCES decave_moderation_cases(id) ON DELETE SET NULL,
  FOREIGN KEY(report_id) REFERENCES decave_reports(id) ON DELETE SET NULL,
  FOREIGN KEY(action_id) REFERENCES decave_moderation_actions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_decave_moderation_audit_created
  ON decave_moderation_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_decave_moderation_audit_case
  ON decave_moderation_audit_log(case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_decave_moderation_audit_report
  ON decave_moderation_audit_log(report_id, created_at DESC);

CREATE TRIGGER IF NOT EXISTS decave_moderation_audit_no_update
BEFORE UPDATE ON decave_moderation_audit_log
BEGIN
  SELECT RAISE(ABORT, 'decave_moderation_audit_is_append_only');
END;

CREATE TRIGGER IF NOT EXISTS decave_moderation_audit_no_delete
BEFORE DELETE ON decave_moderation_audit_log
BEGIN
  SELECT RAISE(ABORT, 'decave_moderation_audit_is_append_only');
END;
