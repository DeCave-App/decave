import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { register } from "node:module";
import { after, test } from "node:test";

register("../test-support/cloudflare-workers-test-loader.mjs", import.meta.url);
const { handleApi, HubRoom } = await import("../../worker/index.ts");
const { D1Mock, MediaMock } = await import("../test-support/worker-sqlite-test-fixture.mjs");

const db = new D1Mock();
const media = new MediaMock();
const now = "2099-01-01T00:00:00.000Z";
const token = "shared-attachment-delete-token";
const userId = "u1";
const tokenHash = createHash("sha256").update(token).digest("hex");
db.exec(
  `INSERT INTO decave_users
   (id,username,password_salt,password_hash,created_at,public_id,bio,status,status_text,activity_text,accent,
    email,email_normalized,email_verified_at,requires_email_verification,platform_role,
    suspended_at,suspended_until,suspension_reason,must_reset_password,deleted_at,delete_after,deletion_reason,erased_at)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  userId,
  "attachment-owner",
  "salt",
  "hash",
  now,
  "DC-0000000000000001",
  "",
  "online",
  "",
  "",
  "#7c5cff",
  "attachment-owner@example.test",
  "attachment-owner@example.test",
  now,
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
);
db.exec(
  "INSERT INTO decave_sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)",
  tokenHash,
  userId,
  "2100-01-01T00:00:00.000Z",
  now,
);
db.exec(
  `INSERT INTO decave_hubs(id,name,icon,owner_id,visibility,description,accent,category,slow_mode_seconds,created_at,updated_at)
   VALUES(1,'Hub','H',?,'private','','#123456','Gaming',0,?,?)`,
  userId,
  now,
  now,
);
db.exec("INSERT INTO decave_hub_members(hub_id,user_id,role,joined_at) VALUES(1,?,'owner',?)", userId, now);
for (const [id, kind] of [
  [10, "chat"],
  [12, "forum"],
]) {
  db.exec(
    `INSERT INTO decave_rooms
     (id,hub_id,name,type,category,position,private,created_at,updated_at,kind,forum_guidelines,
      forum_post_policy,forum_post_role_ids_json,forum_post_member_ids_json)
     VALUES(?,1,?,'text','General',?,0,?,?,?,'','everyone','[]','[]')`,
    id,
    `room-${id}`,
    id,
    now,
    now,
    kind,
  );
}

const env = {
  DB: db,
  MEDIA: media,
  ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
  EMAIL: { send: async () => ({ messageId: "test" }) },
  AUTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
  RECOVERY_RATE_LIMITER: { limit: async () => ({ success: true }) },
  HUB_ROOM: {
    idFromName: () => "global",
    get: () => ({ fetch: async () => Response.json({ success: true }) }),
  },
};
after(() => db.sqlite.close());

async function deleteMessage(roomId, messageId) {
  return handleApi(
    new Request(`https://test.invalid/api/channels/${roomId}/messages/${messageId}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    }),
    env,
  );
}

function insertMessage(id, roomId, { replyToId = null, attachmentKey = null } = {}) {
  db.exec(
    `INSERT INTO decave_messages
     (id,room_id,hub_id,author_user_id,text,created_at,reply_to_id,attachment_key)
     VALUES(?,?,1,?,'message',?,?,?)`,
    id,
    roomId,
    userId,
    now,
    replyToId,
    attachmentKey,
  );
}

function linkAttachment(key, roomId) {
  db.exec(
    `INSERT INTO decave_attachment_access(r2_key,kind,owner_user_id,peer_user_id,hub_id,room_id,created_at)
     VALUES(?,'channel',?,NULL,1,?,?)`,
    key,
    userId,
    roomId,
    now,
  );
}

