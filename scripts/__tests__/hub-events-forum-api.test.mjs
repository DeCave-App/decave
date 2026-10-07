import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { register } from "node:module";
import { test } from "node:test";

register("../test-support/cloudflare-workers-test-loader.mjs", import.meta.url);
const { handleApi, HubRoom } = await import("../../worker/index.ts");
const { D1Mock, MediaMock } = await import("../test-support/worker-sqlite-test-fixture.mjs");
const { expandOccurrences, validateHubEventInput, hubEventToIcs } = await import("../../shared/hub-events.ts");
const { normalizeForumTags, structuredPrefixOf } = await import("../../shared/forum.ts");

const NOW = "2099-01-01T00:00:00.000Z";
const DAY = 86_400_000;
const hashToken = (value) => createHash("sha256").update(value).digest("hex");
const tokenFor = (userId) => `events-token-${userId}`;
const pub = (userId) => `DC-${userId.slice(1).padStart(16, "0")}`;
const USERS = ["u1", "u2", "u3", "u4", "u5"];

const db = new D1Mock();
for (const userId of USERS) {
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
    pub(userId),
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
db.exec(
  `INSERT INTO decave_hubs(id,name,icon,owner_id,visibility,description,accent,category,slow_mode_seconds,created_at,updated_at)
  VALUES(2,'Other','O','u5','private','','#123456','Gaming',0,?,?)`,
  NOW,
  NOW,
);
// u1 owner, u2/u3/u4 members; u5 owns hub 2 only.
for (const [userId, role] of [
  ["u1", "owner"],
  ["u2", "member"],
  ["u3", "member"],
  ["u4", "member"],
]) {
  db.exec("INSERT INTO decave_hub_members(hub_id,user_id,role,joined_at) VALUES(1,?,?,?)", userId, role, NOW);
}
db.exec("INSERT INTO decave_hub_members(hub_id,user_id,role,joined_at) VALUES(2,'u5','owner',?)", NOW);
const room = (id, hubId, name, type, kind = "chat", priv = 0) =>
  db.exec(
    `INSERT INTO decave_rooms(id,hub_id,name,type,category,position,private,created_at,updated_at,kind,forum_guidelines,forum_post_policy,forum_post_role_ids_json,forum_post_member_ids_json)
   VALUES(?,?,?,?,'General',?,?,?,?,?,'','everyone','[]','[]')`,
    id,
    hubId,
    name,
    type,
    id,
    priv,
    NOW,
    NOW,
    kind,
  );
room(10, 1, "general", "text");
room(11, 1, "lounge", "voice");
room(12, 1, "help", "text", "forum");
room(13, 1, "secret", "text", "chat", 1);
room(14, 1, "secret-voice", "voice", "chat", 1);
room(20, 2, "elsewhere", "text");
db.exec(
  "INSERT INTO decave_custom_roles(id,hub_id,name,color,permissions_json,position,created_at) VALUES('role-events',1,'Planner','#ffffff','[\"manageEvents\"]',0,?)",
  NOW,
);
db.exec(
  "INSERT INTO decave_custom_roles(id,hub_id,name,color,permissions_json,position,created_at) VALUES('role-raiders',1,'Raiders','#ffffff','[]',1,?)",
  NOW,
);
db.exec("INSERT INTO decave_member_roles(hub_id,user_id,role_id) VALUES(1,'u2','role-events')");
db.exec("INSERT INTO decave_member_roles(hub_id,user_id,role_id) VALUES(1,'u3','role-raiders')");

const broadcasts = [];
const internalCalls = [];
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
        const body = await request.json().catch(() => null);
        internalCalls.push({ path: url.pathname, body });
        if (url.pathname === "/internal/broadcast") broadcasts.push(body);
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

const soon = () => Date.now() + DAY;

// ---------------------------------------------------------------------------
// Pure helpers

test("event validation enforces title, time, capacity and audience rules", () => {
  const now = Date.UTC(2030, 0, 1);
  const ok = validateHubEventInput(
    { title: " Raid night ", startsAt: now + DAY, endsAt: now + DAY + 3_600_000, timezone: "Europe/Athens" },
    { now },
  );
  assert.equal(ok.ok, true);
  assert.equal(ok.value.title, "Raid night");
  assert.equal(validateHubEventInput({ title: "", startsAt: now + DAY }, { now }).field, "title");
  assert.equal(validateHubEventInput({ title: "x".repeat(101), startsAt: now + DAY }, { now }).field, "title");
  assert.equal(
    validateHubEventInput({ title: "x", description: "d".repeat(2001), startsAt: now + DAY }, { now }).field,
    "description",
  );
  assert.equal(validateHubEventInput({ title: "x", startsAt: now - 6 * 60_000 }, { now }).field, "startsAt");
  assert.equal(validateHubEventInput({ title: "x", startsAt: now - 4 * 60_000 }, { now }).ok, true);
  assert.equal(validateHubEventInput({ title: "x", startsAt: now + DAY, endsAt: now + DAY }, { now }).field, "endsAt");
  assert.equal(validateHubEventInput({ title: "x", startsAt: now + DAY, capacity: 10_001 }, { now }).field, "capacity");
  assert.equal(
    validateHubEventInput({ title: "x", startsAt: now + DAY, timezone: "Mars/Olympus" }, { now }).field,
    "timezone",
  );
  assert.equal(
    validateHubEventInput({ title: "x", startsAt: now + DAY, audience: "roles", audienceIds: [] }, { now }).field,
    "audienceIds",
  );
  assert.equal(
    validateHubEventInput({ title: "x", startsAt: now + DAY, recurrence: "yearly" }, { now }).field,
    "recurrence",
  );
});

test("recurrence expansion keeps wall-clock time across DST and caps occurrences", () => {
  // 2030-03-20 19:00 Europe/Athens (UTC+2) -> after DST (Mar 31) it is still 19:00 local (UTC+3).
  const start = Date.UTC(2030, 2, 20, 17, 0);
  const weekly = expandOccurrences(
    { startsAt: start, endsAt: start + 3_600_000, recurrence: "weekly", timezone: "Europe/Athens" },
    start,
    start + 21 * DAY,
  );
  // The 4th occurrence (+21 local days) starts an hour earlier in UTC, so it is inside the range.
  assert.equal(weekly.length, 4);
  assert.deepEqual(
    weekly.map((ms) => new Date(ms).getUTCHours()),
    [17, 17, 16, 16],
  );
  const daily = expandOccurrences(
    { startsAt: start, endsAt: null, recurrence: "daily", timezone: "UTC" },
    start,
    start + 400 * DAY,
  );
  assert.equal(daily.length, 200);
  // Monthly on the 31st skips short months.
  const jan31 = Date.UTC(2030, 0, 31, 12);
  const monthly = expandOccurrences(
    { startsAt: jan31, endsAt: null, recurrence: "monthly", timezone: "UTC" },
    jan31,
    Date.UTC(2030, 5, 1),
  );
  assert.deepEqual(
    monthly.map((ms) => new Date(ms).getUTCMonth()),
    [0, 2, 4],
  );
  // Range far in the future starts near the range, not at the origin.
  const later = expandOccurrences(
    { startsAt: start, endsAt: null, recurrence: "daily", timezone: "UTC" },
    start + 1000 * DAY,
    start + 1003 * DAY,
  );
  assert.equal(later.length, 3);
  assert.equal(
    expandOccurrences({ startsAt: start, endsAt: null, recurrence: "none", timezone: "UTC" }, start + 1, start + DAY)
      .length,
    0,
  );
});

test("ics export escapes text and emits RRULE/STATUS", () => {
  const ics = hubEventToIcs(
    {
      id: "e1",
      title: "Raid; night, again",
      description: "line1\nline2",
      startsAt: Date.UTC(2030, 0, 1),
      endsAt: null,
      recurrence: "weekly",
      cancelledAt: null,
      createdAt: 0,
      updatedAt: 0,
    },
    { now: 0 },
  );
  assert.match(ics, /BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /SUMMARY:Raid\\; night\\, again\r\n/);
  assert.match(ics, /DESCRIPTION:line1\\nline2\r\n/);
  assert.match(ics, /RRULE:FREQ=WEEKLY\r\n/);
  assert.match(ics, /DTSTART:20300101T000000Z\r\n/);
  assert.match(ics, /STATUS:CONFIRMED/);
});

test("forum tag normalization and structured prefix detection", () => {
  assert.deepEqual(normalizeForumTags([" Bug ", "bug", "Help", ""]), { ok: true, tags: ["Bug", "Help"] });
  assert.equal(normalizeForumTags(["x".repeat(25)]).ok, false);
  assert.equal(normalizeForumTags(Array.from({ length: 21 }, (_, i) => `t${i}`)).ok, false);
  assert.equal(structuredPrefixOf("__DECAVE_EVENT__{}"), "__DECAVE_EVENT__");
  assert.equal(structuredPrefixOf("hello"), null);
});

// ---------------------------------------------------------------------------
// Events API

test("event creation requires manageEvents and validates rooms", async () => {
  const denied = await api("/api/servers/1/events", "u3", {
    method: "POST",
    body: { title: "Nope", startsAt: soon() },
  });
  assert.equal(denied.response.status, 403);
  const outsider = await api("/api/servers/1/events", "u5", {
    method: "POST",
    body: { title: "Nope", startsAt: soon() },
  });
  assert.equal(outsider.response.status, 403);
  const foreignRoom = await api("/api/servers/1/events", "u1", {
    method: "POST",
    body: { title: "Bad room", startsAt: soon(), channelId: 20 },
  });
  assert.equal(foreignRoom.response.status, 400);
  assert.equal(foreignRoom.data.field, "channelId");
  const wrongType = await api("/api/servers/1/events", "u1", {
    method: "POST",
    body: { title: "Bad voice", startsAt: soon(), voiceChannelId: 10 },
  });
  assert.equal(wrongType.response.status, 400);
  const past = await api("/api/servers/1/events", "u1", {
    method: "POST",
    body: { title: "Past", startsAt: Date.now() - DAY },
  });
  assert.equal(past.response.status, 400);
  assert.equal(past.data.field, "startsAt");
  const badRole = await api("/api/servers/1/events", "u1", {
    method: "POST",
    body: { title: "Roles", startsAt: soon(), audience: "roles", audienceIds: ["nope"] },
  });
  assert.equal(badRole.response.status, 400);

  broadcasts.length = 0;
  const created = await api("/api/hubs/1/events", "u2", {
    method: "POST",
    body: {
      title: "Raid night",
      description: "Bring potions",
      startsAt: soon(),
      endsAt: soon() + 7_200_000,
      timezone: "Europe/Athens",
      recurrence: "weekly",
      channelId: 10,
      voiceChannelId: 11,
      capacity: 2,
      gameTag: "WoW",
      reminderMinutes: 15,
    },
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.data));
  const event = created.data.event;
  assert.equal(event.title, "Raid night");
  assert.equal(event.hubId, 1);
  assert.equal(event.createdBy, pub("u2"));
  assert.equal(event.recurrence, "weekly");
  assert.deepEqual(event.rsvpCounts, { going: 0, maybe: 0, declined: 0 });
  assert.equal(event.canManage, true);
  const notice = broadcasts.find((b) => b.event.type === "HUB_EVENTS_CHANGED");
  assert.ok(notice);
  assert.equal(notice.event.serverId, 1);
  assert.deepEqual(new Set(notice.filter.userIds), new Set(["u1", "u2", "u3", "u4"]));
});

test("event listing expands recurrences and filters by audience and room access", async () => {
  const roles = await api("/api/servers/1/events", "u1", {
    method: "POST",
    body: { title: "Raiders only", startsAt: soon(), audience: "roles", audienceIds: ["role-raiders"] },
  });
  assert.equal(roles.response.status, 201, JSON.stringify(roles.data));
  const members = await api("/api/servers/1/events", "u1", {
    method: "POST",
    body: { title: "Just u4", startsAt: soon(), audience: "members", audienceIds: [pub("u4")] },
  });
  assert.equal(members.response.status, 201, JSON.stringify(members.data));
  assert.deepEqual(members.data.event.audienceIds, [pub("u4")]);
  const privateRoom = await api("/api/servers/1/events", "u1", {
    method: "POST",
    body: { title: "Secret", startsAt: soon(), channelId: 13 },
  });
  assert.equal(privateRoom.response.status, 201);

  const from = Date.now();
  const to = from + 30 * DAY;
  const titles = async (userId) => {
    const result = await api(`/api/servers/1/events?from=${from}&to=${to}`, userId);
    assert.equal(result.response.status, 200, JSON.stringify(result.data));
    return result.data.events.map((e) => e.title);
  };
  const u3 = await titles("u3");
  assert.equal(u3.filter((t) => t === "Raid night").length, 5); // weekly within 30 days
  assert.ok(u3.includes("Raiders only"));
  assert.ok(!u3.includes("Just u4"));
  assert.ok(!u3.includes("Secret"));
  const u4 = await titles("u4");
  assert.ok(u4.includes("Just u4"));
  assert.ok(!u4.includes("Raiders only"));
  const owner = await titles("u1");
  for (const t of ["Raiders only", "Just u4", "Secret", "Raid night"]) assert.ok(owner.includes(t));
  const outsider = await api(`/api/servers/1/events?from=${from}&to=${to}`, "u5");
  assert.equal(outsider.response.status, 403);
  const badRange = await api(`/api/servers/1/events?from=${to}&to=${from}`, "u1");
  assert.equal(badRange.response.status, 400);
  const hidden = await api(`/api/servers/1/events/${members.data.event.id}`, "u3");
  assert.equal(hidden.response.status, 404);
});

test("RSVP respects capacity, edits are creator/manager only, cancel and ics work", async () => {
  const created = await api("/api/servers/1/events", "u1", {
    method: "POST",
    body: { title: "Tiny", startsAt: soon(), capacity: 1 },
  });
  const id = created.data.event.id;
  const first = await api(`/api/servers/1/events/${id}/rsvp`, "u3", { method: "PUT", body: { status: "going" } });
  assert.equal(first.response.status, 200);
  assert.equal(first.data.event.myRsvp, "going");
  assert.deepEqual(first.data.event.goingUserIds, [pub("u3")]);
  const full = await api(`/api/servers/1/events/${id}/rsvp`, "u4", { method: "PUT", body: { status: "going" } });
  assert.equal(full.response.status, 409);
  assert.equal(full.data.code, "EVENT_FULL");
  const again = await api(`/api/servers/1/events/${id}/rsvp`, "u3", { method: "PUT", body: { status: "going" } });
  assert.equal(again.response.status, 200);
  const maybe = await api(`/api/servers/1/events/${id}/rsvp`, "u4", { method: "PUT", body: { status: "maybe" } });
  assert.deepEqual(maybe.data.event.rsvpCounts, { going: 1, maybe: 1, declined: 0 });
  const bad = await api(`/api/servers/1/events/${id}/rsvp`, "u4", { method: "PUT", body: { status: "yes" } });
  assert.equal(bad.response.status, 400);

  const forbidden = await api(`/api/servers/1/events/${id}`, "u3", { method: "PATCH", body: { title: "Mine now" } });
  assert.equal(forbidden.response.status, 403);
  const manager = await api(`/api/servers/1/events/${id}`, "u2", {
    method: "PATCH",
    body: { title: "Renamed", capacity: 5 },
  });
  assert.equal(manager.response.status, 200, JSON.stringify(manager.data));
  assert.equal(manager.data.event.title, "Renamed");
  assert.equal(manager.data.event.capacity, 5);
  const badPatch = await api(`/api/servers/1/events/${id}`, "u1", { method: "PATCH", body: { endsAt: 1 } });
  assert.equal(badPatch.response.status, 400);

  const ics = await api(`/api/servers/1/events/${id}/ics`, "u4");
  assert.equal(ics.response.status, 200);
  assert.match(ics.response.headers.get("content-type"), /text\/calendar/);
  assert.match(await ics.response.text(), /SUMMARY:Renamed/);

  const cancel = await api(`/api/servers/1/events/${id}`, "u1", { method: "DELETE" });
  assert.equal(cancel.response.status, 200);
  assert.equal(typeof cancel.data.cancelledAt, "number");
  const list = await api(`/api/servers/1/events?from=${Date.now()}&to=${Date.now() + 5 * DAY}`, "u1");
  assert.ok(!list.data.events.some((e) => e.id === id));
  const withCancelled = await api(
    `/api/servers/1/events?from=${Date.now()}&to=${Date.now() + 5 * DAY}&includeCancelled=1`,
    "u1",
  );
  assert.ok(withCancelled.data.events.find((e) => e.id === id).cancelledAt);
  const rsvpCancelled = await api(`/api/servers/1/events/${id}/rsvp`, "u4", {
    method: "PUT",
    body: { status: "going" },
  });
  assert.equal(rsvpCancelled.response.status, 409);
});

test("custom roles accept the manageEvents permission", async () => {
  const created = await api("/api/servers/1/roles", "u1", {
    method: "POST",
    body: { name: "Host", permissions: ["manageEvents", "manageRooms", "bogus"] },
  });
  assert.equal(created.response.status, 201);
  assert.deepEqual(created.data.permissions, ["manageEvents", "manageRooms"]);
});

// ---------------------------------------------------------------------------
// Forum index + endpoints

const postText = (title, tags = [], body = "") =>
  `__DECAVE_FORUM_POST_V1__${JSON.stringify({ version: 1, title, tags, body })}`;
let clock = Date.parse("2099-02-01T00:00:00.000Z");
const stamp = () => new Date((clock += 1000)).toISOString();
function insertMessage(id, author, text, replyTo = null, roomId = 12) {
  db.exec(
    "INSERT INTO decave_messages(id,room_id,hub_id,author_user_id,text,created_at,reply_to_id) VALUES(?,?,1,?,?,?,?)",
    id,
    roomId,
    author,
    text,
    stamp(),
    replyTo,
  );
}

test("forum post index is maintained by triggers and served with sorting, tags, search and pins", async () => {
  const tagged = await api("/api/channels/12", "u1", { method: "PATCH", body: { forumTags: ["Bug", "Guide", "bug"] } });
  assert.equal(tagged.response.status, 200, JSON.stringify(tagged.data));
  assert.deepEqual(tagged.data.forumTags, ["Bug", "Guide"]);
  const tooMany = await api("/api/channels/12", "u1", {
    method: "PATCH",
    body: { forumTags: Array.from({ length: 21 }, (_, i) => `t${i}`) },
  });
  assert.equal(tooMany.response.status, 400);

  insertMessage("p1", "u2", postText("First crash", ["Bug"], "it crashes"));
  insertMessage("p2", "u3", postText("Leveling guide", ["Guide"]));
  insertMessage("p3", "u2", postText("Unanswered question"));
  insertMessage("r1", "u3", "reply one", "p1");
  insertMessage("r2", "u1", "reply two", "p1");
  insertMessage("r3", "u2", "reply to guide", "p2");
  assert.equal(db.scalar("SELECT reply_count FROM decave_forum_post_state WHERE message_id='p1'"), 2);

  const active = await api("/api/channels/12/forum/posts?sort=active", "u4");
  assert.equal(active.response.status, 200, JSON.stringify(active.data));
  assert.deepEqual(
    active.data.posts.map((p) => p.message.id),
    ["p2", "p1", "p3"],
  );
  assert.equal(active.data.posts[1].replyCount, 2);
  assert.equal(active.data.posts[1].message.userId, pub("u2"));
  assert.equal(active.data.nextCursor, null);
  const newest = await api("/api/channels/12/forum/posts?sort=new", "u4");
  assert.deepEqual(
    newest.data.posts.map((p) => p.message.id),
    ["p3", "p2", "p1"],
  );
  const unanswered = await api("/api/channels/12/forum/posts?sort=unanswered", "u4");
  assert.deepEqual(
    unanswered.data.posts.map((p) => p.message.id),
    ["p3"],
  );
  const byTag = await api("/api/channels/12/forum/posts?tag=bug", "u4");
  assert.deepEqual(
    byTag.data.posts.map((p) => p.message.id),
    ["p1"],
  );
  const search = await api("/api/channels/12/forum/posts?q=leveling", "u4");
  assert.deepEqual(
    search.data.posts.map((p) => p.message.id),
    ["p2"],
  );
  db.exec(
    "INSERT INTO decave_message_reactions(message_id,user_id,emoji,created_at) VALUES('p3','u1','forum_vote_up',?)",
    NOW,
  );
  const top = await api("/api/channels/12/forum/posts?sort=top", "u4");
  assert.equal(top.data.posts[0].message.id, "p3");
  const notForum = await api("/api/channels/10/forum/posts", "u4");
  assert.equal(notForum.response.status, 400);

  const memberPin = await api("/api/channels/12/forum/posts/p3", "u4", { method: "PATCH", body: { pinned: true } });
  assert.equal(memberPin.response.status, 403);
  const pin = await api("/api/channels/12/forum/posts/p3", "u1", { method: "PATCH", body: { pinned: true } });
  assert.equal(pin.response.status, 200);
  assert.equal(pin.data.pinned, true);
  const pinnedFirst = await api("/api/channels/12/forum/posts?sort=active", "u4");
  assert.equal(pinnedFirst.data.posts[0].message.id, "p3");
  assert.equal(pinnedFirst.data.posts[0].pinned, true);

  const strangerSolved = await api("/api/channels/12/forum/posts/p1", "u4", {
    method: "PATCH",
    body: { solvedReplyId: "r1" },
  });
  assert.equal(strangerSolved.response.status, 403);
  const wrongReply = await api("/api/channels/12/forum/posts/p1", "u2", {
    method: "PATCH",
    body: { solvedReplyId: "r3" },
  });
  assert.equal(wrongReply.response.status, 400);
  const solved = await api("/api/channels/12/forum/posts/p1", "u2", { method: "PATCH", body: { solvedReplyId: "r1" } });
  assert.equal(solved.response.status, 200);
  assert.equal(solved.data.solvedReplyId, "r1");

  const replies = await api("/api/channels/12/forum/posts/p1/replies", "u4");
  assert.deepEqual(
    replies.data.replies.map((r) => r.id),
    ["r1", "r2"],
  );
  assert.equal(replies.data.nextCursor, null);
});

test("forum pagination, reply deletion bookkeeping and thread deletion", async () => {
  for (let i = 0; i < 30; i++) insertMessage(`bulk-${i}`, "u3", postText(`Bulk ${i}`));
  const first = await api("/api/channels/12/forum/posts?sort=new", "u4");
  assert.equal(first.data.posts.length, 25);
  assert.ok(first.data.nextCursor);
  const second = await api(`/api/channels/12/forum/posts?sort=new&cursor=${first.data.nextCursor}`, "u4");
  const ids = new Set([...first.data.posts, ...second.data.posts].map((p) => p.message.id));
  assert.equal(ids.size, 33);
  for (let i = 0; i < 55; i++) insertMessage(`bulk-reply-${i}`, "u4", `r${i}`, "bulk-0");
  const page1 = await api("/api/channels/12/forum/posts/bulk-0/replies", "u4");
  assert.equal(page1.data.replies.length, 50);
  const page2 = await api(`/api/channels/12/forum/posts/bulk-0/replies?cursor=${page1.data.nextCursor}`, "u4");
  assert.equal(page2.data.replies.length, 5);

  const delReply = await api("/api/channels/12/messages/r1", "u3", { method: "DELETE" });
  assert.equal(delReply.response.status, 200);
  const state = db.sqlite
    .prepare("SELECT reply_count, solved_reply_id FROM decave_forum_post_state WHERE message_id='p1'")
    .get();
  assert.equal(state.reply_count, 1);
  assert.equal(state.solved_reply_id, null);

  const delPost = await api("/api/channels/12/messages/p1", "u2", { method: "DELETE" });
  assert.equal(delPost.response.status, 200);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_messages WHERE id IN ('p1','r2')"), 0);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_forum_post_state WHERE message_id='p1'"), 0);
});

