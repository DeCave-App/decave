ALTER TABLE decave_official_hubs
  ADD COLUMN membership_private INTEGER NOT NULL DEFAULT 0
  CHECK(membership_private IN (0,1));

UPDATE decave_official_hubs
SET membership_private=1
WHERE key='decave-community-v1';

DELETE FROM decave_rooms
WHERE type='voice'
  AND hub_id=(
    SELECT hub_id FROM decave_official_hubs
    WHERE key='decave-community-v1'
  );
