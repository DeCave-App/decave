-- Read-only chat rooms: who can post in a text chat room. Everyone can still
-- read and react. 'everyone' (default), 'staff' (owner, admins, moderators),
-- or 'roles' (owner, admins and members with one of post_role_ids_json).
-- Forums keep their own forum_post_policy.
ALTER TABLE decave_rooms ADD COLUMN post_policy TEXT NOT NULL DEFAULT 'everyone';
ALTER TABLE decave_rooms ADD COLUMN post_role_ids_json TEXT NOT NULL DEFAULT '[]';
