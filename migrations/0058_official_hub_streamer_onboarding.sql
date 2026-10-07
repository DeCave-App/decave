-- decave_rooms.icon is created by the Worker at runtime (ensureHubFeatureSchema),
-- not by any migration, so this file must not name it: a fresh database (local
-- dev, tests) replays migrations before the Worker ever runs. The Worker sets
-- the rules/faq icons when it adds or finds the column. Production applied the
-- original version of this file and is unaffected by the edit.

-- DeCave Official Hub: switch to the Streamer Mode overview layout with a real
-- onboarding guide, and add read-only START HERE rooms. Membership stays
-- private (0030) and posting stays owner-only (0029), so members only ever see
-- staff content and their own activity.

INSERT INTO decave_streamer_hubs(hub_id,config_json,version,created_at,updated_at)
SELECT hub_id,
  json_object(
    'creatorName','DeCave',
    'tagline','Welcome to DeCave — good games, better people.',
    'streamTitle','Your home base for news, guides and help',
    'game','',
    'language','English',
    'streamUrl','',
    'queueRules','Community sessions are run by the DeCave team. Join the queue when a session is open, accept the ready check when called, and enjoy one turn per session. Your place in the queue is only visible to you and the team.',
    'onboarding','Welcome to DeCave! Here is how to get started:' || char(10) || char(10) ||
      '1. Set up your profile — click your avatar (bottom left) to add a picture, bio and the games you play.' || char(10) ||
      '2. Add friends — open Friends and search by username, then start a private chat or call.' || char(10) ||
      '3. Find a Squad — pick a game and get matched with players looking for the same thing.' || char(10) ||
      '4. Join or create Hubs — use the + button in the top bar to browse communities or start your own.' || char(10) ||
      '5. Install the desktop app — get game detection, notifications and push-to-talk on Windows and Mac.' || char(10) || char(10) ||
      'Your privacy: this official Hub is private for everyone. Other members cannot see that you are here, and you cannot see them. Only the DeCave team posts here.' || char(10) || char(10) ||
      'Need help? Check #faq first, read #announcements and #patch-notes for what''s new, and follow #rules everywhere on DeCave.'
  ),
  1,
  strftime('%Y-%m-%dT%H:%M:%fZ','now'),
  strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM decave_official_hubs
WHERE key='decave-community-v1'
ON CONFLICT(hub_id) DO UPDATE SET
  config_json=excluded.config_json,
  version=decave_streamer_hubs.version+1,
  updated_at=excluded.updated_at;

INSERT INTO decave_rooms(hub_id,name,type,category,position,private,created_at,updated_at,kind,forum_guidelines,forum_post_policy)
SELECT o.hub_id,'rules','text','START HERE',1,0,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),'forum',
  'Be respectful. No harassment, hate speech, cheating, scams or NSFW content. Do not share other people''s personal information. Breaking the rules can lead to removal from DeCave.',
  'staff'
FROM decave_official_hubs o
WHERE o.key='decave-community-v1'
  AND NOT EXISTS (SELECT 1 FROM decave_rooms r WHERE r.hub_id=o.hub_id AND r.name='rules');

INSERT INTO decave_rooms(hub_id,name,type,category,position,private,created_at,updated_at,kind,forum_guidelines,forum_post_policy)
SELECT o.hub_id,'faq','text','START HERE',2,0,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),'forum',
  'Answers to the most common questions about accounts, friends, Hubs, voice and the desktop app. Posts are written by the DeCave team.',
  'staff'
FROM decave_official_hubs o
WHERE o.key='decave-community-v1'
  AND NOT EXISTS (SELECT 1 FROM decave_rooms r WHERE r.hub_id=o.hub_id AND r.name='faq');

UPDATE decave_rooms SET position=0
WHERE name='welcome' AND hub_id=(SELECT hub_id FROM decave_official_hubs WHERE key='decave-community-v1');