test("B10: edits cannot add or remove structured prefixes", async () => {
  insertMessage("chat-1", "u3", "plain", null, 10);
  const toEvent = await api("/api/channels/10/messages/chat-1", "u3", {
    method: "PATCH",
    body: { text: '__DECAVE_EVENT__{"title":"x"}' },
  });
  assert.equal(toEvent.response.status, 400);
  const fine = await api("/api/channels/10/messages/chat-1", "u3", { method: "PATCH", body: { text: "plain edited" } });
  assert.equal(fine.response.status, 200);
  const unPost = await api("/api/channels/12/messages/p2", "u3", {
    method: "PATCH",
    body: { text: "no longer a post" },
  });
  assert.equal(unPost.response.status, 400);
  const badTag = await api("/api/channels/12/messages/p2", "u3", {
    method: "PATCH",
    body: { text: postText("Leveling guide", ["Nope"]) },
  });
  assert.equal(badTag.response.status, 400);
  const retitle = await api("/api/channels/12/messages/p2", "u3", {
    method: "PATCH",
    body: { text: postText("Leveling guide v2", ["Guide"]) },
  });
  assert.equal(retitle.response.status, 200);
  assert.equal(db.scalar("SELECT title FROM decave_forum_post_state WHERE message_id='p2'"), "Leveling guide v2");
});

