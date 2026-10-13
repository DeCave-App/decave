-- DeCave Official Hub: patch notes for releases 0.1.129 to 0.1.151.
--
-- Staff forum posts in #patch-notes, authored by the Hub owner, in the same
-- format as the 0066 seed. Idempotent: fixed ids, inserted only when absent.

INSERT INTO decave_messages(id,room_id,hub_id,author_user_id,text,created_at,pinned)
SELECT 'official-0086-patch-notes-0129-0136',
  (SELECT MIN(r.id) FROM decave_rooms r WHERE r.hub_id=o.hub_id AND r.name='patch-notes' AND r.type='text'),
  o.hub_id,h.owner_id,
  '__DECAVE_FORUM_POST_V1__{"version":1,"title":"Release 0.1.129 – 0.1.136","tags":[],"body":"• End-to-end encryption: direct messages and group chats, including their attachments and reactions, are now end-to-end encrypted on web, desktop and mobile\n• Calls: direct calls and voice rooms run through a relay, so other people never see your IP address. Verified participants show a lock\n• Voice: new on-device noise suppression for clearer voice\n• Bot builder: create bots for your Hub in Manage Hub, with commands, triggers, forms, schedules and ready-made templates\n• Account security: two-factor codes can''t be reused, changing your email asks for your two-factor code, and QR sign-in shows who is asking before you approve\n• Privacy: a complete account export, data retention limits and a rewritten Privacy Policy","type":"guide","repliesLocked":true}',
  strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 minutes'),
  0
FROM decave_official_hubs o
JOIN decave_hubs h ON h.id=o.hub_id
WHERE o.key='decave-community-v1'
  AND EXISTS (SELECT 1 FROM decave_rooms r WHERE r.hub_id=o.hub_id AND r.name='patch-notes' AND r.type='text')
  AND NOT EXISTS (SELECT 1 FROM decave_messages m WHERE m.id='official-0086-patch-notes-0129-0136');

INSERT INTO decave_messages(id,room_id,hub_id,author_user_id,text,created_at,pinned)
SELECT 'official-0086-patch-notes-0137-0144',
  (SELECT MIN(r.id) FROM decave_rooms r WHERE r.hub_id=o.hub_id AND r.name='patch-notes' AND r.type='text'),
  o.hub_id,h.owner_id,
  '__DECAVE_FORUM_POST_V1__{"version":1,"title":"Release 0.1.137 – 0.1.144","tags":[],"body":"• Screen sharing now goes through a media server, so it stays smooth with several viewers, and streams stay end-to-end encrypted\n• New Stop Watching button on screen-share cards. Full quality is only sent to people who are actually watching\n• Hubs: banners are shown whole instead of cropped, and Hubs can add a wide header image in Manage Hub\n• Desktop: the voice overlay only appears over games\n• Windows: automatic updates work again. If you installed 0.1.137 – 0.1.140, download the latest version once from de-cave.com","type":"guide","repliesLocked":true}',
  strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 minutes'),
  0
FROM decave_official_hubs o
JOIN decave_hubs h ON h.id=o.hub_id
WHERE o.key='decave-community-v1'
  AND EXISTS (SELECT 1 FROM decave_rooms r WHERE r.hub_id=o.hub_id AND r.name='patch-notes' AND r.type='text')
  AND NOT EXISTS (SELECT 1 FROM decave_messages m WHERE m.id='official-0086-patch-notes-0137-0144');

INSERT INTO decave_messages(id,room_id,hub_id,author_user_id,text,created_at,pinned)
SELECT 'official-0086-patch-notes-0145-0151',
  (SELECT MIN(r.id) FROM decave_rooms r WHERE r.hub_id=o.hub_id AND r.name='patch-notes' AND r.type='text'),
  o.hub_id,h.owner_id,
  '__DECAVE_FORUM_POST_V1__{"version":1,"title":"Release 0.1.145 – 0.1.151","tags":[],"body":"• Read-only rooms: choose who can post in a chat room (everyone, staff or specific roles) in its room settings\n• Mute a room from the bell in its header or from its right-click menu\n• A full icon picker for rooms\n• Emote and sticker uploads now work in the desktop app\n• Hubs stay responsive with many more people online at once\n• Security: updated dependencies and automated security scanning on every change. The source is open for review at github.com/DeCave-App/decave\n\nThe desktop apps update automatically. Restart when prompted to install.","type":"guide","repliesLocked":true}',
  strftime('%Y-%m-%dT%H:%M:%fZ','now','-0 minutes'),
  0
FROM decave_official_hubs o
JOIN decave_hubs h ON h.id=o.hub_id
WHERE o.key='decave-community-v1'
  AND EXISTS (SELECT 1 FROM decave_rooms r WHERE r.hub_id=o.hub_id AND r.name='patch-notes' AND r.type='text')
  AND NOT EXISTS (SELECT 1 FROM decave_messages m WHERE m.id='official-0086-patch-notes-0145-0151');
