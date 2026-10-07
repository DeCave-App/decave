import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

register("../test-support/cloudflare-workers-test-loader.mjs", import.meta.url);
const { D1Mock, MediaMock } = await import("../test-support/worker-sqlite-test-fixture.mjs");
const { handleApi } = await import("../../worker/index.ts");
const { ensureQrLoginSchema, securityEventIpHash } = await import("../../worker/lib/sessions.ts");
const { ensureSquadFinderSchema } = await import("../../worker/lib/squad.ts");
const { ensureCollaborationSchema } = await import("../../worker/lib/hub-schema.ts");
const { maskPushToken } = await import("../../shared/account-export.ts");
const retention = await import("../../worker/lib/retention.ts");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-10-05T12:00:00.000Z");
const ago = (days) => new Date(now.getTime() - days * DAY).toISOString();
const hash = (value) => createHash("sha256").update(value).digest("hex");
const tokenFor = (userId) => `retention-gap-token-${userId}`;

// Runs first: the lazy QR schema promise is cached per module instance.
test("QR challenge columns migrate whether the Worker or migration 0065 created the table first", async () => {
  let lazySql = "";
  await ensureQrLoginSchema({ DB: { prepare: (sql) => ((lazySql = sql), { run: async () => ({}) }) } });
  assert.match(lazySql, /CREATE TABLE IF NOT EXISTS decave_qr_login_challenges/);
  assert.doesNotMatch(lazySql, /requester_device|requester_country/, "lazy schema must stay the pre-0065 shape");

  const migrationDir = path.join(root, "migrations");
  const files = fs
    .readdirSync(migrationDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const lazyFirst of [true, false]) {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(`CREATE TABLE decave_account_preferences (user_id TEXT PRIMARY KEY, phone_number TEXT NOT NULL DEFAULT '',
      username_changed_at TEXT, friend_request_policy TEXT NOT NULL DEFAULT 'everyone',
      allow_stream_previews INTEGER NOT NULL DEFAULT 1, streamer_mode INTEGER NOT NULL DEFAULT 0,
      language TEXT NOT NULL DEFAULT 'en', time_format TEXT NOT NULL DEFAULT 'system', updated_at TEXT NOT NULL)`);
    for (const file of files) {
      if (file.startsWith("0065") && lazyFirst) sqlite.exec(lazySql);
      sqlite.exec(fs.readFileSync(path.join(migrationDir, file), "utf8"));
    }
    if (!lazyFirst) sqlite.exec(lazySql);
    const columns = sqlite
      .prepare("PRAGMA table_info(decave_qr_login_challenges)")
      .all()
      .map((row) => row.name);
    assert.ok(columns.includes("requester_device") && columns.includes("requester_country"));
    assert.equal(
      sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='decave_steam_link_states'").get().n,
      1,
      "migration 0067 defines the Steam link state table",
    );
  }
});

const db = new D1Mock();
const media = new MediaMock();
const env = {
  DB: db,
  MEDIA: media,
  ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
  EMAIL: { send: async () => ({ messageId: "test" }) },
  AUTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
  RECOVERY_RATE_LIMITER: { limit: async () => ({ success: true }) },
  HUB_ROOM: {
    idFromName: () => "global",
    get: () => ({
      fetch: async (request) =>
        new URL(request.url).pathname === "/internal/online-users"
          ? Response.json({ userIds: [] })
          : Response.json({ success: true }),
    }),
  },
};

for (const [index, id] of ["u1", "u2", "u3"].entries()) {
  db.exec(
    `INSERT INTO decave_users(id,username,password_salt,password_hash,created_at,public_id,email,email_normalized,
       email_verified_at,platform_role)
     VALUES(?,?,?,?,?,?,?,?,?,?)`,
    id,
    `user-${id}`,
    "salt",
    "hash",
    ago(1000),
    `DC-${String(index + 1).padStart(16, "0")}`,
    `${id}@example.test`,
    `${id}@example.test`,
    ago(1000),
    id === "u1" ? "owner" : "user",
  );
  db.exec(
    "INSERT INTO decave_sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)",
    hash(tokenFor(id)),
    id,
    "2100-01-01T00:00:00.000Z",
    ago(1),
  );
}
db.exec("INSERT INTO decave_friendships(user_a,user_b,created_at) VALUES('u1','u2',?)", ago(500));
db.exec(
  "INSERT INTO decave_hubs(id,name,icon,owner_id,visibility,created_at,updated_at) VALUES(1,'Main Hub','M','u3','private',?,?)",
  ago(500),
  ago(500),
);
db.exec(
  "INSERT INTO decave_rooms(id,hub_id,name,type,created_at,updated_at) VALUES(10,1,'general','text',?,?)",
  ago(500),
  ago(500),
);
for (const id of ["u1", "u2", "u3"])
  db.exec(
    "INSERT INTO decave_hub_members(hub_id,user_id,role,joined_at) VALUES(1,?,?,?)",
    id,
    id === "u3" ? "owner" : "member",
    ago(500),
  );