// ---------------------------------------------------------------------------
// Room / role bugs

test("B7/B8/B9/B12 room and role validation", async () => {
  const nonMember = await api(`/api/servers/1/members/${pub("u5")}/custom-roles`, "u1", {
    method: "PATCH",
    body: { roleIds: ["role-raiders"] },
  });
  assert.equal(nonMember.response.status, 404);
  const dup = await api("/api/channels/13", "u1", { method: "PATCH", body: { name: "general" } });
  assert.equal(dup.response.status, 409);
  const position = await api("/api/channels/13", "u1", { method: "PATCH", body: { name: "secret", position: 999 } });
  assert.equal(position.response.status, 200);
  assert.equal(db.scalar("SELECT position FROM decave_rooms WHERE id=13"), 13);
  const foreignRole = await api("/api/channels/12", "u1", {
    method: "PATCH",
    body: { forumPostPolicy: "roles", forumPostRoleIds: ["role-raiders", "other-hub-role"] },
  });
  assert.equal(foreignRole.response.status, 400);
  const foreignMember = await api("/api/channels/12", "u1", {
    method: "PATCH",
    body: { forumPostPolicy: "members", forumPostMemberIds: [pub("u5")] },
  });
  assert.equal(foreignMember.response.status, 400);
  const createBad = await api("/api/servers/1/channels", "u1", {
    method: "POST",
    body: { name: "f2", type: "forum", forumPostPolicy: "roles", forumPostRoleIds: ["missing"] },
  });
  assert.equal(createBad.response.status, 400);
  db.exec("UPDATE decave_rooms SET forum_post_role_ids_json='{not json' WHERE id=12");
  const servers = await api("/api/servers", "u4");
  assert.equal(servers.response.status, 200);
  db.exec("UPDATE decave_rooms SET forum_post_role_ids_json='[]' WHERE id=12");
  internalCalls.length = 0;
  const priv = await api("/api/channels/13", "u1", { method: "PATCH", body: { private: true, memberIds: [] } });
  assert.equal(priv.response.status, 200);
  assert.ok(internalCalls.some((c) => c.path === "/internal/recheck-access" && c.body.hubId === 1));
});

