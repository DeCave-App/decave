-- Reset-password links are claimed with one conditional write that also
-- records a claim id, so a link can set a password at most once even when
-- submitted twice at the same moment.
ALTER TABLE decave_auth_tokens ADD COLUMN claim_id TEXT;
