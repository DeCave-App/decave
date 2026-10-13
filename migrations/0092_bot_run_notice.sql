-- Bot run log: the detail as a notice ({ code, params, action }) so the bot
-- builder shows run reasons in the viewer's language. Older rows keep NULL.
ALTER TABLE decave_bot_runs ADD COLUMN detail_notice TEXT;
