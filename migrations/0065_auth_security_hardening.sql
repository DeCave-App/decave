ALTER TABLE decave_users ADD COLUMN terms_accepted_at TEXT;
ALTER TABLE decave_users ADD COLUMN terms_version TEXT;
ALTER TABLE decave_users ADD COLUMN privacy_version TEXT;

ALTER TABLE decave_user_mfa ADD COLUMN last_totp_step INTEGER;
ALTER TABLE decave_owner_mfa ADD COLUMN last_totp_step INTEGER;

-- QR login challenges were lazily created by the Worker rather than by a
-- migration; define the legacy shape here so a fresh database can migrate.
-- The Worker's lazy schema (ensureQrLoginSchema) must keep this same legacy
-- shape so these ALTERs succeed whether the table came from this migration,
-- from an older production Worker, or from a fresh Worker that ran first.
CREATE TABLE IF NOT EXISTS decave_qr_login_challenges (
  id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  user_id TEXT,
  expires_at TEXT NOT NULL,
  approved_at TEXT,
  claimed_at TEXT,
  created_at TEXT NOT NULL
);
ALTER TABLE decave_qr_login_challenges ADD COLUMN requester_device TEXT NOT NULL DEFAULT '';
ALTER TABLE decave_qr_login_challenges ADD COLUMN requester_country TEXT NOT NULL DEFAULT '';

ALTER TABLE decave_auth_tokens ADD COLUMN claim_id TEXT;

-- Historical values were unkeyed SHA-256 hashes of IP addresses. Clear them;
-- new keyed values carry an explicit version prefix.
UPDATE decave_security_events SET ip_hash='' WHERE ip_hash NOT LIKE 'hmac:v1:%';