// ---------------------------------------------------------------------------
// Realtime (HubRoom)

function socketState(userId, overrides = {}) {
  return {
    connectionId: randomUUID(),
    peerAddress: "test",
    authDeadlineAt: 0,
    client: "web",
    userId,
    sessionHash: hashToken(tokenFor(userId)),
    username: `user-${userId}`,
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
function hubRoom(sockets) {
  const ctx = {
    getWebSockets: () => sockets,
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
  return new HubRoom(ctx, { ...env, HUB_ROOM: undefined });
}

test("B11 + locked posts: forum replies must target unlocked top-level posts", async () => {
  insertMessage("lp", "u2", postText("Lock me"));
  insertMessage("lp-r", "u3", "nested target", "lp");
  const socket = new FakeSocket(socketState("u4", { channelId: 12 }));
  const room = hubRoom([socket]);
  const count = () =>
    db.scalar("SELECT COUNT(*) FROM decave_messages WHERE author_user_id='u4' AND room_id=12 AND text LIKE 'ws %'");
  await room.webSocketMessage(
    socket,
    JSON.stringify({ type: "CHAT_MESSAGE", channelId: 12, text: "ws nested", replyToId: "lp-r" }),
  );
  assert.equal(socket.sent.at(-1).code, "FORUM_REPLY_TARGET");
  await room.webSocketMessage(
    socket,
    JSON.stringify({ type: "CHAT_MESSAGE", channelId: 12, text: "ws ok", replyToId: "lp" }),
  );
  assert.equal(count(), 1);
  db.exec("UPDATE decave_forum_post_state SET locked=1 WHERE message_id='lp'");
  await room.webSocketMessage(
    socket,
    JSON.stringify({ type: "CHAT_MESSAGE", channelId: 12, text: "ws locked", replyToId: "lp" }),
  );
  assert.equal(socket.sent.at(-1).code, "FORUM_POST_LOCKED");
  assert.equal(count(), 1);
  const owner = new FakeSocket(socketState("u1", { channelId: 12 }));
  await hubRoom([owner]).webSocketMessage(
    owner,
    JSON.stringify({ type: "CHAT_MESSAGE", channelId: 12, text: "staff reply", replyToId: "lp" }),
  );
  assert.equal(db.scalar("SELECT reply_count FROM decave_forum_post_state WHERE message_id='lp'"), 3);
  await room.webSocketMessage(
    socket,
    JSON.stringify({ type: "CHAT_MESSAGE", channelId: 12, text: postText("Bad tag", ["Nope"]) }),
  );
  assert.equal(socket.sent.at(-1).code, "FORUM_TAG_INVALID");
});

test("B2: timed-out members cannot join voice or share media", async () => {
  const socket = new FakeSocket(socketState("u4"));
  const room = hubRoom([socket]);
  db.exec(
    "INSERT OR REPLACE INTO decave_timeouts(hub_id,user_id,timed_out_by,reason,expires_at,created_at) VALUES(1,'u4','u1','',?,?)",
    new Date(Date.now() + 60_000).toISOString(),
    NOW,
  );
  await room.webSocketMessage(socket, JSON.stringify({ type: "VOICE_JOIN", channelId: 11 }));
  assert.equal(socket.attachment.voiceChannelId, null);
  assert.equal(socket.sent.at(-1).code, "TIMED_OUT");
  socket.attachment = { ...socket.attachment, voiceChannelId: 11 };
  await room.webSocketMessage(socket, JSON.stringify({ type: "VOICE_SCREEN_STATE", screenSharing: true }));
  assert.equal(socket.attachment.screenSharing, false);
  assert.equal(socket.attachment.voiceChannelId, null);
  db.exec("DELETE FROM decave_timeouts WHERE user_id='u4'");
});

test("B1/B3/B4: access recheck ends revoked voice/text sessions; close clears ghost voice state", async () => {
  const insider = new FakeSocket(socketState("u3", { channelId: 13, voiceChannelId: 14 }));
  const owner = new FakeSocket(socketState("u1", { channelId: 10, voiceChannelId: 11 }));
  const sockets = [insider, owner];
  const room = hubRoom(sockets);
  // u3 has no grant for private rooms 13/14.
  const response = await room.fetch(
    new Request("https://internal.decave/internal/recheck-access", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hubId: 1 }),
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(insider.attachment.voiceChannelId, null);
  assert.equal(insider.attachment.channelId, 10);
  assert.ok(
    insider.sent.some((m) => m.type === "ROOM_ACCESS_REVOKED" && m.channelId === 13 && m.fallbackChannelId === 10),
  );
  assert.ok(insider.sent.some((m) => m.type === "VOICE_LEFT"));
  assert.equal(owner.attachment.voiceChannelId, 11);

  // B4: the closing socket must not appear in the VOICE_STATE sent to others.
  owner.sent.length = 0;
  const closing = new FakeSocket(socketState("u2", { voiceChannelId: 11 }));
  sockets.push(closing);
  await room.webSocketClose(closing);
  const lastState = owner.sent.filter((m) => m.type === "VOICE_STATE").at(-1);
  assert.ok(lastState);
  assert.ok(!lastState.participants.some((p) => p.connectionId === closing.attachment.connectionId));
});
