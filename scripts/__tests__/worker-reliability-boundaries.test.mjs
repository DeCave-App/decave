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
