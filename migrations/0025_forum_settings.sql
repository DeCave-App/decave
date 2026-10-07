ALTER TABLE decave_rooms ADD COLUMN forum_guidelines TEXT NOT NULL DEFAULT '';
ALTER TABLE decave_rooms ADD COLUMN forum_post_policy TEXT NOT NULL DEFAULT 'everyone';
ALTER TABLE decave_rooms ADD COLUMN forum_post_role_ids_json TEXT NOT NULL DEFAULT '[]';
