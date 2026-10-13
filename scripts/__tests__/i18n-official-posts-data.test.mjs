// Migration 0093 fills decave_official_post_translations from the locale
// catalogs. Here it runs against Official Hub posts written with the English
// titles, the way the DeCave team posted them, and viewers read them through
// the forum API.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { register } from "node:module";
import { test } from "node:test";

register("../test-support/cloudflare-workers-test-loader.mjs", import.meta.url);
const { handleApi } = await import("../../worker/index.ts");
const { D1Mock, MediaMock } = await import("../test-support/worker-sqlite-test-fixture.mjs");
const { LOCALES, DEFAULT_LOCALE } = await import("../../shared/i18n/languages.ts");

const NOW = "2099-01-01T00:00:00.000Z";
const PREFIX = "__DECAVE_FORUM_POST_V1__";
const MIGRATION = new URL("../../migrations/0093_official_post_translations_data.sql", import.meta.url);
// 0094 updates the posts whose text changed when "Squad" stopped being translated.
const SQUAD_MIGRATION = new URL("../../migrations/0094_official_post_translations_squad.sql", import.meta.url);
// 0095 updates the posts whose text changed in the Discord/Steam terminology review.
const REVIEW_MIGRATION = new URL("../../migrations/0095_official_post_translations_review.sql", import.meta.url);
// A Windows checkout may turn the SQL line endings into CRLF; the stored text uses LF.
const readSql = (url) => fs.readFileSync(url, "utf8").replace(/\r\n/g, "\n");
const hashToken = (value) => createHash("sha256").update(value).digest("hex");
const tokenFor = (userId) => `official-posts-data-token-${userId}`;
const catalog = (locale) =>
  JSON.parse(fs.readFileSync(new URL(`../../shared/i18n/locales/${locale}/official.json`, import.meta.url), "utf8"));
const english = catalog("en");

// "owner" wrote the posts; one reader per shipped locale, plus one with no language set.
const READERS = Object.fromEntries(
  [...LOCALES.filter((locale) => locale !== DEFAULT_LOCALE), null].map((locale) => [
    `reader-${locale ?? "none"}`,
    locale,
  ]),
);
const USERS = { owner: null, ...READERS };

const db = new D1Mock();
let serial = 0;
for (const [userId, locale] of Object.entries(USERS)) {
  serial += 1;
  db.exec(
    `INSERT INTO decave_users
     (id,username,password_salt,password_hash,created_at,public_id,bio,status,status_text,activity_text,accent,
      email,email_normalized,email_verified_at,requires_email_verification,platform_role,
      suspended_at,suspended_until,suspension_reason,must_reset_password,deleted_at,delete_after,deletion_reason,erased_at,locale)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    userId,
    userId,
    "salt",
    "hash",
    NOW,
    `DC-${String(serial).padStart(16, "0")}`,
    "",
    "online",
    "",
    "",
    "#7c5cff",
    `${userId}@example.test`,
    `${userId}@example.test`,
    NOW,
    0,
    "user",
    null,
    null,
    "",
    0,
    null,
    null,
    "",
    null,
    locale,
  );
  db.exec(
    "INSERT INTO decave_sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)",
    hashToken(tokenFor(userId)),
    userId,
    "2100-01-01T00:00:00.000Z",
    NOW,
  );
}
db.exec(
  `INSERT INTO decave_hubs(id,name,icon,owner_id,visibility,description,accent,category,slow_mode_seconds,created_at,updated_at)
   VALUES(1,'DeCave Official','D','owner','private','','#123456','Gaming',0,?,?)`,
  NOW,
  NOW,
);
for (const userId of Object.keys(USERS)) {
  db.exec(
    "INSERT INTO decave_hub_members(hub_id,user_id,role,joined_at) VALUES(1,?,?,?)",
    userId,
    userId === "owner" ? "owner" : "member",
    NOW,
  );
}
db.exec("INSERT INTO decave_official_hubs(key,hub_id,created_at) VALUES('decave-community-v1',1,?)", NOW);
for (const [id, name] of [
  [10, "faq"],
  [11, "rules"],
]) {
  db.exec(
    `INSERT INTO decave_rooms(id,hub_id,name,type,category,position,private,created_at,updated_at,kind,forum_guidelines,forum_post_policy,forum_post_role_ids_json,forum_post_member_ids_json)
     VALUES(?,1,?,'text','START HERE',?,0,?,?,'forum','','staff','[]','[]')`,
    id,
    name,
    id,
    NOW,
    NOW,
  );
}
const post = (id, roomId, title, body) =>
  db.exec(
    "INSERT INTO decave_messages(id,room_id,hub_id,author_user_id,text,created_at) VALUES(?,?,1,'owner',?,?)",
    id,
    roomId,
    `${PREFIX}${JSON.stringify({ version: 1, title, tags: [], body, type: "guide", repliesLocked: true })}`,
    NOW,
  );
for (const [key, entry] of Object.entries(english.faq)) post(`faq-${key}`, 10, entry.title, entry.body);
post("rules-community", 11, english.rules.communityRules.title, english.rules.communityRules.body);
// The team retitled this one by hand, so no translation may attach to it.
post("faq-renamed", 10, "Our own question", "Answered in the Hub.");

// The migrations already ran on the empty database; run them again now that the posts exist.
db.sqlite.exec(readSql(MIGRATION));
db.sqlite.exec(readSql(SQUAD_MIGRATION));
db.sqlite.exec(readSql(REVIEW_MIGRATION));

const env = {
  DB: db,
  MEDIA: new MediaMock(),
  ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
  EMAIL: { send: async () => ({ messageId: "test" }) },
  AUTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
  RECOVERY_RATE_LIMITER: { limit: async () => ({ success: true }) },
  HUB_ROOM: {
    idFromName: () => "global",
    get: () => ({ fetch: async () => Response.json({ success: true, userIds: [], count: 0 }) }),
  },
};

async function api(pathname, userId) {
  const response = await handleApi(
    new Request(`https://test.invalid${pathname}`, { headers: { authorization: `Bearer ${tokenFor(userId)}` } }),
    env,
  );
  assert.equal(response.status, 200, `${pathname} as ${userId}`);
  return response.json();
}
const listed = async (roomId, userId) =>
  Object.fromEntries(
    (await api(`/api/channels/${roomId}/forum/posts?sort=new`, userId)).posts.map((entry) => [
      entry.message.id,
      JSON.parse(entry.message.text.slice(PREFIX.length)),
    ]),
  );

