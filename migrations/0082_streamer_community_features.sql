-- Per-Hub community features switched on by DeCave staff (not by creators),
-- e.g. {"pugs":true,"leaderboard":true} for a CS2 community. Default: none.
ALTER TABLE decave_streamer_hubs ADD COLUMN community_features TEXT NOT NULL DEFAULT '{}';
