-- Twitch auto-live for Streamer Hubs. A hub whose creator turns on "Go live
-- automatically" is linked to the Twitch channel in its stream URL; DeCave
-- holds one EventSub stream.online/stream.offline subscription per channel,
-- shared by every hub linked to it.
CREATE TABLE IF NOT EXISTS decave_twitch_broadcasters (
  broadcaster_id TEXT PRIMARY KEY,
  login TEXT NOT NULL,
  online_sub_id TEXT NOT NULL DEFAULT '',
  offline_sub_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS decave_twitch_hub_links (
  hub_id INTEGER PRIMARY KEY,
  broadcaster_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(hub_id) REFERENCES decave_hubs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_decave_twitch_hub_links_broadcaster ON decave_twitch_hub_links(broadcaster_id);

-- EventSub message ids already handled (Twitch retries deliveries). Pruned after a day.
CREATE TABLE IF NOT EXISTS decave_twitch_eventsub_seen (
  message_id TEXT PRIMARY KEY,
  seen_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_decave_twitch_eventsub_seen_at ON decave_twitch_eventsub_seen(seen_at);
