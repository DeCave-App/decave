-- Per-language versions of the DeCave Official Hub's #rules and #faq posts.
--
-- The forum API (worker/lib/official-post-translations.ts) shows a viewer the
-- row for their account language when one exists, else the original post.
-- Patch notes and every other room are never translated.
--
-- The English source lives in shared/i18n/locales/en/official.json (from
-- docs/content/official-hub-posts.md). The posts were made by hand in the Hub,
-- so translation rows find their post by room and title, for example:
--
--   INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
--   SELECT s.message_id,'el','<title>','<body>'
--   FROM decave_forum_post_state s
--   JOIN decave_rooms r ON r.id=s.channel_id
--   JOIN decave_official_hubs o ON o.hub_id=r.hub_id
--   WHERE o.key='decave-community-v1' AND r.name='faq' AND s.title='How do I add friends?';

CREATE TABLE IF NOT EXISTS decave_official_post_translations (
  post_id TEXT NOT NULL,
  locale TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY(post_id, locale)
);
