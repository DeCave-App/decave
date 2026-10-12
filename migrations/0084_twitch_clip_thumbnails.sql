-- Clip thumbnails are copied from Twitch into the Hub's own media (R2 key
-- hub-media/<hub>/clip/<id>) so members' devices never load images from Twitch.
ALTER TABLE decave_twitch_clips_posted ADD COLUMN thumbnail_key TEXT;
