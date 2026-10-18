import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { register } from "node:module";

// Load the real Worker module. The only shim is the Cloudflare DurableObject
// base class; every handler and SQL statement below runs from production code.
register("../test-support/cloudflare-workers-test-loader.mjs", import.meta.url);
const { handleApi, HubRoom } = await import("../../worker/index.ts");

import { D1Mock, MediaMock } from "../test-support/worker-sqlite-test-fixture.mjs";

const tokens = new Map();
const userIds = (count) => Array.from({ length: count }, (_, index) => `u${index + 1}`);
const publicIds = new Map();
function tokenFor(userId) {
  if (!tokens.has(userId)) tokens.set(userId, `runtime-token-${userId}`);
  return tokens.get(userId);
}
function hashToken(value) {
  return createHash("sha256").update(value).digest("hex");
}

function seedDatabase(db) {
  const now = "2099-01-01T00:00:00.000Z";
  for (const [index, userId] of userIds(30).entries()) {
    const publicId = `DC-${String(index + 1).padStart(16, "0")}`;
    publicIds.set(userId, publicId);
    db.exec(
      `INSERT INTO decave_users
       (id,username,password_salt,password_hash,created_at,public_id,bio,status,status_text,activity_text,accent,
        email,email_normalized,email_verified_at,requires_email_verification,platform_role,
        suspended_at,suspended_until,suspension_reason,must_reset_password,deleted_at,delete_after,deletion_reason,erased_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      userId,
      `user-${index + 1}`,
      "salt",
      "hash",
      now,
      publicId,
      "",
      "online",
      "",
      "",
      "#7c5cff",
      `${userId}@example.test`,
      `${userId}@example.test`,
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
      hashToken(tokenFor(userId)),
      userId,
      "2100-01-01T00:00:00.000Z",
      now,
    );
  }
  db.exec(
    `INSERT INTO decave_hubs(id,name,icon,owner_id,visibility,description,accent,category,slow_mode_seconds,icon_key,banner_key,created_at,updated_at,theme,use_banner_background)
     VALUES(1,'Test Hub','T','u1','private','original description','#123456','Gaming',0,'old-icon','old-banner',?,?, 'forest',1)`,
    now,
    now,
  );
  for (const userId of userIds(30))
    db.exec(
      "INSERT INTO decave_hub_members(hub_id,user_id,role,joined_at) VALUES(1,?,?,?)",
      userId,
      userId === "u1" ? "owner" : "member",
      now,
    );
  for (const [id, name, type] of [
    [10, "general", "text"],
    [11, "voice", "voice"],
    [12, "other", "text"],
  ]) {
    db.exec(
      `INSERT INTO decave_rooms
       (id,hub_id,name,type,category,position,private,created_at,updated_at,kind,forum_guidelines,forum_post_policy,forum_post_role_ids_json,forum_post_member_ids_json)
       VALUES(?,?,?,?,?,0,0,?,?, 'chat', '', 'everyone', '[]', '[]')`,
      id,
      1,
      name,
      type,
      "General",
      now,
      now,
    );
  }
  for (const userId of userIds(30).slice(1))
    db.exec("INSERT INTO decave_friendships(user_a,user_b,created_at) VALUES('u1',?,?)", userId, now);
  db.exec(
    "INSERT INTO decave_direct_messages(id,from_user_id,to_user_id,text,created_at) VALUES('dm-1','u1','u2','hello',?)",
    now,
  );
  db.exec("INSERT INTO decave_user_blocks(blocker_user_id,blocked_user_id,created_at) VALUES('u2','u1',?)", now);
  db.exec(
    "INSERT INTO decave_messages(id,room_id,hub_id,author_user_id,text,created_at) VALUES('same-room',10,1,'u1','base',?)",
    now,
  );
  db.exec(
    "INSERT INTO decave_messages(id,room_id,hub_id,author_user_id,text,created_at) VALUES('other-room',12,1,'u1','wrong channel',?)",
    now,
  );
}

const db = new D1Mock();
seedDatabase(db);
const media = new MediaMock();
const broadcasts = [];
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
      fetch: async (request) => {
        const url = new URL(request.url);
        if (url.pathname === "/internal/broadcast") {
          broadcasts.push(await request.clone().json());
          return Response.json({ success: true });
        }
        if (url.pathname === "/internal/online-users" || url.pathname === "/internal/count")
          return Response.json({ userIds: [], count: 0 });
        return new Response("ok");
      },
    }),
  },
};

async function api(pathname, userId, { method = "GET", body, headers = {} } = {}) {
  const requestHeaders = new Headers({ authorization: `Bearer ${tokenFor(userId)}`, ...headers });
  let requestBody;
  if (body instanceof Uint8Array || body instanceof ArrayBuffer) requestBody = body;
  else if (body !== undefined) {
    requestBody = JSON.stringify(body);
    requestHeaders.set("content-type", "application/json");
  }
  const response = await handleApi(
    new Request(`https://test.invalid${pathname}`, { method, headers: requestHeaders, body: requestBody }),
    env,
  );
  let data = null;
  try {
    data = await response.clone().json();
  } catch {}
  return { response, data };
}

async function apiRequest(request) {
  const response = await handleApi(request, env);
  let data = null;
  try {
    data = await response.clone().json();
  } catch {}
  return { response, data };
}

function streamRequest(pathname, userId, stream, headers = {}) {
  return new Request(`https://test.invalid${pathname}`, {
    method: "POST",
    headers: { authorization: `Bearer ${tokenFor(userId)}`, ...headers },
    body: stream,
    duplex: "half",
  });
}

function completeSocketState(userId, overrides = {}) {
  return {
    connectionId: randomUUID(),
    peerAddress: "test",
    authDeadlineAt: 0,
    client: "web",
    userId,
    sessionHash: hashToken(tokenFor(userId)),
    username: `user-${userId.slice(1)}`,
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
    ...overrides,
  };
}
class FakeSocket {
  constructor(state) {
    this.attachment = state;
    this.sent = [];
    this.closed = [];
  }
  serializeAttachment(value) {
    this.attachment = value;
  }
  deserializeAttachment() {
    return this.attachment;
  }
  send(value) {
    this.sent.push(JSON.parse(value));
  }
  close(code, reason) {
    this.closed.push({ code, reason });
  }
}
function roomForSocket(socket) {
  const ctx = {
    getWebSockets: () => [socket],
    acceptWebSocket: () => {},
    storage: {
      async setAlarm() {},
      async deleteAlarm() {},
      async get() {
        return undefined;
      },
      async put() {},
    },
  };
  return new HubRoom(ctx, env);
}

test("Hub settings PATCH preserves omitted theme and banner values at runtime", async () => {
  const result = await api("/api/servers/1/settings", "u1", { method: "PATCH", body: { description: "updated" } });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.theme, "forest");
  assert.equal(result.data.useBannerBackground, true);
  const stored = db.sqlite.prepare("SELECT description,theme,use_banner_background FROM decave_hubs WHERE id=1").get();
  assert.deepEqual({ ...stored }, { description: "updated", theme: "forest", use_banner_background: 1 });
});

