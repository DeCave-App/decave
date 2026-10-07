-- DeCave Official Hub: make it a full home for project information.
--
-- Adds the news rooms the overview links to when they are missing, and seeds
-- the first staff posts: welcome, announcements (alpha, 18+, new website),
-- patch notes and the roadmap. Every statement is idempotent: rooms are only
-- created when absent and posts use fixed ids. Posts are authored by the Hub
-- owner (the DeCave team). Like 0058, this file must not name
-- decave_rooms.icon, which the Worker creates at runtime.
--
-- The overview text lives in src/streamer/official-content.ts; keep both in step.

INSERT INTO decave_rooms(hub_id,name,type,category,position,private,created_at,updated_at,kind,forum_post_policy)
SELECT o.hub_id,'welcome','text','START HERE',0,0,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),'chat','staff'
FROM decave_official_hubs o
WHERE o.key='decave-community-v1'
  AND NOT EXISTS (SELECT 1 FROM decave_rooms r WHERE r.hub_id=o.hub_id AND r.name='welcome' AND r.type='text');

INSERT INTO decave_rooms(hub_id,name,type,category,position,private,created_at,updated_at,kind,forum_post_policy)
SELECT o.hub_id,'announcements','text','NEWS',10,0,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),'chat','staff'
FROM decave_official_hubs o
WHERE o.key='decave-community-v1'
  AND NOT EXISTS (SELECT 1 FROM decave_rooms r WHERE r.hub_id=o.hub_id AND r.name='announcements' AND r.type='text');

INSERT INTO decave_rooms(hub_id,name,type,category,position,private,created_at,updated_at,kind,forum_post_policy)
SELECT o.hub_id,'patch-notes','text','NEWS',11,0,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),'chat','staff'
FROM decave_official_hubs o
WHERE o.key='decave-community-v1'
  AND NOT EXISTS (SELECT 1 FROM decave_rooms r WHERE r.hub_id=o.hub_id AND r.name='patch-notes' AND r.type='text');

INSERT INTO decave_rooms(hub_id,name,type,category,position,private,created_at,updated_at,kind,forum_post_policy)
SELECT o.hub_id,'roadmap','text','NEWS',12,0,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),'chat','staff'
FROM decave_official_hubs o
WHERE o.key='decave-community-v1'
  AND NOT EXISTS (SELECT 1 FROM decave_rooms r WHERE r.hub_id=o.hub_id AND r.name='roadmap' AND r.type='text');

INSERT INTO decave_messages(id,room_id,hub_id,author_user_id,text,created_at,pinned)
SELECT 'official-seed-0066-welcome-0',
  (SELECT MIN(r.id) FROM decave_rooms r WHERE r.hub_id=o.hub_id AND r.name='welcome' AND r.type='text'),
  o.hub_id,h.owner_id,
  'Welcome to DeCave 👋

DeCave is a home for the people you play with: Hubs with text, voice and forum rooms, friends and DMs, Squad Finder, events and screen sharing on web, Windows and Mac.

DeCave is in alpha. It is not a finished release: expect rough edges, frequent updates and features that change as we learn. DeCave is for adults aged 18 and over.

Start here:
• #rules: how we keep DeCave kind and safe
• #faq: answers about accounts, privacy, voice and the desktop app
• #announcements and #patch-notes: what''s new
• #roadmap: what we''re building next

Found a bug or have an idea? Use Feedback in the left rail. Thanks for being here early.',
  strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days','+0 minutes'),
  1
FROM decave_official_hubs o
JOIN decave_hubs h ON h.id=o.hub_id
WHERE o.key='decave-community-v1'
  AND NOT EXISTS (SELECT 1 FROM decave_messages m WHERE m.id='official-seed-0066-welcome-0');

INSERT INTO decave_messages(id,room_id,hub_id,author_user_id,text,created_at,pinned)
SELECT 'official-seed-0066-announcements-1',
  (SELECT MIN(r.id) FROM decave_rooms r WHERE r.hub_id=o.hub_id AND r.name='announcements' AND r.type='text'),
  o.hub_id,h.owner_id,
  '📣 Welcome to the DeCave alpha

Thanks for joining early. DeCave is an alpha: it works, it''s free, and it changes often. Your feedback decides what we fix and build next, so please tell us what''s broken or missing with Feedback in the left rail.

Get started in #welcome, and read #rules before you post in other Hubs.',
  strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days','+1 minutes'),
  0
FROM decave_official_hubs o
JOIN decave_hubs h ON h.id=o.hub_id
WHERE o.key='decave-community-v1'
  AND NOT EXISTS (SELECT 1 FROM decave_messages m WHERE m.id='official-seed-0066-announcements-1');

INSERT INTO decave_messages(id,room_id,hub_id,author_user_id,text,created_at,pinned)
SELECT 'official-seed-0066-announcements-2',
  (SELECT MIN(r.id) FROM decave_rooms r WHERE r.hub_id=o.hub_id AND r.name='announcements' AND r.type='text'),
  o.hub_id,h.owner_id,
  '🔞 DeCave is now for adults 18+

