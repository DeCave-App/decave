import assert from "node:assert/strict";
import { register } from "node:module";
import { after, test } from "node:test";
import { D1Mock, MediaMock } from "../test-support/worker-sqlite-test-fixture.mjs";

register("../test-support/cloudflare-workers-test-loader.mjs", import.meta.url);
const { handleApi } = await import("../../worker/index.ts");
const { tokenHash, canAccessRoom, canPostInChatRoom } = await import("../../worker/db.ts");
const { canAccessRoom: hubCanAccessRoom } = await import("../../worker/lib/hubs.ts");
const { ensureHubFeatureSchema } = await import("../../worker/lib/hub-schema.ts");

// The Hub list, Discover and a Hub's detail are serialized in one round of
// batched queries. Each D1 query is a network round trip from the edge, so the
// query count must not grow with the number of Hubs or rooms.

const db = new D1Mock();
let batchCounts = true;
const countCalls = [];
const env = {
  DB: db,
  MEDIA: new MediaMock(),
  ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
  AUTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
  RECOVERY_RATE_LIMITER: { limit: async () => ({ success: true }) },
  HUB_ROOM: {
    idFromName: () => "global",
    get: () => ({
      fetch: async (request) => {
        const path = new URL(request.url).pathname;
        const body = request.method === "POST" ? await request.json() : {};
        countCalls.push(path);
        if (path === "/internal/counts")
          return batchCounts
            ? Response.json({ counts: Object.fromEntries(body.hubIds.map((id) => [id, 2])) })
            : new Response("Not found", { status: 404 });
        if (path === "/internal/count") return Response.json({ count: 2 });
        return Response.json({ success: true, counts: {}, userIds: [] });
      },
    }),
  },
};
await ensureHubFeatureSchema(env);
after(() => db.sqlite.close());

const now = new Date().toISOString();
for (const id of ["me", "owner"]) {
  db.exec(
    "INSERT INTO decave_users(id,username,password_salt,password_hash,created_at,public_id) VALUES(?,?,'s','h',?,?)",
    id,
    `user-${id}`,
    now,
    `DC-${id}`,
  );
  db.exec(
    "INSERT INTO decave_sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)",
    tokenHash(`tok-${id}`),
    id,
    new Date(Date.now() + 3600_000).toISOString(),
    now,
  );
}

function makeHub(name, { visibility = "public", myRole = "member", rooms = 4 } = {}) {
  const hubId = Number(
    db.exec(
      "INSERT INTO decave_hubs(name,icon,owner_id,visibility,created_at,updated_at) VALUES(?,'H','owner',?,?,?)",
      name,
      visibility,
      now,
      now,
    ).lastInsertRowid,
  );
  db.exec("INSERT INTO decave_hub_members(hub_id,user_id,role,joined_at) VALUES(?, 'owner', 'owner', ?)", hubId, now);
  if (myRole)
    db.exec("INSERT INTO decave_hub_members(hub_id,user_id,role,joined_at) VALUES(?, 'me', ?, ?)", hubId, myRole, now);
  const roomIds = [];
  for (let index = 0; index < rooms; index++) roomIds.push(addRoom(hubId, `room-${index}`));
  return { hubId, roomIds };
}

function addRoom(hubId, name, { isPrivate = 0, postPolicy = "everyone", postRoleIds = [] } = {}) {
  return Number(
    db.exec(
      `INSERT INTO decave_rooms(hub_id,name,type,kind,category,position,private,post_policy,post_role_ids_json,created_at,updated_at)
       VALUES(?,?,'text','chat','General',0,?,?,?,?,?)`,
      hubId,
      name,
      isPrivate,
      postPolicy,
      JSON.stringify(postRoleIds),
      now,
      now,
    ).lastInsertRowid,
  );
}

function addRole(hubId, id, name, permissions) {
  db.exec(
    "INSERT INTO decave_custom_roles(id,hub_id,name,permissions_json,created_at) VALUES(?,?,?,?,?)",
    id,
    hubId,
    name,
    JSON.stringify(permissions),
    now,
  );
  db.exec("INSERT INTO decave_member_roles(hub_id,user_id,role_id) VALUES(?, 'me', ?)", hubId, id);
}

let queries = 0;
const prepare = db.prepare.bind(db);
db.prepare = (sql) => {
  queries++;
  const statement = prepare(sql);
  const bind = statement.bind.bind(statement);
  // Like D1: at most 100 bound parameters per query.
  statement.bind = (...values) => {
    assert.ok(values.length <= 100, `${values.length} parameters: ${sql.slice(0, 60)}`);
    return bind(...values);
  };
  return statement;
};

