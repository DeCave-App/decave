-- DeCave Trust & Safety Phase 1: account safety state and contact controls.
-- Exact dates are intentionally not stored.  The Worker stores only the
-- derived age policy state needed to enforce the product's safety defaults.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS decave_user_safety_profiles (
  user_id TEXT PRIMARY KEY,
  age_status TEXT NOT NULL DEFAULT 'unconfirmed'
    CHECK(age_status IN ('unconfirmed','eligible','ineligible','review')),
  age_band TEXT NOT NULL DEFAULT 'unknown'
    CHECK(age_band IN ('unknown','teen','adult')),
  teen_safety_mode INTEGER NOT NULL DEFAULT 1
    CHECK(teen_safety_mode IN (0,1)),
  age_policy_version TEXT NOT NULL DEFAULT '2026-09-v1',
  age_assurance_method TEXT NOT NULL DEFAULT 'unknown'
    CHECK(age_assurance_method IN ('unknown','self_attested','reviewed')),
  age_acknowledged_at TEXT,
  age_verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES decave_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_decave_user_safety_age
  ON decave_user_safety_profiles(age_status, age_band, teen_safety_mode);

INSERT OR IGNORE INTO decave_user_safety_profiles
  (user_id,age_status,age_band,teen_safety_mode,age_policy_version,
   age_assurance_method,age_acknowledged_at,age_verified_at,created_at,updated_at)
SELECT id,'unconfirmed','unknown',1,'2026-09-v1','unknown',NULL,NULL,created_at,created_at
FROM decave_users;

CREATE TABLE IF NOT EXISTS decave_user_blocks (
  blocker_user_id TEXT NOT NULL,
  blocked_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(blocker_user_id, blocked_user_id),
  CHECK(blocker_user_id <> blocked_user_id),
  FOREIGN KEY(blocker_user_id) REFERENCES decave_users(id) ON DELETE CASCADE,
  FOREIGN KEY(blocked_user_id) REFERENCES decave_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_decave_user_blocks_blocked
  ON decave_user_blocks(blocked_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS decave_user_mutes (
  muter_user_id TEXT NOT NULL,
  muted_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(muter_user_id, muted_user_id),
  CHECK(muter_user_id <> muted_user_id),
  FOREIGN KEY(muter_user_id) REFERENCES decave_users(id) ON DELETE CASCADE,
  FOREIGN KEY(muted_user_id) REFERENCES decave_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_decave_user_mutes_muted
  ON decave_user_mutes(muted_user_id, created_at DESC);