test("deleting one retried message keeps a shared attachment until its final reference is deleted", async () => {
  const key = "attachments/private/retried-upload";
  await media.put(key, new Uint8Array([1, 2, 3]));
  linkAttachment(key, 10);
  insertMessage("retry-original", 10, { attachmentKey: key });
  insertMessage("retry-duplicate", 10, { attachmentKey: key });

  const firstDelete = await deleteMessage(10, "retry-original");
  assert.equal(firstDelete.status, 200);
  assert.ok(await media.get(key), "the surviving retry still needs the R2 object");
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_attachment_access WHERE r2_key=?", key), 1);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_media_deletion_queue WHERE object_key=?", key), 0);

  const finalDelete = await deleteMessage(10, "retry-duplicate");
  assert.equal(finalDelete.status, 200);
  assert.equal(await media.get(key), null);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_attachment_access WHERE r2_key=?", key), 0);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_media_deletion_queue WHERE object_key=?", key), 0);
});

test("deleting a forum thread keeps an attachment used by a message outside the thread", async () => {
  const key = "attachments/private/forum-retry";
  await media.put(key, new Uint8Array([4, 5, 6]));
  linkAttachment(key, 12);
  insertMessage("forum-post", 12, { attachmentKey: key });
  insertMessage("forum-reply", 12, { replyToId: "forum-post", attachmentKey: key });
  insertMessage("forum-survivor", 12, { attachmentKey: key });

  const response = await deleteMessage(12, "forum-post");
  assert.equal(response.status, 200);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_messages WHERE id='forum-survivor'"), 1);
  assert.ok(await media.get(key), "the surviving message still needs the R2 object");
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_attachment_access WHERE r2_key=?", key), 1);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_media_deletion_queue WHERE object_key=?", key), 0);
});

test("channel send rejects an attachment if deletion wins between ownership check and insert", async () => {
  const key = "attachments/private/last-reference-race";
  await media.put(key, new Uint8Array([7, 8, 9]));
  linkAttachment(key, 10);
  insertMessage("race-last-reference", 10, { attachmentKey: key });

  let deletionRan = false;
  const racingDb = {
    prepare(sql) {
      const statement = db.prepare(sql);
      if (!deletionRan && sql.includes("SELECT r2_key") && sql.includes("FROM decave_attachment_access")) {
        const first = statement.first.bind(statement);
        statement.first = async () => {
          const result = await first();
          deletionRan = true;
          const deleted = await deleteMessage(10, "race-last-reference");
          assert.equal(deleted.status, 200);
          return result;
        };
      }
      return statement;
    },
    batch: db.batch.bind(db),
  };
  const socket = {
    attachment: {
      connectionId: randomUUID(),
      peerAddress: "test",
      authDeadlineAt: 0,
      client: "web",
      userId,
      sessionHash: tokenHash,
      username: "attachment-owner",
      serverId: 1,
      channelId: 10,
      voiceChannelId: null,
      voiceMuted: false,
      voiceDeafened: false,
      voiceServerMuted: false,
      voiceServerDeafened: false,
      screenSharing: false,
      allowStreamPreview: true,
      cameraSharing: false,
      dmCallId: null,
      dmCallPeerUserId: null,
      dmCallPeerConnectionId: null,
      dmCallIncoming: false,
      dmCallAccepted: false,
      dmCallVideo: false,
      identifiedAt: Date.now(),
      identifyFailures: 0,
      rateLimitViolations: 0,
      lastPresenceTouchAt: 0,
    },
    sent: [],
    serializeAttachment(value) {
      this.attachment = value;
    },
    deserializeAttachment() {
      return this.attachment;
    },
    send(value) {
      this.sent.push(JSON.parse(value));
    },
    close() {},
  };
  const ctx = {
    getWebSockets: () => [socket],
    acceptWebSocket() {},
    storage: { async setAlarm() {}, async deleteAlarm() {}, async get() {}, async put() {} },
  };
  const room = new HubRoom(ctx, { ...env, DB: racingDb, HUB_ROOM: undefined });
  await room.webSocketMessage(
    socket,
    JSON.stringify({
      type: "CHAT_MESSAGE",
      channelId: 10,
      text: "retry after deletion",
      attachment: { url: `/uploads/${key}` },
    }),
  );

  assert.equal(deletionRan, true);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_messages WHERE text='retry after deletion'"), 0);
  assert.equal(socket.sent.at(-1).type, "ERROR");
  assert.equal(await media.get(key), null);
});