async function call(path) {
  queries = 0;
  const response = await handleApi(
    new Request(`https://app.de-cave.com${path}`, { headers: { authorization: "Bearer tok-me" } }),
    env,
  );
  assert.equal(response.status, 200, path);
  return { body: await response.json(), queries };
}

test("the Hub list costs the same number of queries for 2 Hubs as for 8 Hubs with many rooms", async () => {
  makeHub("A");
  makeHub("B");
  await call("/api/servers"); // warm the lazy schema checks
  const small = await call("/api/servers");
  assert.equal(small.body.length, 2);
  for (let index = 0; index < 6; index++) makeHub(`More ${index}`, { rooms: 12 });
  const large = await call("/api/servers");
  assert.equal(large.body.length, 8);
  assert.equal(large.queries, small.queries, "no per-Hub or per-room queries");
  assert.ok(large.queries <= 25, `GET /api/servers used ${large.queries} queries`);
});

test("Discover chunks its IN lists past D1's 100-parameter limit and skips room lists", async () => {
  for (let index = 0; index < 120; index++) makeHub(`Public ${index}`, { myRole: null, rooms: 1 });
  const { body, queries: used } = await call("/api/servers/discover");
  assert.ok(body.length >= 120);
  assert.ok(used <= 40, `Discover used ${used} queries`);
  const stranger = body.find((hub) => hub.name === "Public 0");
  assert.equal(stranger.joined, false);
  assert.equal(stranger.myRole, null);
  assert.equal(stranger.memberCount, 1);
  assert.equal(stranger.onlineCount, 2);
  assert.equal(stranger.channels, undefined);
});

test("batched room access and posting match the per-room checks", async () => {
  const { hubId } = makeHub("Access", { visibility: "private", rooms: 0 });
  const rooms = {
    open: addRoom(hubId, "open"),
    hidden: addRoom(hubId, "hidden", { isPrivate: 1 }),
    granted: addRoom(hubId, "granted", { isPrivate: 1 }),
    staff: addRoom(hubId, "staff", { postPolicy: "staff" }),
    roles: addRoom(hubId, "roles", { postPolicy: "roles", postRoleIds: ["poster"] }),
    otherRoles: addRoom(hubId, "other-roles", { postPolicy: "roles", postRoleIds: ["nobody"] }),
  };
  db.exec(
    "INSERT INTO decave_room_members(room_id,user_id,granted_by,created_at) VALUES(?, 'me', 'owner', ?)",
    rooms.granted,
    now,
  );
  addRole(hubId, "poster", "Poster", []);
  const detail = async () => (await call(`/api/servers/${hubId}`)).body;
  const expected = async () => {
    const out = {};
    for (const id of Object.values(rooms)) {
      const room = db.sqlite.prepare("SELECT * FROM decave_rooms WHERE id=?").get(id);
      if (!(await hubCanAccessRoom(db, room, "me"))) continue;
      out[room.name] = await canPostInChatRoom(db, room, "me");
    }
    return out;
  };
  const actual = (hub) => Object.fromEntries(hub.channels.map((room) => [room.name, room.canPost]));

  let hub = await detail();
  assert.deepEqual(actual(hub), await expected());
  assert.deepEqual(actual(hub), { open: true, granted: true, staff: false, roles: true, "other-roles": false });

  // A legacy role named "Moderator" makes the member forum staff.
  addRole(hubId, "legacy-mod", "Moderator", []);
  hub = await detail();
  assert.deepEqual(actual(hub), await expected());
  assert.equal(actual(hub)["other-roles"], true);

  // manageRooms reveals every private room.
  addRole(hubId, "rooms", "Rooms", ["manageRooms"]);
  hub = await detail();
  assert.deepEqual(actual(hub), await expected());
  assert.ok("hidden" in actual(hub));
  assert.equal(await canAccessRoom(db, { id: rooms.hidden, hub_id: hubId, private: 1 }, "me"), true);

  // The list and the detail serialize a Hub the same way.
  const list = (await call("/api/servers")).body;
  assert.deepEqual(
    list.find((item) => item.id === hubId),
    hub,
  );
});

test("online counts fall back to one realtime call per Hub when the batch endpoint is missing", async () => {
  batchCounts = false;
  countCalls.length = 0;
  try {
    const { body } = await call("/api/servers");
    assert.ok(body.every((hub) => hub.onlineCount === 2));
    assert.equal(countCalls.filter((path) => path === "/internal/counts").length, 1);
    assert.equal(countCalls.filter((path) => path === "/internal/count").length, body.length);
  } finally {
    batchCounts = true;
  }
});