test("the migration has one row per locale for every rules and FAQ post", () => {
  const posts = 1 + Object.keys(english.faq).length;
  const locales = LOCALES.filter((locale) => locale !== DEFAULT_LOCALE);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_official_post_translations"), posts * locales.length);
  for (const locale of locales) {
    assert.equal(
      db.scalar("SELECT COUNT(*) FROM decave_official_post_translations WHERE locale=?", locale),
      posts,
      locale,
    );
  }
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_official_post_translations WHERE post_id='faq-renamed'"), 0);
});

test("an el viewer gets the Greek rules and FAQ from the catalog", async () => {
  const greek = catalog("el");
  const faq = await listed(10, "reader-el");
  assert.equal(faq["faq-friends"].title, greek.faq.friends.title);
  assert.equal(faq["faq-friends"].body, greek.faq.friends.body);
  assert.equal(faq["faq-deleteAccount"].title, greek.faq.deleteAccount.title);
  assert.match(faq["faq-friends"].title, /[Ͱ-Ͽ]/, "the title is Greek");
  assert.equal(faq["faq-renamed"].title, "Our own question");
  const rules = await listed(11, "reader-el");
  assert.equal(rules["rules-community"].title, greek.rules.communityRules.title);
  assert.equal(rules["rules-community"].body, greek.rules.communityRules.body);
  assert.equal(rules["rules-community"].type, "guide", "the rest of the post is kept");
});

test("every locale gets its own catalog text for every post", async () => {
  for (const [userId, locale] of Object.entries(READERS)) {
    if (!locale) continue;
    const text = catalog(locale);
    const faq = await listed(10, userId);
    for (const [key, entry] of Object.entries(text.faq)) {
      assert.equal(faq[`faq-${key}`].title, entry.title, `${locale} faq.${key}.title`);
      assert.equal(faq[`faq-${key}`].body, entry.body, `${locale} faq.${key}.body`);
    }
    const rules = await listed(11, userId);
    assert.equal(rules["rules-community"].title, text.rules.communityRules.title, locale);
    assert.equal(rules["rules-community"].body, text.rules.communityRules.body, locale);
  }
});

test("viewers without a language and the author see the English original", async () => {
  for (const userId of ["reader-none", "owner"]) {
    const faq = await listed(10, userId);
    assert.equal(faq["faq-friends"].title, english.faq.friends.title);
    assert.equal(faq["faq-friends"].body, english.faq.friends.body);
  }
});
