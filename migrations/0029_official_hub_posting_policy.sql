ALTER TABLE decave_official_hubs
  ADD COLUMN owner_only_posts INTEGER NOT NULL DEFAULT 0
  CHECK(owner_only_posts IN (0,1));

UPDATE decave_official_hubs
SET owner_only_posts=1
WHERE key='decave-community-v1';