async function api(pathname, userId, { method = "GET", body } = {}) {
  const headers = new Headers({ authorization: `Bearer ${tokenFor(userId)}` });
  if (body !== undefined) headers.set("content-type", "application/json");
  const response = await handleApi(
    new Request(`https://test.invalid${pathname}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  );
  return response;
}

test("account export includes reactions, filed reports, masked push registrations and received DMs", async () => {
  db.exec(
    "INSERT INTO decave_messages(id,room_id,hub_id,author_user_id,text,created_at) VALUES('m-react',10,1,'u1','hi',?)",
    ago(3),
  );
  db.exec(
    "INSERT INTO decave_message_reactions(message_id,user_id,emoji,created_at) VALUES('m-react','u2','fire',?)",
    ago(3),
  );
  db.exec(
    "INSERT INTO decave_direct_messages(id,from_user_id,to_user_id,text,created_at) VALUES('dm-in','u1','u2','incoming hello',?)",
    ago(3),
  );
  db.exec("INSERT INTO decave_dm_reactions(message_id,user_id,emoji,created_at) VALUES('dm-in','u2','wave',?)", ago(3));
  db.exec(
    `INSERT INTO decave_moderation_cases(id,case_number,category,urgency_recommended,urgency_effective,created_at,updated_at)
     VALUES('case-export','CASE-EXPORT','spam','low','low',?,?)`,
    ago(3),
    ago(3),
  );
  db.exec(
    `INSERT INTO decave_reports(id,reporter_user_id,target_type,target_id,category,description,urgency_recommended,
       urgency_effective,status,case_id,submitted_at,created_at,updated_at)
     VALUES('report-export','u2','user','internal-target','spam','they spam','low','low','submitted','case-export',?,?,?)`,
    ago(3),
    ago(3),
    ago(3),
  );
  const pushToken = "ExponentPushToken[abcdefghijklmnop1234]";
  db.exec(
    "INSERT INTO decave_push_tokens(token,user_id,session_hash,platform,created_at) VALUES(?,?,?,?,?)",
    pushToken,
    "u2",
    hash(tokenFor("u2")),
    "ios",
    ago(3),
  );
  db.exec("INSERT INTO decave_push_subscriptions(user_id,hub_id,room_id,created_at) VALUES('u2',1,NULL,?)", ago(3));

  const response = await api("/api/account/export", "u2");
  assert.equal(response.status, 200);
  const text = await response.text();
  const data = JSON.parse(text);
  assert.equal(data.complete, true);
  assert.deepEqual(
    data.hubMessageReactions.map((row) => [row.hub, row.room, row.emoji]),
    [["Main Hub", "general", "fire"]],
  );
  assert.deepEqual(
    data.directMessageReactions.map((row) => row.emoji),
    ["wave"],
  );
  assert.equal(data.reportsFiled.length, 1);
  assert.equal(data.reportsFiled[0].description, "they spam");
  assert.ok(!text.includes("internal-target"), "internal target ids are not exported");
  assert.equal(data.pushTokens.length, 1);
  assert.equal(data.pushTokens[0].token, maskPushToken(pushToken));
  assert.match(data.pushTokens[0].token, /^ExponentPushToken\[\*+1234\]$/);
  assert.ok(!text.includes("abcdefghijklmnop"), "the usable push token is never exported");
  assert.ok(!text.includes(hash(tokenFor("u2"))), "session hashes are never exported");
  assert.deepEqual(
    data.pushSubscriptions.map((row) => row.hub),
    ["Main Hub"],
  );
  assert.deepEqual(
    data.directMessagesReceived.map((row) => [row.sender, row.text]),
    [["user-u1", "incoming hello"]],
  );
});

test("reading platform security events writes a platform audit row", async () => {
  const response = await api("/api/admin/security-events?limit=5", "u1");
  assert.equal(response.status, 200);
  assert.equal(
    db.scalar(
      "SELECT COUNT(*) FROM decave_platform_audit WHERE actor_user_id='u1' AND action='platform.security_events_viewed'",
    ),
    1,
  );
  const forbidden = await api("/api/admin/security-events", "u2");
  assert.equal(forbidden.status, 403);
});

test("security-event IP tags prefer the dedicated key, else a domain-separated MFA-key subkey", async () => {
  const request = new Request("https://test.invalid/", { headers: { "CF-Connecting-IP": "203.0.113.9" } });
  const mfaKey = Buffer.alloc(32, 7).toString("base64");
  const dedicated = await securityEventIpHash({ SECURITY_IP_HASH_KEY: "dedicated-secret" }, request);
  const derived = await securityEventIpHash({ OWNER_MFA_ENCRYPTION_KEY: mfaKey }, request);
  const both = await securityEventIpHash(
    { SECURITY_IP_HASH_KEY: "dedicated-secret", OWNER_MFA_ENCRYPTION_KEY: mfaKey },
    request,
  );
  assert.match(dedicated, /^hmac:v1:[0-9a-f]{64}$/);
  assert.equal(both, dedicated);
  assert.match(derived, /^hmac:v1d:[0-9a-f]{64}$/);
  // The MFA key is never used directly as the HMAC key.
  const direct = await securityEventIpHash({ SECURITY_IP_HASH_KEY: mfaKey }, request);
  assert.notEqual(derived.slice("hmac:v1d:".length), direct.slice("hmac:v1:".length));
  assert.ok(!derived.includes("203.0.113.9"));
  assert.equal(await securityEventIpHash({}, request), "");
});

async function seedSquadRoom({ hubId, roomId, groupId, members }) {
  await ensureSquadFinderSchema(env);
  db.exec(
    `INSERT INTO decave_hubs(id,name,icon,owner_id,visibility,created_at,updated_at,icon_key)
     VALUES(?,?,'S','u1','private',?,?,?)`,
    hubId,
    `Squad ${hubId}`,
    ago(2),
    ago(2),
    `hub-media/${hubId}/icon`,
  );
  db.exec(
    "INSERT INTO decave_rooms(id,hub_id,name,type,created_at,updated_at) VALUES(?,?,'squad','text',?,?)",
    roomId,
    hubId,
    ago(2),
    ago(2),
  );
  db.exec(
    "INSERT INTO decave_group_chats(id,name,owner_user_id,created_at,updated_at) VALUES(?,'Squad','u1',?,?)",
    groupId,
    ago(2),
    ago(2),
  );
  for (const member of members) {
    db.exec("INSERT INTO decave_group_chat_members(group_id,user_id,added_at) VALUES(?,?,?)", groupId, member, ago(2));
    db.exec(
      "INSERT INTO decave_hub_members(hub_id,user_id,role,joined_at) VALUES(?,?,?,?)",
      hubId,
      member,
      member === "u1" ? "owner" : "member",
      ago(2),
    );
  }
  db.exec(
    "INSERT INTO decave_squad_rooms(group_id,hub_id,room_id,created_at) VALUES(?,?,?,?)",
    groupId,
    hubId,
    roomId,
    ago(2),
  );
  const attachment = `attachments/private/squad-${hubId}`;
  db.exec(
    `INSERT INTO decave_messages(id,room_id,hub_id,author_user_id,text,created_at,attachment_name,attachment_mime,attachment_size,attachment_key)
     VALUES(?,?,?,'u1','file',?,'f.png','image/png',1,?)`,
    `squad-message-${hubId}`,
    roomId,
    hubId,
    ago(2),
    attachment,
  );
  db.exec(
    "INSERT INTO decave_attachment_access(r2_key,kind,owner_user_id,peer_user_id,hub_id,room_id,created_at) VALUES(?,'channel','u1',NULL,?,?,?)",
    attachment,
    hubId,
    roomId,
    ago(2),
  );
  const keys = [attachment, `hub-media/${hubId}/icon`];
  for (const key of keys) await media.put(key, new Uint8Array([1]));
  return keys;
}

test("deleting a squad group chat deletes the squad Hub's R2 objects", async () => {
  const keys = await seedSquadRoom({ hubId: 20, roomId: 200, groupId: "squad-group-delete", members: ["u1", "u2"] });
  const response = await api("/api/groups/squad-group-delete", "u1", { method: "DELETE" });
  assert.equal(response.status, 200);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_hubs WHERE id=20"), 0);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_attachment_access WHERE hub_id=20"), 0);
  for (const key of keys) assert.equal(media.objects.has(key), false, `${key} removed from R2`);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_media_deletion_queue"), 0);
});

test("the last squad owner leaving deletes the Hub, the group and the Hub's R2 objects", async () => {
  const keys = await seedSquadRoom({ hubId: 30, roomId: 300, groupId: "squad-owner-leave", members: ["u1"] });
  const response = await api("/api/squad-finder/rooms/30/leave", "u1", { method: "POST" });
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_hubs WHERE id=30"), 0);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_group_chats WHERE id='squad-owner-leave'"), 0);
  for (const key of keys) assert.equal(media.objects.has(key), false, `${key} removed from R2`);
});

test("retention purges stale audit, device, presence and push records and orphaned uploads", async () => {
  await ensureCollaborationSchema(env);
  // Audit logs.
  db.exec(
    "INSERT INTO decave_platform_audit(id,actor_user_id,action,created_at) VALUES('pa-old','u1','x',?),('pa-new','u1','x',?)",
    ago(retention.PLATFORM_AUDIT_RETENTION_DAYS + 5),
    ago(retention.PLATFORM_AUDIT_RETENTION_DAYS - 5),
  );
  db.exec(
    "INSERT INTO decave_audit(id,hub_id,action,actor_user_id,created_at) VALUES('ha-old',1,'kick','u3',?),('ha-new',1,'kick','u3',?)",
    ago(retention.HUB_AUDIT_RETENTION_DAYS + 5),
    ago(retention.HUB_AUDIT_RETENTION_DAYS - 5),
  );
  // Devices and presence.
  db.exec(
    "INSERT INTO decave_known_devices(user_id,fingerprint,label,first_seen_at,last_seen_at) VALUES('u1','old','',?,?),('u1','new','',?,?)",
    ago(900),
    ago(retention.KNOWN_DEVICE_RETENTION_DAYS + 1),
    ago(900),
    ago(2),
  );
  db.exec(
    "INSERT OR REPLACE INTO decave_presence_activity(user_id,last_seen_at) VALUES('u1',?),('u3',?)",
    ago(retention.PRESENCE_ACTIVITY_RETENTION_DAYS + 1),
    ago(1),
  );
  // Push tokens and subscriptions.
  db.exec(
    `INSERT INTO decave_push_tokens(token,user_id,session_hash,platform,created_at) VALUES
       ('ExponentPushToken[revokedsession01]','u1','revoked-session','ios',?),
       ('ExponentPushToken[legacyoldtoken01]','u1',NULL,'ios',?),
       ('ExponentPushToken[legacynewtoken01]','u1',NULL,'ios',?),
       ('ExponentPushToken[livesession00001]','u1',?,'ios',?)`,
    ago(1),
    ago(retention.LEGACY_PUSH_TOKEN_RETENTION_DAYS + 1),
    ago(1),
    hash(tokenFor("u1")),
    ago(1),
  );
  db.exec(
    "INSERT INTO decave_push_subscriptions(user_id,hub_id,room_id,created_at) VALUES('u1',999,NULL,?),('u1',NULL,999,?),('u1',1,10,?)",
    ago(1),
    ago(1),
    ago(1),
  );
  // Uploads: attached, attached by a forum/payload reference, orphaned, fresh.
  const uploads = {
    attached: "attachments/private/orphan-test-attached",
    payload: "attachments/private/orphan-test-payload",
    orphan: "attachments/private/orphan-test-orphan",
    fresh: "attachments/private/orphan-test-fresh",
    dmAttached: "attachments/private/orphan-test-dm-attached",
    dmOrphan: "attachments/private/orphan-test-dm-orphan",
  };
  const old = ago(2);
  for (const [name, key] of Object.entries(uploads)) {
    const dm = name.startsWith("dm");
    db.exec(
      "INSERT INTO decave_attachment_access(r2_key,kind,owner_user_id,peer_user_id,hub_id,room_id,created_at) VALUES(?,?,?,?,?,?,?)",
      key,
      dm ? "dm" : "channel",
      "u1",
      dm ? "u2" : null,
      dm ? null : 1,
      dm ? null : 10,
      name === "fresh" ? new Date(now.getTime() - 60 * 60 * 1000).toISOString() : old,
    );
    await media.put(key, new Uint8Array([1]));
  }
  db.exec(
    "INSERT INTO decave_messages(id,room_id,hub_id,author_user_id,text,created_at,attachment_key) VALUES('orphan-attached',10,1,'u1','',?,?)",
    old,
    uploads.attached,
  );
  db.exec(
    "INSERT INTO decave_messages(id,room_id,hub_id,author_user_id,text,created_at) VALUES('orphan-payload',10,1,'u1',?,?)",
    JSON.stringify({ images: [{ url: `/uploads/${uploads.payload}` }] }),
    old,
  );
  db.exec(
    "INSERT INTO decave_direct_messages(id,from_user_id,to_user_id,text,created_at) VALUES('orphan-dm','u2','u1',?,?)",
    JSON.stringify({ url: `/uploads/${uploads.dmAttached}` }),
    old,
  );
  // Expired Steam link state (Worker-lazy table; migration 0067 also defines it).
  db.exec(
    "INSERT INTO decave_steam_link_states(state,user_id,expires_at,created_at) VALUES('expired-steam','u1',?,?)",
    ago(1),
    ago(2),
  );

  const result = await retention.pruneExpiredPrivacyData(env, now);
  assert.equal(result.orphanedUploadsQueued, 2);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_steam_link_states WHERE state='expired-steam'"), 0);
  assert.deepEqual(
    db.sqlite
      .prepare("SELECT id FROM decave_platform_audit WHERE id LIKE 'pa-%' ORDER BY id")
      .all()
      .map((row) => row.id),
    ["pa-new"],
  );
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_audit WHERE id='ha-old'"), 0);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_audit WHERE id='ha-new'"), 1);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_known_devices WHERE fingerprint='old'"), 0);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_known_devices WHERE fingerprint='new'"), 1);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_presence_activity WHERE user_id='u1'"), 0);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_presence_activity WHERE user_id='u3'"), 1);
  assert.deepEqual(
    db.sqlite
      .prepare("SELECT token FROM decave_push_tokens WHERE user_id='u1' ORDER BY token")
      .all()
      .map((row) => row.token),
    ["ExponentPushToken[legacynewtoken01]", "ExponentPushToken[livesession00001]"],
  );
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_push_subscriptions WHERE user_id='u1'"), 1);
  for (const name of ["attached", "payload", "fresh", "dmAttached"]) {
    assert.equal(media.objects.has(uploads[name]), true, `${name} upload is kept`);
    assert.equal(db.scalar("SELECT COUNT(*) FROM decave_attachment_access WHERE r2_key=?", uploads[name]), 1);
  }
  for (const name of ["orphan", "dmOrphan"]) {
    assert.equal(media.objects.has(uploads[name]), false, `${name} upload is deleted from R2`);
    assert.equal(db.scalar("SELECT COUNT(*) FROM decave_attachment_access WHERE r2_key=?", uploads[name]), 0);
  }
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_media_deletion_queue"), 0);
});

test("a failing Steam-state purge never rolls back the credential purge", async () => {
  db.exec(
    "INSERT INTO decave_auth_tokens(id,user_id,purpose,token_hash,expires_at,created_at) VALUES('expired-auth-gap','u1','reset_password','h',?,?)",
    ago(1),
    ago(2),
  );
  db.exec(
    "INSERT INTO decave_steam_link_states(state,user_id,expires_at,created_at) VALUES('expired-steam-2','u1',?,?)",
    ago(1),
    ago(2),
  );
  const failingDb = Object.create(db);
  failingDb.prepare = (sql) =>
    sql.includes("DELETE FROM decave_steam_link_states")
      ? { bind: () => ({ run: () => Promise.reject(new Error("no such table: decave_steam_link_states")) }) }
      : db.prepare(sql);
  await assert.rejects(retention.pruneExpiredPrivacyData({ ...env, DB: failingDb }, now), /steam-link-states/);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_auth_tokens WHERE id='expired-auth-gap'"), 0);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_steam_link_states WHERE state='expired-steam-2'"), 1);
  await retention.pruneExpiredPrivacyData(env, now);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_steam_link_states WHERE state='expired-steam-2'"), 0);
});

test("push token masking keeps only the token family and last four characters", () => {
  assert.equal(maskPushToken("ExpoPushToken[abcdefghijklWXYZ]"), "ExpoPushToken[************WXYZ]");
  assert.equal(maskPushToken("short"), "*****");
  assert.equal(maskPushToken(null), "****");
});
