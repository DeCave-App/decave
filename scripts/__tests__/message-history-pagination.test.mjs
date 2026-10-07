import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { register } from "node:module";
import { test } from "node:test";

register("../test-support/cloudflare-workers-test-loader.mjs", import.meta.url);
const { handleApi } = await import("../../worker/index.ts");
const { D1Mock, MediaMock } = await import("../test-support/worker-sqlite-test-fixture.mjs");

const NOW = "2099-01-01T00:00:00.000Z";
const TOTAL = 230; // past every previous fixed limit (channels 100, DMs/groups 200)
const hashToken = (value) => createHash("sha256").update(value).digest("hex");
const tokenFor = (userId) => `history-token-${userId}`;
const stamp = (index) => new Date(Date.parse("2099-01-02T00:00:00.000Z") + index * 1000).toISOString();

const db = new D1Mock();
for (const [index, userId] of ["u1", "u2", "u3"].entries()) {
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
    NOW,
    `DC-${String(index + 1).padStart(16, "0")}`,
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
  VALUES(1,'Hub','H','u1','private','','#123456','Gaming',0,?,?)`,
  NOW,
  NOW,
);
for (const userId of ["u1", "u2"])
  db.exec(
    "INSERT INTO decave_hub_members(hub_id,user_id,role,joined_at) VALUES(1,?,?,?)",
    userId,
    userId === "u1" ? "owner" : "member",
    NOW,
  );
for (const id of [10, 12]) {
  db.exec(
    `INSERT INTO decave_rooms(id,hub_id,name,type,category,position,private,created_at,updated_at,kind,forum_guidelines,forum_post_policy,forum_post_role_ids_json,forum_post_member_ids_json)
    VALUES(?,1,?,'text','General',0,0,?,?,'chat','','everyone','[]','[]')`,
    id,
    `room-${id}`,
    NOW,
    NOW,
  );
}
for (const friend of ["u2", "u3"])
  db.exec("INSERT INTO decave_friendships(user_a,user_b,created_at) VALUES('u1',?,?)", friend, NOW);
db.exec(
  "INSERT INTO decave_messages(id,room_id,hub_id,author_user_id,text,created_at) VALUES('other-room',12,1,'u1','elsewhere',?)",
  NOW,
);
for (let index = 0; index < TOTAL; index++) {
  db.exec(
    "INSERT INTO decave_messages(id,room_id,hub_id,author_user_id,text,created_at) VALUES(?,10,1,?,?,?)",
    `c-${String(index).padStart(4, "0")}`,
    index % 2 ? "u2" : "u1",
    `channel ${index}`,
    stamp(index),
  );
  db.exec(
    "INSERT INTO decave_direct_messages(id,from_user_id,to_user_id,text,created_at) VALUES(?,?,?,?,?)",
    `d-${String(index).padStart(4, "0")}`,
    index % 2 ? "u3" : "u1",
    index % 2 ? "u1" : "u3",
    `dm ${index}`,
    stamp(index),
  );
}
// Same-timestamp messages must still page without loss or duplication.
db.exec(
  "INSERT INTO decave_messages(id,room_id,hub_id,author_user_id,text,created_at) VALUES('c-tie-a',10,1,'u1','tie a',?)",
  stamp(5),
);
db.exec(
  "INSERT INTO decave_messages(id,room_id,hub_id,author_user_id,text,created_at) VALUES('c-tie-b',10,1,'u1','tie b',?)",
  stamp(5),
);

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
        if (url.pathname === "/internal/online-users" || url.pathname === "/internal/count")
          return Response.json({ userIds: [], count: 0 });
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

/** Walk a history endpoint backwards until it is exhausted; return ids oldest-first. */
async function walk(fetchPage) {
  const pages = [];
  let before = null;
  for (let guard = 0; guard < 20; guard++) {
    const page = await fetchPage(before);
    if (page.length === 0) break;
    pages.unshift(page.map((message) => message.id));
    before = page[0].id;
  }
  return pages.flat();
}

const assertChronological = (messages) => {
  for (let index = 1; index < messages.length; index++) {
    assert.ok(messages[index - 1].timestamp <= messages[index].timestamp, "pages are ordered oldest to newest");
  }
};

test("channel history returns the newest page first and pages back through every message", async () => {
  const first = await api("/api/channels/10/messages", "u1");
  assert.equal(first.response.status, 200);
  assert.equal(first.data.length, 100);
  assert.equal(first.data.at(-1).id, `c-${String(TOTAL - 1).padStart(4, "0")}`);
  assertChronological(first.data);

  const ids = await walk(
    async (before) => (await api(`/api/channels/10/messages${before ? `?before=${before}` : ""}`, "u1")).data,
  );
  assert.equal(ids.length, TOTAL + 2);
  assert.equal(new Set(ids).size, ids.length, "no message is returned twice");
  assert.ok(ids.includes("c-tie-a") && ids.includes("c-tie-b"));
  assert.ok(!ids.includes("other-room"));

  const foreignCursor = await api("/api/channels/10/messages?before=other-room", "u1");
  assert.deepEqual(foreignCursor.data, [], "a cursor from another room yields nothing");
});

test("direct-message history pages back through every message", async () => {
  const first = await api("/api/dms/DC-0000000000000003", "u1");
  assert.equal(first.response.status, 200);
  assert.equal(first.data.messages.length, 100);
  assert.equal(first.data.messages.at(-1).id, `d-${String(TOTAL - 1).padStart(4, "0")}`);
  assertChronological(first.data.messages);

  const ids = await walk(
    async (before) =>
      (await api(`/api/dms/DC-0000000000000003${before ? `?before=${before}` : ""}`, "u1")).data.messages,
  );
  assert.equal(ids.length, TOTAL);
  assert.equal(new Set(ids).size, TOTAL);
});

test("group history shows the newest messages after 200 and pages back", async () => {
  const created = await api("/api/groups", "u1", {
    method: "POST",
    body: { name: "Squad", memberIds: ["DC-0000000000000002", "DC-0000000000000003"] },
  });
  assert.ok(created.response.status < 300, `group created (${created.response.status})`);
  const groupId = created.data.group.id;
  for (let index = 0; index < TOTAL; index++) {
    db.exec(
      "INSERT INTO decave_group_chat_messages(id,group_id,from_user_id,text,created_at) VALUES(?,?,?,?,?)",
      `g-${String(index).padStart(4, "0")}`,
      groupId,
      "u1",
      `group ${index}`,
      stamp(index),
    );
  }

  const first = await api(`/api/groups/${groupId}`, "u1");
  assert.equal(first.response.status, 200);
  assert.equal(first.data.messages.at(-1).id, `g-${String(TOTAL - 1).padStart(4, "0")}`, "the newest message is shown");
  assertChronological(first.data.messages);

  const ids = await walk(
    async (before) => (await api(`/api/groups/${groupId}${before ? `?before=${before}` : ""}`, "u1")).data.messages,
  );
  assert.equal(ids.length, TOTAL);
  assert.equal(new Set(ids).size, TOTAL);
});
