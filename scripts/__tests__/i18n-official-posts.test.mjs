import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { register } from "node:module";
import { test } from "node:test";

register("../test-support/cloudflare-workers-test-loader.mjs", import.meta.url);
const { handleApi } = await import("../../worker/index.ts");
const { D1Mock, MediaMock } = await import("../test-support/worker-sqlite-test-fixture.mjs");

const NOW = "2099-01-01T00:00:00.000Z";
const PREFIX = "__DECAVE_FORUM_POST_V1__";
const hashToken = (value) => createHash("sha256").update(value).digest("hex");
const tokenFor = (userId) => `official-posts-token-${userId}`;
// u1 owns both Hubs (the DeCave team); the others read in their own language.
const USERS = { u1: "el", u2: "el", u3: null, u4: "de" };

const db = new D1Mock();
for (const [userId, locale] of Object.entries(USERS)) {
  db.exec(
    `INSERT INTO decave_users
     (id,username,password_salt,password_hash,created_at,public_id,bio,status,status_text,activity_text,accent,
      email,email_normalized,email_verified_at,requires_email_verification,platform_role,
      suspended_at,suspended_until,suspension_reason,must_reset_password,deleted_at,delete_after,deletion_reason,erased_at,locale)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    userId,
    `user-${userId}`,
    "salt",
    "hash",
    NOW,
    `DC-${userId.slice(1).padStart(16, "0")}`,
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
for (const [hubId, name] of [
  [1, "DeCave Official"],
  [2, "Someone else"],
]) {
  db.exec(
    `INSERT INTO decave_hubs(id,name,icon,owner_id,visibility,description,accent,category,slow_mode_seconds,created_at,updated_at)
     VALUES(?,?,'D','u1','private','','#123456','Gaming',0,?,?)`,
    hubId,
    name,
    NOW,
    NOW,
  );
  for (const userId of Object.keys(USERS)) {
    db.exec(
      "INSERT INTO decave_hub_members(hub_id,user_id,role,joined_at) VALUES(?,?,?,?)",
      hubId,
      userId,
      userId === "u1" ? "owner" : "member",
      NOW,
    );
  }
}
db.exec("INSERT INTO decave_official_hubs(key,hub_id,created_at) VALUES('decave-community-v1',1,?)", NOW);
const forum = (id, hubId, name) =>
  db.exec(
    `INSERT INTO decave_rooms(id,hub_id,name,type,category,position,private,created_at,updated_at,kind,forum_guidelines,forum_post_policy,forum_post_role_ids_json,forum_post_member_ids_json)
     VALUES(?,?,?,'text','START HERE',?,0,?,?,'forum','','staff','[]','[]')`,
    id,
    hubId,
    name,
    id,
    NOW,
    NOW,
  );
forum(10, 1, "faq");
forum(11, 1, "rules");
forum(12, 1, "patch-notes");
forum(20, 2, "faq");

const post = (id, roomId, hubId, title, body) =>
  db.exec(
    "INSERT INTO decave_messages(id,room_id,hub_id,author_user_id,text,created_at) VALUES(?,?,?,'u1',?,?)",
    id,
    roomId,
    hubId,
    `${PREFIX}${JSON.stringify({ version: 1, title, tags: [], body, type: "guide", repliesLocked: true })}`,
    NOW,
  );
const english = JSON.parse(
  fs.readFileSync(new URL("../../shared/i18n/locales/en/official.json", import.meta.url), "utf8"),
);
post("faq-friends", 10, 1, english.faq.friends.title, english.faq.friends.body);
post("faq-report", 10, 1, english.faq.report.title, english.faq.report.body);
post("rules-community", 11, 1, english.rules.communityRules.title, english.rules.communityRules.body);
post("patch-1", 12, 1, "Release 0.1.200", "• Fixes");
post("other-faq", 20, 2, "Our FAQ", "Hub owner's own words");

// Greek rows for the friends FAQ and the rules; none for "report". Rows for the
// patch notes and a non-official Hub must never be used.
const translate = (postId, locale, title, body) =>
  db.exec(
    "INSERT INTO decave_official_post_translations(post_id,locale,title,body) VALUES(?,?,?,?)",
    postId,
    locale,
    title,
    body,
  );
translate("faq-friends", "el", "Πώς προσθέτω φίλους;", "Άνοιξε τους **Φίλους** και ψάξε με όνομα χρήστη.");
translate("rules-community", "el", "Κανόνες κοινότητας DeCave", "Να σέβεσαι τους άλλους.");
translate("patch-1", "el", "Έκδοση 0.1.200", "• Διορθώσεις");
translate("other-faq", "el", "Συχνές ερωτήσεις", "Μετάφραση");

const env = {
  DB: db,
  MEDIA: new MediaMock(),
  ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
  EMAIL: { send: async () => ({ messageId: "test" }) },
  AUTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
  RECOVERY_RATE_LIMITER: { limit: async () => ({ success: true }) },
  HUB_ROOM: {
    idFromName: () => "global",
    get: () => ({
      fetch: async () => Response.json({ success: true, userIds: [], count: 0 }),
    }),
  },
};

async function api(pathname, userId) {
  const response = await handleApi(
    new Request(`https://test.invalid${pathname}`, {
      headers: { authorization: `Bearer ${tokenFor(userId)}` },
    }),
    env,
  );
  assert.equal(response.status, 200, `${pathname} as ${userId}`);
  return response.json();
}
const payloadOf = (message) => JSON.parse(message.text.slice(PREFIX.length));
const listed = async (roomId, userId) =>
  Object.fromEntries(
    (await api(`/api/channels/${roomId}/forum/posts?sort=new`, userId)).posts.map((entry) => [
      entry.message.id,
      payloadOf(entry.message),
    ]),
  );

test("an el viewer gets the Greek version of official FAQ and rules posts", async () => {
  const faq = await listed(10, "u2");
  assert.equal(faq["faq-friends"].title, "Πώς προσθέτω φίλους;");
  assert.equal(faq["faq-friends"].body, "Άνοιξε τους **Φίλους** και ψάξε με όνομα χρήστη.");
  assert.equal(faq["faq-friends"].type, "guide", "the rest of the post is kept");
  assert.equal(faq["faq-friends"].repliesLocked, true);
  // No Greek row yet: the original.
  assert.equal(faq["faq-report"].title, english.faq.report.title);

  const single = await api("/api/channels/11/forum/posts/rules-community", "u2");
  assert.equal(payloadOf(single.post.message).title, "Κανόνες κοινότητας DeCave");
});

test("other viewers get the original text", async () => {
  for (const userId of ["u3", "u4"]) {
    const faq = await listed(10, userId);
    assert.equal(faq["faq-friends"].title, english.faq.friends.title);
    assert.equal(faq["faq-friends"].body, english.faq.friends.body);
  }
  // The author always sees (and edits) the original.
  assert.equal((await listed(10, "u1"))["faq-friends"].title, english.faq.friends.title);
});

test("patch notes and other Hubs' posts are never translated", async () => {
  assert.equal((await listed(12, "u2"))["patch-1"].title, "Release 0.1.200");
  assert.equal((await listed(20, "u2"))["other-faq"].title, "Our FAQ");
});

test("the English source of every official post is in the catalog", () => {
  assert.equal(english.rules.communityRules.title, "DeCave Community Rules");
  assert.equal(Object.keys(english.faq).length, 10);
  for (const entry of [english.rules.communityRules, ...Object.values(english.faq)]) {
    assert.ok(entry.title.trim() && entry.body.trim());
  }
});
