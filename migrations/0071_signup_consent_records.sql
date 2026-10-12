-- Which Terms of Service and Privacy Policy versions an account accepted at
-- sign-up, and when. Nullable: accounts created before this have no record.
ALTER TABLE decave_users ADD COLUMN terms_accepted_at TEXT;
ALTER TABLE decave_users ADD COLUMN terms_version TEXT;
ALTER TABLE decave_users ADD COLUMN privacy_version TEXT;
