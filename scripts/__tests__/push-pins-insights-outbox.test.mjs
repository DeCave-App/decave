import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { register } from "node:module";
import { test } from "node:test";

register("../test-support/cloudflare-workers-test-loader.mjs", import.meta.url);
const { handleApi } = await import("../../worker/index.ts");
const policy = await import("../../worker/push-policy.ts");
const { D1Mock, MediaMock } = await import("../test-support/worker-sqlite-test-fixture.mjs");
const outbox = await import("../../src/features/outbox/outbox.ts");
const setup = await import("../../src/features/hub-home/hubSetup.ts");
const { pinPreview } = await import("../../src/features/pins/pinPreview.ts");

const NOW = "2099-01-01T00:00:00.000Z";
const hashToken = (value) => createHash("sha256").update(value).digest("hex");
const tokenFor = (userId) => `batch3-token-${userId}`;
const pub = (userId) => `DC-${userId.slice(1).padStart(16, "0")}`;

const db = new D1Mock();
for (const userId of ["u1", "u2", "u3"]) {
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
for (const [userId, role] of [
  ["u1", "owner"],
  ["u2", "member"],
])
  db.exec(
    "INSERT INTO decave_hub_members(hub_id,user_id,role,joined_at) VALUES(1,?,?,?)",
    userId,
    role,
    new Date().toISOString(),
  );
const room = (id, name, type = "text") =>
  db.exec(
    `INSERT INTO decave_rooms(id,hub_id,name,type,category,position,private,created_at,updated_at,kind,forum_guidelines,forum_post_policy,forum_post_role_ids_json,forum_post_member_ids_json)
   VALUES(?,1,?,?,'General',?,0,?,?,'chat','','everyone','[]','[]')`,
    id,
    name,
    type,
    id,
    NOW,
    NOW,
  );
room(10, "general");
room(11, "clips");
room(12, "lounge", "voice");
const recent = (minutesAgo) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
const message = (id, author, roomId, text, minutesAgo, pinned = 0) =>
  db.exec(
    "INSERT INTO decave_messages(id,room_id,hub_id,author_user_id,text,created_at,pinned) VALUES(?,?,1,?,?,?,?)",
    id,
    roomId,
    author,
    text,
    recent(minutesAgo),
    pinned,
  );
message("m1", "u1", 10, "welcome everyone", 60 * 24 * 2, 1);
message("m2", "u2", 10, "gg", 30);
message("m3", "u2", 10, "rules: be nice", 20, 1);
message("m4", "u1", 10, "old", 60 * 24 * 10);

const env = {
  DB: db,
  MEDIA: new MediaMock(),
  ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
  EMAIL: { send: async () => ({ messageId: "test" }) },
  AUTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
  RECOVERY_RATE_LIMITER: { limit: async () => ({ success: true }) },
  HUB_ROOM: {
    idFromName: () => "global",
    get: () => ({ fetch: async () => Response.json({ userIds: [], success: true }) }),
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

test("pins endpoint returns every pinned message, newest first, to members only", async () => {
  const { response, data } = await api("/api/channels/10/pins", "u2");
  assert.equal(response.status, 200);
  assert.deepEqual(
    data.pins.map((pin) => pin.id),
    ["m3", "m1"],
  );
  assert.equal((await api("/api/channels/10/pins", "u3")).response.status, 403, "non-members can't read pins");
});

test("insights are for owners and admins and count activity", async () => {
  assert.equal((await api("/api/servers/1/insights", "u2")).response.status, 403);
  const { response, data } = await api("/api/servers/1/insights", "u1");
  assert.equal(response.status, 200);
  assert.equal(data.members.total, 2);
  assert.equal(data.members.joinedThisWeek, 2);
  assert.equal(data.thisWeek.messages, 3);
  assert.equal(data.thisWeek.activePeople, 2);
  assert.equal(data.lastWeek.messages, 1);
  assert.equal(data.days.length, 14);
  assert.equal(data.hoursUtc.length, 24);
  assert.equal(
    data.hoursUtc.reduce((a, b) => a + b, 0),
    4,
  );
  const clips = data.rooms.find((item) => item.name === "clips");
  assert.equal(clips.messages30d, 0, "quiet rooms show up with zero");
  assert.equal(data.topPosters[0].username, "user-u2");
  assert.ok(!JSON.stringify(data).includes("rules: be nice"), "no message text in insights");
});

test("clientSettingsPatch merges into what other devices saved and keeps the push lookup in step", async () => {
  await api("/api/account/preferences", "u2", {
    method: "PUT",
    body: {
      clientSettings: {
        v: 1,
        appSkin: "pearl",
        notifications: { dms: true, mentions: true, desktop: false },
        notifyLevels: { hubs: { 1: "all" }, rooms: {} },
      },
    },
  });
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_push_subscriptions WHERE user_id='u2' AND hub_id=1"), 1);
  const patched = await api("/api/account/preferences", "u2", {
    method: "PUT",
    body: {
      clientSettingsPatch: {
        notifications: { mentions: false },
        notifyLevels: { hubs: {} },
        timeZone: "Europe/Athens",
      },
    },
  });
  assert.equal(patched.response.status, 200);
  const stored = patched.data.clientSettings;
  assert.equal(stored.appSkin, "pearl", "keys the phone didn't send survive");
  assert.deepEqual(stored.notifications, { dms: true, mentions: false, desktop: false });
  assert.equal(stored.timeZone, "Europe/Athens");
  assert.equal(
    db.scalar("SELECT COUNT(*) FROM decave_push_subscriptions WHERE user_id='u2'"),
    0,
    "no longer subscribed to every message",
  );

  // mutedHubs is the complete list: unmuting the last Hub must clear it.
  await api("/api/account/preferences", "u2", {
    method: "PUT",
    body: { clientSettingsPatch: { mutedHubs: { 1: -1 } } },
  });
  const unmuted = await api("/api/account/preferences", "u2", {
    method: "PUT",
    body: { clientSettingsPatch: { mutedHubs: {} } },
  });
  assert.deepEqual(unmuted.data.clientSettings.mutedHubs, {}, "unmuting syncs to the account");
  assert.equal(unmuted.data.clientSettings.appSkin, "pearl");
});

test("push policy: levels, mutes, quiet hours in the user's time zone, previews", () => {
  const base = policy.pushSettingsFromJson(JSON.stringify({ v: 1 }));
  assert.equal(
    policy.shouldPush(base, { kind: "mention", hubId: 1, roomId: 10 }),
    true,
    "defaults keep mention pushes",
  );
  assert.equal(
    policy.shouldPush(base, { kind: "room", hubId: 1, roomId: 10 }),
    false,
    "ordinary messages need All messages",
  );
  assert.equal(policy.shouldPush(base, { kind: "dm" }), true);

  const all = policy.pushSettingsFromJson(
    JSON.stringify({ notifyLevels: { hubs: { 1: "all" }, rooms: { 11: "nothing" } } }),
  );
  assert.equal(policy.shouldPush(all, { kind: "room", hubId: 1, roomId: 10 }), true);
  assert.equal(
    policy.shouldPush(all, { kind: "mention", hubId: 1, roomId: 11 }),
    false,
    "a room set to Nothing beats the Hub",
  );

  const muted = policy.pushSettingsFromJson(JSON.stringify({ mutedHubs: { 1: -1, 2: Date.now() - 1000 } }));
  assert.equal(policy.shouldPush(muted, { kind: "mention", hubId: 1, roomId: 10 }), false);
  assert.equal(
    policy.shouldPush(muted, { kind: "mention", hubId: 2, roomId: 20 }),
    true,
    "an expired mute no longer applies",
  );

  const off = policy.pushSettingsFromJson(JSON.stringify({ notifications: { dms: false, mentions: false } }));
  assert.equal(policy.shouldPush(off, { kind: "dm" }), false);
  assert.equal(policy.shouldPush(off, { kind: "mention", hubId: 1, roomId: 10 }), false);

  // 23:30 in Athens is 20:30 UTC in winter.
  const night = new Date("2030-01-10T21:30:00Z");
  const quiet = policy.pushSettingsFromJson(
    JSON.stringify({
      timeZone: "Europe/Athens",
      extra: { quietHours: { enabled: true, start: "23:00", end: "08:00", allowMentions: false } },
      notifyLevels: { hubs: { 1: "all" } },
    }),
  );
  assert.equal(policy.localMinutes(night, "Europe/Athens"), 23 * 60 + 30);
  assert.equal(policy.shouldPush(quiet, { kind: "dm", now: night }), false);
  assert.equal(
    policy.shouldPush(quiet, { kind: "dm", now: new Date("2030-01-10T10:00:00Z") }),
    true,
    "daytime is fine",
  );
  const quietButMentions = { ...quiet, quiet: { ...quiet.quiet, allowMentions: true } };
  assert.equal(policy.shouldPush(quietButMentions, { kind: "dm", now: night }), true);
  assert.equal(policy.shouldPush(quietButMentions, { kind: "room", hubId: 1, roomId: 10, now: night }), false);
  assert.equal(policy.pushSettingsFromJson(JSON.stringify({ timeZone: "Not/AZone" })).timeZone, "UTC");

  assert.deepEqual(
    policy.pushText(
      policy.pushSettingsFromJson(JSON.stringify({ privacy: { notificationPreview: "hidden" } })),
      "Ann",
      "#general",
      "secret",
    ),
    { title: "DeCave", body: "New message in a Hub" },
  );
  assert.deepEqual(
    policy.pushText(
      policy.pushSettingsFromJson(JSON.stringify({ privacy: { notificationPreview: "sender" } })),
      "Ann",
      null,
      "secret",
    ),
    { title: "Ann", body: "Ann sent you a message" },
  );
  const explicitFullPreview = policy.pushSettingsFromJson(JSON.stringify({ privacy: { notificationPreview: "full" } }));
  assert.deepEqual(policy.pushText(explicitFullPreview, "Ann", "#general", "hi"), {
    title: "Ann in #general",
    body: "hi",
  });
  assert.deepEqual(policy.allMessageSubscriptions(all), [{ hubId: 1, roomId: null }]);
});

test("outbox: echo clears, silence fails, server errors fail the newest send", () => {
  const item = (id, text, sentAt, status = "sending") => ({
    localId: id,
    channelId: 10,
    text,
    replyToId: null,
    attachment: null,
    status,
    sentAt,
  });
  let box = [item("a", "hi", 0), item("b", "hi", 10), item("c", "yo", 20)];
  box = outbox.resolveEcho(box, 10, "hi");
  assert.deepEqual(
    box.map((x) => x.localId),
    ["b", "c"],
    "oldest matching message is confirmed first",
  );
  assert.equal(outbox.resolveEcho(box, 11, "yo").length, 2, "other rooms don't match");
  box = outbox.failNewestSending(box, "Slow mode is enabled.");
  assert.equal(box.find((x) => x.localId === "c").status, "failed");
  assert.equal(box.find((x) => x.localId === "c").error, "Slow mode is enabled.");
  box = outbox.failStale(box, 10 + outbox.SEND_TIMEOUT_MS + 1);
  assert.equal(box.find((x) => x.localId === "b").status, "failed");
  box = outbox.setStatus(box, "b", "sending", 99);
  assert.equal(box.find((x) => x.localId === "b").status, "sending");
  assert.equal(box.find((x) => x.localId === "b").error, undefined);
  assert.deepEqual(
    outbox.removeItem(box, "b").map((x) => x.localId),
    ["c"],
  );
  const queued = [item("q", "later", 0, "queued")];
  assert.equal(outbox.failStale(queued, 10 ** 9)[0].status, "queued", "offline messages wait instead of failing");
});

test("setup checklist, local hours and week-over-week wording", () => {
  const steps = setup.hubSetupSteps({
    description: "",
    hasArtwork: false,
    welcome: "",
    rules: "",
    textRooms: 1,
    events: 0,
    members: 1,
  });
  assert.equal(steps.filter((step) => step.done).length, 0);
  const done = setup.hubSetupSteps({
    description: "A PUBG squad Hub",
    hasArtwork: true,
    welcome: "Hi",
    rules: "Be nice",
    textRooms: 3,
    events: 1,
    members: 5,
  });
  assert.ok(done.every((step) => step.done));
  const utc = Array.from({ length: 24 }, (_, hour) => (hour === 20 ? 9 : 0));
  assert.equal(setup.hoursToLocal(utc, 120).indexOf(9), 22, "20:00 UTC is 22:00 at UTC+2");
  assert.equal(setup.hoursToLocal(utc, -300).indexOf(9), 15);
  assert.equal(setup.weekChange(15, 10), "+50%");
  assert.equal(setup.weekChange(5, 10), "−50%");
  assert.equal(setup.weekChange(3, 0), "New");
  assert.equal(setup.weekChange(0, 0), "Same");
});

test("pin previews describe special messages", () => {
  assert.equal(pinPreview({ text: '__DECAVE_POLL__{"question":"Map tonight?"}' }), "Poll: Map tonight?");
  assert.equal(pinPreview({ text: '__DECAVE_FORUM_POST_V1__{"title":"Patch notes"}' }), "Forum post: Patch notes");
  assert.equal(pinPreview({ text: "", attachment: { name: "a.png", mimeType: "image/png" } }), "Image · a.png");
  assert.equal(pinPreview({ text: "x".repeat(300) }).length, 281);
  assert.equal(pinPreview({ text: "x".repeat(300) }, true).length, 300);
});