test("Discord import preview/apply/rollback stays inside the reviewed plan and preserves later state", async () => {
  db.exec(
    "INSERT INTO decave_custom_roles(id,hub_id,name,color,permissions_json,position,created_at) VALUES('runtime-existing-role',1,'Runtime Existing Role','#123abc','[]',0,'2099-01-01T00:00:00.000Z')",
  );
  const beforeRooms = db.scalar("SELECT COUNT(*) FROM decave_rooms WHERE hub_id=1");
  const beforeRoles = db.scalar("SELECT COUNT(*) FROM decave_custom_roles WHERE hub_id=1");
  const source = {
    code: "runtime-import",
    name: "Runtime Import",
    description: "worker route test",
    rooms: [
      { name: "runtime-preview-room", type: "text", category: "Runtime", private: true },
      { name: "general", type: "text", category: "General" },
    ],
    roles: [
      { name: "Runtime New Role", color: "#abcdef" },
      { name: "Runtime Existing Role", color: "#123abc" },
    ],
    unsupported: ["stage channel"],
  };

  db.exec("DELETE FROM decave_hub_members WHERE hub_id=1 AND user_id='u3'");
  const nonMember = await api("/api/servers/1/import/preview", "u3", { method: "POST", body: source });
  assert.equal(nonMember.response.status, 403);
  db.exec(
    "INSERT INTO decave_hub_members(hub_id,user_id,role,joined_at) VALUES(1,'u3','member','2099-01-01T00:00:00.000Z')",
  );
  const denied = await api("/api/servers/1/import/preview", "u2", { method: "POST", body: source });
  assert.equal(denied.response.status, 403);
  const preview = await api("/api/servers/1/import/preview", "u1", { method: "POST", body: source });
  assert.equal(preview.response.status, 200);
  assert.equal(preview.data.create.rooms.length, 1);
  assert.equal(preview.data.create.roles.length, 1);
  assert.equal(preview.data.conflicts.length, 2);
  assert.equal(preview.data.summary.unsupported, 1);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_rooms WHERE hub_id=1"), beforeRooms);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_custom_roles WHERE hub_id=1"), beforeRoles);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_hub_imports WHERE hub_id=1"), 0);

  const conflictRoom = await api("/api/servers/1/channels", "u1", {
    method: "POST",
    body: { name: "runtime-preview-room", type: "text", category: "Runtime" },
  });
  assert.equal(conflictRoom.response.status, 201);
  const stale = await api("/api/servers/1/import/apply", "u1", {
    method: "POST",
    body: { discordImport: source, fingerprint: preview.data.fingerprint },
  });
  assert.equal(stale.response.status, 409);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_hub_imports WHERE hub_id=1"), 0);
  const deletedConflict = await api(`/api/channels/${conflictRoom.data.id}`, "u1", { method: "DELETE" });
  assert.equal(deletedConflict.response.status, 200);

  const reviewedSource = {
    code: "runtime-reviewed-import",
    name: "Runtime Reviewed Import",
    rooms: [
      { name: "runtime-clean-room", type: "text", category: "Runtime" },
      { name: "runtime-content-room", type: "text", category: "Runtime" },
      { name: "runtime-assigned-room", type: "voice", category: "Runtime" },
    ],
    roles: [
      { name: "Runtime Clean Role", color: "#112233" },
      { name: "Runtime Assigned Role", color: "#334455" },
    ],
    unsupported: [],
  };
  const reviewed = await api("/api/servers/1/import/preview", "u1", { method: "POST", body: reviewedSource });
  assert.equal(reviewed.response.status, 200);
  const applied = await api("/api/servers/1/import/apply", "u1", {
    method: "POST",
    body: { discordImport: reviewedSource, fingerprint: reviewed.data.fingerprint },
  });
  assert.equal(applied.response.status, 201);
  assert.equal(applied.data.createdRooms.length, 3);
  assert.equal(applied.data.createdRoles.length, 2);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_hub_import_rooms WHERE import_id=?", applied.data.importId), 3);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_hub_import_roles WHERE import_id=?", applied.data.importId), 2);

  // Replaying the same source is safe: current-state conflict checks produce
  // a no-op import and never duplicate the reviewed rooms or roles.
  const replay = await api("/api/servers/1/import/apply", "u1", {
    method: "POST",
    body: { discordImport: reviewedSource },
  });
  assert.equal(replay.response.status, 201);
  assert.deepEqual(replay.data.createdRooms, []);
  assert.deepEqual(replay.data.createdRoles, []);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_rooms WHERE hub_id=1 AND name LIKE 'runtime-%-room'"), 3);
  assert.equal(
    db.scalar(
      "SELECT COUNT(*) FROM decave_custom_roles WHERE hub_id=1 AND name IN ('Runtime Clean Role','Runtime Assigned Role')",
    ),
    2,
  );

  const contentRoom = applied.data.createdRooms.find((room) => room.name === "runtime-content-room");
  const assignedRoom = applied.data.createdRooms.find((room) => room.name === "runtime-assigned-room");
  const cleanRoom = applied.data.createdRooms.find((room) => room.name === "runtime-clean-room");
  const assignedRole = applied.data.createdRoles.find((role) => role.name === "Runtime Assigned Role");
  const cleanRole = applied.data.createdRoles.find((role) => role.name === "Runtime Clean Role");
  assert.ok(contentRoom && assignedRoom && cleanRoom && assignedRole && cleanRole);
  db.exec(
    "INSERT INTO decave_messages(id,room_id,hub_id,author_user_id,text,created_at) VALUES(?,?,?,?,?,?)",
    "runtime-import-message",
    contentRoom.id,
    1,
    "u2",
    "later content",
    "2099-01-02T00:00:00.000Z",
  );
  db.exec(
    "UPDATE decave_rooms SET name=?,updated_at=? WHERE id=?",
    "runtime-assigned-room-edited",
    "2099-01-02T00:00:00.000Z",
    assignedRoom.id,
  );
  db.exec(
    "INSERT INTO decave_room_members(room_id,user_id,granted_by,created_at) VALUES(?,?,?,?)",
    assignedRoom.id,
    "u2",
    "u1",
    "2099-01-02T00:00:00.000Z",
  );
  db.exec("INSERT INTO decave_member_roles(hub_id,user_id,role_id) VALUES(?,?,?)", 1, "u2", assignedRole.id);
  db.exec("UPDATE decave_custom_roles SET color=? WHERE id=?", "#fedcba", assignedRole.id);

  // The rollback payload deliberately points at unrelated existing records.
  // The server must use its import provenance and ignore these client IDs.
  const arbitraryImportId = randomUUID();
  db.exec(
    "INSERT INTO decave_hubs(id,name,icon,owner_id,visibility,created_at,updated_at) VALUES(900,'Boundary Hub','B','u1','private','2099-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z')",
  );
  db.exec(
    "INSERT INTO decave_hub_members(hub_id,user_id,role,joined_at) VALUES(900,'u1','owner','2099-01-01T00:00:00.000Z')",
  );
  const crossHub = await api(`/api/servers/900/import/${encodeURIComponent(applied.data.importId)}/rollback`, "u1", {
    method: "POST",
    body: {},
  });
  assert.equal(crossHub.response.status, 404);
  db.exec("DELETE FROM decave_hubs WHERE id=900");
  const arbitrary = await api(`/api/servers/1/import/${encodeURIComponent(arbitraryImportId)}/rollback`, "u1", {
    method: "POST",
    body: {
      createdRooms: [{ id: 11, name: "voice", type: "voice", category: "General" }],
      createdRoles: [{ id: "runtime-existing-role", name: "Runtime Existing Role", color: "#123abc" }],
    },
  });
  assert.equal(arbitrary.response.status, 404);
  assert.ok(db.sqlite.prepare("SELECT 1 FROM decave_rooms WHERE id=11").get());
  assert.ok(db.sqlite.prepare("SELECT 1 FROM decave_custom_roles WHERE id='runtime-existing-role'").get());

  const rolledBack = await api(`/api/servers/1/import/${encodeURIComponent(applied.data.importId)}/rollback`, "u1", {
    method: "POST",
    body: {
      createdRooms: [{ id: 11, name: "voice", type: "voice", category: "General" }],
      createdRoles: [{ id: "runtime-existing-role", name: "Runtime Existing Role", color: "#123abc" }],
    },
  });
  assert.equal(rolledBack.response.status, 200);
  assert.deepEqual(rolledBack.data.deletedRoomIds, [cleanRoom.id]);
  assert.deepEqual(rolledBack.data.deletedRoleIds, [cleanRole.id]);
  assert.ok(rolledBack.data.retainedRoomIds.includes(contentRoom.id));
  assert.ok(rolledBack.data.retainedRoomIds.includes(assignedRoom.id));
  assert.ok(rolledBack.data.retainedRoleIds.includes(assignedRole.id));
  assert.equal(db.sqlite.prepare("SELECT 1 FROM decave_rooms WHERE id=?").get(cleanRoom.id), undefined);
  assert.ok(db.sqlite.prepare("SELECT name FROM decave_rooms WHERE id=?").get(contentRoom.id));
  assert.equal(
    db.sqlite.prepare("SELECT name FROM decave_rooms WHERE id=?").get(assignedRoom.id).name,
    "runtime-assigned-room-edited",
  );
  assert.equal(
    db.sqlite.prepare("SELECT color FROM decave_custom_roles WHERE id=?").get(assignedRole.id).color,
    "#fedcba",
  );
  assert.ok(db.sqlite.prepare("SELECT 1 FROM decave_rooms WHERE id=11").get());
  assert.ok(db.sqlite.prepare("SELECT 1 FROM decave_custom_roles WHERE id='runtime-existing-role'").get());
  assert.ok(
    db.sqlite.prepare("SELECT rolled_back_at FROM decave_hub_imports WHERE id=?").get(applied.data.importId)
      .rolled_back_at,
  );

  const repeatedRollback = await api(
    `/api/servers/1/import/${encodeURIComponent(applied.data.importId)}/rollback`,
    "u1",
    { method: "POST", body: {} },
  );
  assert.equal(repeatedRollback.response.status, 200);
  assert.match(repeatedRollback.data.message, /already rolled back/i);
});

