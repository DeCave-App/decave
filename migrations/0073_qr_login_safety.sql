-- QR sign-in challenges were created lazily by the Worker; define the original
-- shape here so a fresh database can migrate, then add what the approver is
-- shown (the requesting app/device and a two-letter country code, never an
-- IP address) and a claim id so a challenge can be claimed only once.
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
ALTER TABLE decave_qr_login_challenges ADD COLUMN claim_id TEXT;
