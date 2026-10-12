-- Remember the last accepted TOTP timestep so a 2FA code cannot be reused
-- within its validity window (including by two concurrent sign-ins).
ALTER TABLE decave_user_mfa ADD COLUMN last_totp_step INTEGER;
ALTER TABLE decave_owner_mfa ADD COLUMN last_totp_step INTEGER;