From today, DeCave accounts are for people aged 18 and over. New sign-ups confirm their birth date and accept the Terms of Service and Privacy Policy.

If you confirmed an age under 18 earlier, you''ll be asked to confirm your birth date again. We only keep an age band, never your exact birth date.

Terms: https://de-cave.com/terms
Privacy: https://de-cave.com/privacy',
  strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 days','+2 minutes'),
  0
FROM decave_official_hubs o
JOIN decave_hubs h ON h.id=o.hub_id
WHERE o.key='decave-community-v1'
  AND NOT EXISTS (SELECT 1 FROM decave_messages m WHERE m.id='official-seed-0066-announcements-2');

INSERT INTO decave_messages(id,room_id,hub_id,author_user_id,text,created_at,pinned)
SELECT 'official-seed-0066-announcements-3',
  (SELECT MIN(r.id) FROM decave_rooms r WHERE r.hub_id=o.hub_id AND r.name='announcements' AND r.type='text'),
  o.hub_id,h.owner_id,
  '🌐 A new de-cave.com

The website has been rebuilt around real screenshots of the current app, with a roadmap, Q&A, helpful resources and download links:
• Web app: https://app.de-cave.com
• Mac (Apple silicon and Intel), signed and notarized
• Windows, not yet code-signed, so SmartScreen may ask you to confirm

https://de-cave.com',
  strftime('%Y-%m-%dT%H:%M:%fZ','now','-0 days','+3 minutes'),
  0
FROM decave_official_hubs o
JOIN decave_hubs h ON h.id=o.hub_id
WHERE o.key='decave-community-v1'
  AND NOT EXISTS (SELECT 1 FROM decave_messages m WHERE m.id='official-seed-0066-announcements-3');

INSERT INTO decave_messages(id,room_id,hub_id,author_user_id,text,created_at,pinned)
SELECT 'official-seed-0066-patch-notes-4',
  (SELECT MIN(r.id) FROM decave_rooms r WHERE r.hub_id=o.hub_id AND r.name='patch-notes' AND r.type='text'),
  o.hub_id,h.owner_id,
  'Release 0.1.125 – 0.1.128

• Voice: clearer controls during calls
• Voice: muting someone''s stream no longer silences their voice
• iOS: speaker toggle and screen broadcast; echo-prone system audio stays out of streams
• Hubs: Hub Home, streamer overview and message composer have clearer views
• Security and privacy fixes from the latest audit

The desktop apps update automatically. Restart when prompted to install.',
  strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 days','+4 minutes'),
  0
FROM decave_official_hubs o
JOIN decave_hubs h ON h.id=o.hub_id
WHERE o.key='decave-community-v1'
  AND NOT EXISTS (SELECT 1 FROM decave_messages m WHERE m.id='official-seed-0066-patch-notes-4');

INSERT INTO decave_messages(id,room_id,hub_id,author_user_id,text,created_at,pinned)
SELECT 'official-seed-0066-roadmap-5',
  (SELECT MIN(r.id) FROM decave_rooms r WHERE r.hub_id=o.hub_id AND r.name='roadmap' AND r.type='text'),
  o.hub_id,h.owner_id,
  '🗺️ DeCave roadmap (alpha)

✅ Shipped: Hubs with text, voice and forum rooms; voice and screen sharing up to 1440p60; friends and DMs; Squad Finder; Discover; Hub events and calendar; desktop apps for Windows and Mac with automatic updates.

🔧 In progress: Windows code signing, steadier voice and screen sharing, reliability and safety fixes.

⏭️ Next: fresh Android and iOS builds on the same sign-in, history and calls path as desktop.

🔭 Later: a media-server path for bigger voice and screen-share rooms.

This is a direction, not a promise of dates. Full roadmap: https://de-cave.com/roadmap',
  strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 days','+5 minutes'),
  1
FROM decave_official_hubs o
JOIN decave_hubs h ON h.id=o.hub_id
WHERE o.key='decave-community-v1'
  AND NOT EXISTS (SELECT 1 FROM decave_messages m WHERE m.id='official-seed-0066-roadmap-5');

UPDATE decave_streamer_hubs
SET config_json=json_set(config_json,'$.onboarding','Welcome to DeCave! DeCave is in alpha and for adults 18+. Here is how to get started:

1. Set up your profile — click your avatar to add a picture, bio and the games you play.
2. Add friends — open Friends and search by username, then start a private chat or call.
3. Join or create Hubs — browse communities in Discover or start your own with the + button.
4. Read #announcements, #patch-notes and #roadmap to see what''s new and what''s next.
5. Install the desktop app — game detection, notifications and push-to-talk on Windows and Mac.

Your privacy: this official Hub is private for everyone. Other members cannot see that you are here, and you cannot see them. Only the DeCave team posts here.

Need help? Check #faq first, follow #rules everywhere on DeCave, and use Feedback in the left rail to report bugs.'),
    version=version+1,
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE hub_id=(SELECT hub_id FROM decave_official_hubs WHERE key='decave-community-v1');