test("DM reactions are denied in either block direction, then work after unblock", async () => {
  const blocked = await api("/api/dms/messages/dm-1/reactions", "u1", { method: "POST", body: { emoji: "👍" } });
  assert.equal(blocked.response.status, 403);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_dm_reactions WHERE message_id='dm-1'"), 0);
  db.exec("DELETE FROM decave_user_blocks WHERE blocker_user_id='u2' AND blocked_user_id='u1'");
  const allowed = await api("/api/dms/messages/dm-1/reactions", "u1", { method: "POST", body: { emoji: "👍" } });
  assert.equal(allowed.response.status, 200);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_dm_reactions WHERE message_id='dm-1'"), 1);
});

test("JSON and upload bodies enforce streaming limits and preserve malformed/valid controls", async () => {
  const maximum = 1024 * 1024;
  const overflow = new Uint8Array(maximum + 1);
  const chunkedState = { cancelled: false };
  const chunked = new ReadableStream({
    pull(controller) {
      controller.enqueue(overflow);
    },
    cancel() {
      chunkedState.cancelled = true;
    },
  });
  const tooLargeChunked = await apiRequest(streamRequest("/api/servers/1/import/preview", "u1", chunked));
  assert.equal(tooLargeChunked.response.status, 413);
  assert.equal(chunkedState.cancelled, true, "chunked JSON overflow cancels the unread request stream");

  const lyingLengthState = { cancelled: false };
  const lyingLength = new ReadableStream({
    pull(controller) {
      controller.enqueue(overflow);
    },
    cancel() {
      lyingLengthState.cancelled = true;
    },
  });
  const tooLargeLyingLength = await apiRequest(
    streamRequest("/api/servers/1/import/preview", "u1", lyingLength, {
      "content-length": "1",
      "content-type": "application/json",
    }),
  );
  assert.equal(
    tooLargeLyingLength.response.status,
    413,
    "the streamed byte count overrides an understated Content-Length",
  );
  assert.equal(lyingLengthState.cancelled, true);

  const malformed = await apiRequest(
    new Request(`https://test.invalid/api/dms/${publicIds.get("u2")}`, {
      method: "POST",
      headers: { authorization: `Bearer ${tokenFor("u1")}`, "content-type": "application/json" },
      body: "{",
    }),
  );
  assert.equal(malformed.response.status, 400, "malformed JSON remains a client error, not a 413 or 500");

  const valid = await api("/api/servers/1/import/preview", "u1", {
    method: "POST",
    body: {
      code: "bounded-import",
      name: "Bounded Import",
      rooms: [{ name: "bounded-preview-room", type: "text" }],
      roles: [],
    },
  });
  assert.equal(valid.response.status, 200, "a legitimate import preview stays below the request limit");

  const uploadChunk = new Uint8Array(1024 * 1024);
  const uploadState = { cancelled: false, chunks: 0 };
  const upload = new ReadableStream({
    pull(controller) {
      uploadState.chunks += 1;
      controller.enqueue(uploadChunk);
    },
    cancel() {
      uploadState.cancelled = true;
    },
  });
  const oversizedUpload = await apiRequest(
    streamRequest(`/api/dms/${publicIds.get("u2")}/attachments`, "u1", upload, {
      "content-type": "application/octet-stream",
    }),
  );
  assert.equal(oversizedUpload.response.status, 413);
  assert.equal(uploadState.cancelled, true, "oversized raw uploads cancel instead of being fully buffered");
  assert.ok(
    uploadState.chunks <= 32,
    `the upload reader stops near the 25 MiB limit (read ${uploadState.chunks} chunks)`,
  );
});

