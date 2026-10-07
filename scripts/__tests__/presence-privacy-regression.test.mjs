import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { register } from "node:module";
import { test } from "node:test";

register("../test-support/cloudflare-workers-test-loader.mjs", import.meta.url);
const { handleApi } = await import("../../worker/index.ts");
const { broadcastProfileUpdate } = await import("../../worker/lib/realtime.ts");
const { D1Mock, MediaMock } = await import("../test-support/worker-sqlite-test-fixture.mjs");

const NOW = "2099-01-01T00:00:00.000Z";
const userIds = ["u1", "u2", "u3", "u4"];
const publicIds = new Map(userIds.map((id, index) => [id, `DC-${String(index + 1).padStart(16, "0")}`]));
const tokenFor = (userId) => `presence-token-${userId}`;
const hashToken = (value) => createHash("sha256").update(value).digest("hex");

const db = new D1Mock();
for (const [index, userId] of userIds.entries()) {
  db.exec(
    `INSERT INTO decave_users
     (id,username,password_salt,password_hash,created_at,public_id,bio,status,status_text,activity_text,accent,
      email,email_normalized,email_verified_at,requires_email_verification,platform_role,
      suspended_at,suspended_until,suspension_reason,must_reset_password,deleted_at,delete_after,deletion_reason,erased_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    userId,
    `user-${userId}`,
    "salt",
    "hash",
    NOW,
    publicIds.get(userId),
    "",
    userId === "u2" ? "invisible" : userId === "u4" ? "dnd" : "online",
    userId === "u2"
      ? "invisible status detail"
      : userId === "u3"
        ? "disconnected status detail"
        : "connected status detail",
    userId === "u2" ? "invisible game" : userId === "u3" ? "disconnected game" : userId === "u4" ? "control game" : "",
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
  );
  db.exec(
    "INSERT INTO decave_sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)",
    hashToken(tokenFor(userId)),
    userId,
    "2100-01-01T00:00:00.000Z",
    NOW,
  );
  if (index > 0) db.exec("INSERT INTO decave_friendships(user_a,user_b,created_at) VALUES('u1',?,?)", userId, NOW);
}
db.exec("UPDATE decave_users SET activity_visibility='friends' WHERE id IN ('u2','u3','u4')");

for (const [userId, stamp] of [
  ["u2", NOW],
  ["u3", "2099-01-01T00:00:01.000Z"],
  ["u4", "2099-01-01T00:00:02.000Z"],
]) {
  db.exec(
    "INSERT INTO decave_direct_messages(id,from_user_id,to_user_id,text,created_at) VALUES(?,?,?,?,?)",
    `dm-${userId}`,
    "u1",
    userId,
    `message for ${userId}`,
    stamp,
  );
}

const broadcasts = [];
let connectedUserIds = [];
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
      fetch: async (request) => {
        const url = new URL(request.url);
        if (url.pathname === "/internal/online-users") return Response.json({ userIds: connectedUserIds });
        if (url.pathname === "/internal/broadcast") broadcasts.push(await request.clone().json());
        return Response.json({ success: true });
      },
    }),
  },
};

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
  return {
    response,
    data: await response
      .clone()
      .json()
      .catch(() => null),
  };
}

test("DM, group, and realtime projections hide stored presence unless a user is connected and visible", async () => {
  // Deliberately report the invisible account as connected to verify its status
  // still prevents any presence details from escaping.
  connectedUserIds = ["u2", "u4"];

  const conversations = await api("/api/dms", "u1");
  assert.equal(conversations.response.status, 200);
  const byUsername = new Map(conversations.data.conversations.map(({ user }) => [user.username, user]));
  for (const username of ["user-u2", "user-u3"]) {
    assert.deepEqual(
      {
        status: byUsername.get(username).status,
        statusText: byUsername.get(username).statusText,
        activityText: byUsername.get(username).activityText,
        online: byUsername.get(username).online,
      },
      { status: "invisible", statusText: "", activityText: "", online: false },
      `${username} has no exposed presence while invisible or disconnected`,
    );
  }
  assert.deepEqual(
    {
      status: byUsername.get("user-u4").status,
      statusText: byUsername.get("user-u4").statusText,
      activityText: byUsername.get("user-u4").activityText,
      online: byUsername.get("user-u4").online,
    },
    { status: "dnd", statusText: "connected status detail", activityText: "control game", online: true },
    "connected friends retain their visible presence and friend-only activity",
  );

  const history = await api(`/api/dms/${publicIds.get("u2")}`, "u1");
  assert.deepEqual(
    {
      status: history.data.user.status,
      statusText: history.data.user.statusText,
      activityText: history.data.user.activityText,
    },
    { status: "invisible", statusText: "", activityText: "" },
    "the DM history peer summary also hides invisible presence",
  );
  assert.equal(history.data.user.online, false);
  const connectedHistory = await api(`/api/dms/${publicIds.get("u4")}`, "u1");
  assert.deepEqual(
    {
      status: connectedHistory.data.user.status,
      statusText: connectedHistory.data.user.statusText,
      activityText: connectedHistory.data.user.activityText,
      online: connectedHistory.data.user.online,
    },
    { status: "dnd", statusText: "connected status detail", activityText: "control game", online: true },
    "the DM history peer keeps legitimate connected friend presence",
  );

  const created = await api("/api/groups", "u1", {
    method: "POST",
    body: { name: "Presence", memberIds: [publicIds.get("u2"), publicIds.get("u3"), publicIds.get("u4")] },
  });
  assert.equal(created.response.status, 201);
  const groupUsers = new Map(created.data.group.members.map((user) => [user.username, user]));
  for (const username of ["user-u2", "user-u3"])
    assert.deepEqual(
      { status: groupUsers.get(username).status, statusText: groupUsers.get(username).statusText },
      { status: "invisible", statusText: "" },
      `${username} has no exposed presence in a group member summary`,
    );
  assert.equal(groupUsers.get("user-u4").status, "dnd", "connected member status stays visible");
  assert.equal(groupUsers.get("user-u4").statusText, "connected status detail");
  assert.equal(groupUsers.get("user-u4").activityText, "", "groups retain public activity visibility rules");

  broadcasts.length = 0;
  const invisible = await db.prepare("SELECT * FROM decave_users WHERE id='u2'").first();
  await broadcastProfileUpdate(env, invisible);
  assert.equal(broadcasts.length, 1, "invisible users do not get a friends-only activity event");
  assert.deepEqual(
    {
      status: broadcasts[0].event.user.status,
      statusText: broadcasts[0].event.user.statusText,
      activityText: broadcasts[0].event.user.activityText,
    },
    { status: "invisible", statusText: "", activityText: "" },
  );

  broadcasts.length = 0;
  const connectedFriend = await db.prepare("SELECT * FROM decave_users WHERE id='u4'").first();
  await broadcastProfileUpdate(env, connectedFriend);
  const publicUpdate = broadcasts.find(({ event }) => event.type === "PROFILE_UPDATED");
  const friendActivity = broadcasts.find(
    ({ event }) => event.type === "PROFILE_UPDATED" && event.user.activityText === "control game",
  );
  assert.equal(publicUpdate.event.user.status, "dnd");
  assert.equal(publicUpdate.event.user.statusText, "connected status detail");
  assert.equal(publicUpdate.event.user.activityText, "", "public update omits friends-only activity");
  assert.equal(
    friendActivity.event.user.activityText,
    "control game",
    "connected friends retain allowed game activity",
  );
});
