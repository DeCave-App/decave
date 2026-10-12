-- Wide header image for a Hub (Hub Home and Streamer Overview headers). The
-- tall banner (banner_key) stays the sidebar artwork; without a header image
-- the wide headers fall back to it.
ALTER TABLE decave_hubs ADD COLUMN header_key TEXT;