test("suspended hub-bot creators cannot post any token action, while disabled tokens remain unauthorized", async () => {
  const token = "a".repeat(64);
  const createdAt = "2099-01-01T00:00:00.000Z";
  db.exec(
    `INSERT INTO decave_hub_bots
     (id,hub_id,name,token_hash,created_by,capabilities,allowed_room_ids,enabled,created_at)
     VALUES('runtime-token-bot',1,'Runtime Token Bot',?,'u1',?,?,1,?)`,
    hashToken(token),
    JSON.stringify(["send_messages", "create_events", "create_polls"]),
    JSON.stringify([10]),
    createdAt,
  );
  const botRequest = (body) =>
    new Request("https://test.invalid/api/bots/messages", {
      method: "POST",
      headers: { authorization: `Bot ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const active = await apiRequest(botRequest({ roomId: 10, text: "active bot message" }));
  assert.equal(active.response.status, 201, "an active creator can use the configured bot token");

  db.exec("UPDATE decave_users SET suspended_at=?,suspension_reason='test' WHERE id='u1'", createdAt);
  const before = db.scalar("SELECT COUNT(*) FROM decave_messages WHERE room_id=10");
  const actions = [
    { roomId: 10, action: "send_message", text: "blocked message" },
    {
      roomId: 10,
      action: "create_event",
      text: `__DECAVE_EVENT__${JSON.stringify({ title: "Blocked event", startAt: "2099-01-02T00:00:00.000Z" })}`,
    },
    {
      roomId: 10,
      action: "create_poll",
      text: `__DECAVE_POLL__${JSON.stringify({ question: "Blocked poll", options: ["A", "B"] })}`,
    },
  ];
  for (const action of actions) {
    const denied = await apiRequest(botRequest(action));
    assert.equal(denied.response.status, 403);
    assert.match(denied.data.error, /suspended/i);
  }
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_messages WHERE room_id=10"), before);

  db.exec("UPDATE decave_hub_bots SET enabled=0 WHERE id='runtime-token-bot'");
  const disabled = await apiRequest(botRequest({ roomId: 10, text: "disabled bot message" }));
  assert.equal(
    disabled.response.status,
    401,
    "disabled-token authorization remains higher priority than creator status",
  );
  db.exec("UPDATE decave_users SET suspended_at=NULL,suspension_reason='' WHERE id='u1'");
});

test("DM edits require the same friendship and block checks as sends, but sender deletion remains available", async () => {
  db.exec(
    "INSERT INTO decave_user_blocks(blocker_user_id,blocked_user_id,created_at) VALUES('u2','u1','2099-01-01T00:00:00.000Z')",
  );
  const blockedEdit = await api("/api/dms/messages/dm-1", "u1", { method: "PATCH", body: { text: "blocked edit" } });
  assert.equal(blockedEdit.response.status, 403);
  assert.equal(db.scalar("SELECT text FROM decave_direct_messages WHERE id='dm-1'"), "hello");

  db.exec("DELETE FROM decave_user_blocks WHERE blocker_user_id='u2' AND blocked_user_id='u1'");
  db.exec("DELETE FROM decave_friendships WHERE user_a='u1' AND user_b='u2'");
  const unfriendEdit = await api("/api/dms/messages/dm-1", "u1", {
    method: "PATCH",
    body: { text: "unfriended edit" },
  });
  assert.equal(
    unfriendEdit.response.status,
    403,
    "message ownership does not preserve edit access after a friendship ends",
  );
  db.exec("INSERT INTO decave_friendships(user_a,user_b,created_at) VALUES('u1','u2','2099-01-01T00:00:00.000Z')");
  const friendedEdit = await api("/api/dms/messages/dm-1", "u1", {
    method: "PATCH",
    body: { text: "edited while friends" },
  });
  assert.equal(friendedEdit.response.status, 200, "a current friend can still edit their own message");
  assert.equal(db.scalar("SELECT text FROM decave_direct_messages WHERE id='dm-1'"), "edited while friends");

  db.exec(
    "INSERT INTO decave_user_blocks(blocker_user_id,blocked_user_id,created_at) VALUES('u2','u1','2099-01-01T00:00:00.000Z')",
  );
  const deleted = await api("/api/dms/messages/dm-1", "u1", { method: "DELETE" });
  assert.equal(deleted.response.status, 200, "the original sender can still remove a message after a block");
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_direct_messages WHERE id='dm-1'"), 0);
  db.exec("DELETE FROM decave_user_blocks WHERE blocker_user_id='u2' AND blocked_user_id='u1'");
});

test("concurrent group additions leave exactly twenty members and no duplicate seat", async () => {
  const created = await api("/api/groups", "u1", {
    method: "POST",
    body: { memberIds: [publicIds.get("u2"), publicIds.get("u3")] },
  });
  assert.equal(created.response.status, 201);
  const groupId = created.data.group.id;
  for (const userId of userIds(30).slice(3, 20)) {
    const added = await api(`/api/groups/${encodeURIComponent(groupId)}/members`, "u1", {
      method: "POST",
      body: { userId: publicIds.get(userId) },
    });
    assert.equal(added.response.status, 200, `adding ${userId} should succeed`);
  }
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_group_chat_members WHERE group_id=?", groupId), 20);
  const [first, second] = await Promise.all([
    api(`/api/groups/${encodeURIComponent(groupId)}/members`, "u1", {
      method: "POST",
      body: { userId: publicIds.get("u21") },
    }),
    api(`/api/groups/${encodeURIComponent(groupId)}/members`, "u1", {
      method: "POST",
      body: { userId: publicIds.get("u22") },
    }),
  ]);
  assert.equal([first.response.status, second.response.status].filter((status) => status === 200).length, 0);
  assert.equal([first.response.status, second.response.status].filter((status) => status === 400).length, 2);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_group_chat_members WHERE group_id=?", groupId), 20);
});

test("concurrent squad joins enforce the four member cap and create one room", async () => {
  const criteria = { game: "PUBG", platform: "PC", language: "English", region: "Europe", microphoneRequired: false };
  for (const userId of ["u23", "u24", "u25", "u26", "u27"]) {
    const started = await api("/api/squad-finder", userId, { method: "POST", body: criteria });
    assert.equal(started.response.status, 200);
  }
  const target = db.sqlite.prepare("SELECT id FROM decave_squad_searches WHERE user_id='u23'").get();
  assert.ok(target?.id);
  const firstJoins = await Promise.all(
    ["u24", "u25"].map((userId) =>
      api(`/api/squad-finder/${encodeURIComponent(target.id)}/join`, userId, { method: "POST" }),
    ),
  );
  assert.deepEqual(firstJoins.map(({ response }) => response.status).sort(), [201, 201]);
  const lastJoins = await Promise.all(
    ["u26", "u27"].map((userId) =>
      api(`/api/squad-finder/${encodeURIComponent(target.id)}/join`, userId, { method: "POST" }),
    ),
  );
  assert.deepEqual(lastJoins.map(({ response }) => response.status).sort(), [201, 409]);
  const groupId = db.sqlite.prepare("SELECT group_id FROM decave_squad_searches WHERE user_id='u23'").get().group_id;
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_group_chat_members WHERE group_id=?", groupId), 4);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_squad_rooms WHERE group_id=?", groupId), 1);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_squad_rooms"), 1);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_hubs WHERE id>1"), 1);
  const failedUser = lastJoins.find(({ response }) => response.status === 409) === lastJoins[0] ? "u26" : "u27";
  assert.equal(db.scalar("SELECT group_id FROM decave_squad_searches WHERE user_id=?", failedUser), null);
});

test("revocation clears voice state before notification and rejects a subsequent rejoin", async () => {
  const socket = new FakeSocket(completeSocketState("u1", { serverId: 1, channelId: 10, voiceChannelId: 11 }));
  const room = roomForSocket(socket);
  db.exec("DELETE FROM decave_hub_members WHERE hub_id=1 AND user_id='u1'");
  const response = await room.fetch(
    new Request("https://internal.decave/internal/broadcast", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: { type: "ACCESS_REVOKED", serverId: 1 }, filter: { userIds: ["u1"] } }),
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(socket.attachment.voiceChannelId, null);
  assert.equal(socket.attachment.serverId, 0);
  assert.equal(socket.attachment.channelId, 0);
  assert.equal(socket.sent.at(-1).type, "ACCESS_REVOKED");
  const before = socket.sent.length;
  await room.webSocketMessage(socket, JSON.stringify({ type: "VOICE_JOIN", channelId: 11 }));
  assert.equal(socket.attachment.voiceChannelId, null);
  assert.equal(socket.sent.length, before + 1);
  assert.equal(socket.sent.at(-1).type, "VOICE_ERROR");
});

test("uploaded attachment can be sent and replies stay within the current channel", async () => {
  const upload = await api("/api/channels/10/attachments", "u2", {
    method: "POST",
    body: new Uint8Array([1, 2, 3]),
    headers: { "x-file-name": "proof.txt", "x-file-type": "text/plain" },
  });
  assert.equal(upload.response.status, 200);
  assert.equal(upload.data.attachment.name, "proof.txt");
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_attachment_access WHERE room_id=10 AND owner_user_id='u2'"), 1);
  const socket = new FakeSocket(completeSocketState("u2"));
  const room = roomForSocket(socket);
  await room.webSocketMessage(
    socket,
    JSON.stringify({
      type: "CHAT_MESSAGE",
      channelId: 10,
      text: "attachment reply",
      replyToId: "same-room",
      attachment: upload.data.attachment,
    }),
  );
  assert.equal(
    db.scalar(
      "SELECT COUNT(*) FROM decave_messages WHERE author_user_id='u2' AND room_id=10 AND reply_to_id='same-room'",
    ),
    1,
  );
  const before = db.scalar("SELECT COUNT(*) FROM decave_messages");
  await room.webSocketMessage(
    socket,
    JSON.stringify({ type: "CHAT_MESSAGE", channelId: 10, text: "cross-channel", replyToId: "other-room" }),
  );
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_messages"), before);
  assert.equal(socket.sent.at(-1).type, "ERROR");
  assert.match(socket.sent.at(-1).message, /not found in this room/);
  const attacker = new FakeSocket(completeSocketState("u3"));
  await roomForSocket(attacker).webSocketMessage(
    attacker,
    JSON.stringify({
      type: "CHAT_MESSAGE",
      channelId: 10,
      text: "stolen attachment",
      attachment: upload.data.attachment,
    }),
  );
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_messages"), before);
  assert.equal(attacker.sent.at(-1).type, "ERROR");
  assert.match(attacker.sent.at(-1).message, /not owned by you/);
});

test("deleting a squad group chat queues and deletes its squad Hub's media", async () => {
  const squad = db.sqlite.prepare("SELECT group_id, hub_id, room_id FROM decave_squad_rooms LIMIT 1").get();
  assert.ok(squad, "the squad test above created a squad room");
  const owner = db.scalar("SELECT owner_user_id FROM decave_group_chats WHERE id=?", squad.group_id);
  const now = "2099-01-01T00:00:00.000Z";
  db.exec("UPDATE decave_hubs SET icon_key='squad-icon' WHERE id=?", squad.hub_id);
  db.exec(
    `INSERT INTO decave_messages(id,room_id,hub_id,author_user_id,text,attachment_key,created_at)
     VALUES('squad-file',?,?,?,'',?,?)`,
    squad.room_id,
    squad.hub_id,
    owner,
    "attachments/private/squad-file",
    now,
  );
  db.exec(
    `INSERT INTO decave_attachment_access(r2_key,kind,owner_user_id,peer_user_id,hub_id,room_id,created_at)
     VALUES('attachments/private/squad-file','channel',?,NULL,?,?,?)`,
    owner,
    squad.hub_id,
    squad.room_id,
    now,
  );
  await media.put("attachments/private/squad-file", new Uint8Array([1]));
  await media.put("squad-icon", new Uint8Array([2]));
  const removed = await api(`/api/groups/${encodeURIComponent(squad.group_id)}`, owner, { method: "DELETE" });
  assert.equal(removed.response.status, 200);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_hubs WHERE id=?", squad.hub_id), 0);
  assert.equal(media.objects.has("attachments/private/squad-file"), false);
  assert.equal(media.objects.has("squad-icon"), false);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_media_deletion_queue"), 0);
});

test("room deletion queues sent, unsent and legacy files atomically and retries R2 failures", async () => {
  const { deleteQueuedMedia } = await import("../../worker/lib/media.ts");
  const stamp = new Date().toISOString();
  db.exec("INSERT INTO decave_hub_members(hub_id,user_id,role,joined_at) VALUES(1,'u1','owner',?)", stamp);
  const files = ["attachments/private/room-sent", "attachments/private/room-unsent", "attachments/1/901/legacy"];
  db.exec(
    "INSERT INTO decave_rooms(id,hub_id,name,type,created_at,updated_at) VALUES(901,1,'delete-me','text',?,?)",
    stamp,
    stamp,
  );
  for (const objectKey of files.slice(0, 2)) {
    await media.put(objectKey, new Uint8Array([1]));
    db.exec(
      "INSERT INTO decave_attachment_access(r2_key,kind,owner_user_id,hub_id,room_id,created_at) VALUES(?,'channel','u1',1,901,?)",
      objectKey,
      stamp,
    );
  }
  await media.put(files[2], new Uint8Array([2]));
  for (const [i, objectKey] of [files[0], files[2]].entries())
    db.exec(
      "INSERT INTO decave_messages(id,room_id,hub_id,author_user_id,text,attachment_key,created_at) VALUES(?,901,1,'u1','',?,?)",
      "room-file-" + i,
      objectKey,
      stamp,
    );
  const denied = await api("/api/channels/901", "u2", { method: "DELETE" });
  assert.equal(denied.response.status, 403);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_media_deletion_queue WHERE object_key IN (?,?,?)", ...files), 0);
  const removed = await api("/api/channels/901", "u1", { method: "DELETE" });
  assert.equal(removed.response.status, 200);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_attachment_access WHERE room_id=901"), 0);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_messages WHERE room_id=901"), 0);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_media_deletion_queue WHERE object_key IN (?,?,?)", ...files), 3);
  const originalDelete = media.delete;
  media.delete = async () => {
    throw new Error("R2 unavailable");
  };
  try {
    assert.deepEqual(await deleteQueuedMedia(env, files), files);
  } finally {
    media.delete = originalDelete;
  }
  assert.equal(
    db.scalar("SELECT COUNT(*) FROM decave_media_deletion_queue WHERE object_key IN (?,?,?) AND attempts=1", ...files),
    3,
  );
  assert.deepEqual(await deleteQueuedMedia(env, files), []);
  for (const objectKey of files) assert.equal(await media.get(objectKey), null);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_rooms WHERE id=10"), 1, "other rooms remain intact");

  db.exec(
    "INSERT INTO decave_rooms(id,hub_id,name,type,created_at,updated_at) VALUES(902,1,'rollback','text',?,?)",
    stamp,
    stamp,
  );
  db.exec(
    "INSERT INTO decave_attachment_access(r2_key,kind,owner_user_id,hub_id,room_id,created_at) VALUES('rollback-file','channel','u1',1,902,?)",
    stamp,
  );
  db.sqlite.exec(
    "CREATE TRIGGER fail_room_delete BEFORE DELETE ON decave_rooms WHEN OLD.id=902 BEGIN SELECT RAISE(ABORT,'test failure'); END;",
  );
  try {
    await assert.rejects(api("/api/channels/902", "u1", { method: "DELETE" }), /test failure/);
    assert.equal(db.scalar("SELECT COUNT(*) FROM decave_attachment_access WHERE room_id=902"), 1);
    assert.equal(
      db.scalar("SELECT COUNT(*) FROM decave_media_deletion_queue WHERE object_key='rollback-file'"),
      0,
      "failed deletion also rolls back its queue insertion",
    );
  } finally {
    db.sqlite.exec("DROP TRIGGER fail_room_delete");
  }
});

test("Hub voice metadata is validated, stored and returned as attachment.voice", async () => {
  const { messagesForClient } = await import("../../worker/lib/messages.ts");
  const wave = Buffer.alloc(64, 128).toString("base64");
  async function sendWith(text, voice) {
    const upload = await api("/api/channels/10/attachments", "u2", {
      method: "POST",
      body: new Uint8Array([1, 2, 3]),
      headers: { "x-file-name": "v.m4a", "x-file-type": "audio/mp4", "x-voice-note": "1" },
    });
    assert.equal(upload.response.status, 200);
    const socket = new FakeSocket(completeSocketState("u2"));
    await roomForSocket(socket).webSocketMessage(
      socket,
      JSON.stringify({
        type: "CHAT_MESSAGE",
        channelId: 10,
        text,
        attachment: voice === undefined ? upload.data.attachment : { ...upload.data.attachment, voice },
      }),
    );
    const id = db.scalar("SELECT id FROM decave_messages WHERE text=? AND room_id=10", text);
    assert.ok(id, "message stored");
    const [message] = await messagesForClient(env, [id]);
    return { id, message };
  }
  const valid = await sendWith("voice valid", { ms: 4200, wave, bytes: 1000, extra: "dropped" });
  assert.deepEqual(valid.message.attachment.voice, { ms: 4200, wave, bytes: 1000 });
  const invalid = await sendWith("voice invalid", { ms: -5, wave: "nope" });
  assert.ok(invalid.message.attachment, "attachment is kept");
  assert.equal("voice" in invalid.message.attachment, false);
  assert.equal(db.scalar("SELECT attachment_voice FROM decave_messages WHERE id=?", invalid.id), null);
  const plain = await sendWith("voice absent", undefined);
  assert.equal("voice" in plain.message.attachment, false);
});
