import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { register } from "node:module";
import { test } from "node:test";

register("../test-support/cloudflare-workers-test-loader.mjs", import.meta.url);
const { handleApi } = await import("../../worker/index.ts");
const { hashPassword } = await import("../../worker/db.ts");
const { D1Mock, MediaMock } = await import("../test-support/worker-sqlite-test-fixture.mjs");
const levels = await import("../../src/features/settings/notifyLevels.ts");
const sync = await import("../../src/features/settings/settingsSync.ts");
const { describeLastActive } = await import("../../src/features/settings/sessionFormat.ts");
const { matchCaptureApps, parseTasklistCsv } = createRequire(import.meta.url)("../../electron/capture-apps.cjs");

const NOW = "2099-01-01T00:00:00.000Z";
const PASSWORD = "correct horse battery staple";
const hashToken = (value) => createHash("sha256").update(value).digest("hex");
const tokenFor = (userId) => `batch2-token-${userId}`;
const pub = (userId) => `DC-${userId.slice(1).padStart(16, "0")}`;
const CHROME_WIN =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
const SAFARI_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";

const db = new D1Mock();
const { salt, hash } = await hashPassword(PASSWORD);
for (const userId of ["u1", "u2", "u3"]) {
  db.exec(
    `INSERT INTO decave_users
     (id,username,password_salt,password_hash,created_at,public_id,bio,status,status_text,activity_text,accent,
      email,email_normalized,email_verified_at,requires_email_verification,platform_role,
      suspended_at,suspended_until,suspension_reason,must_reset_password,deleted_at,delete_after,deletion_reason,erased_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    userId,
    `user-${userId}`,
    salt,
    hash,
    NOW,
    pub(userId),
    "",
    "online",
    "",
    userId === "u1" ? "Playing PUBG" : "",
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
  db.exec(
    "INSERT INTO decave_session_clients(token_hash,user_id,client,device_label,created_at) VALUES(?,?,?,?,?)",
    hashToken(tokenFor(userId)),
    userId,
    "mobile",
    "Mobile app",
    NOW,
  );
}
// u1 and u2 are friends; u3 shares a Hub with u1 but is not a friend.
db.exec("INSERT INTO decave_friendships(user_a,user_b,created_at) VALUES('u1','u2',?)", NOW);
db.exec(
  `INSERT INTO decave_hubs(id,name,icon,owner_id,visibility,description,accent,category,slow_mode_seconds,created_at,updated_at)
  VALUES(1,'Hub','H','u1','private','','#123456','Gaming',0,?,?)`,
  NOW,
  NOW,
);
for (const userId of ["u1", "u3"])
  db.exec(
    "INSERT INTO decave_hub_members(hub_id,user_id,role,joined_at) VALUES(1,?,?,?)",
    userId,
    userId === "u1" ? "owner" : "member",
    NOW,
  );

const emails = [];
const broadcasts = [];
const env = {
  DB: db,
  MEDIA: new MediaMock(),
  ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
  EMAIL: {
    send: async (message) => {
      emails.push(message);
      return { messageId: "test" };
    },
  },
  AUTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
  RECOVERY_RATE_LIMITER: { limit: async () => ({ success: true }) },
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
  OWNER_MFA_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  HUB_ROOM: {
    idFromName: () => "global",
    get: () => ({
      fetch: async (request) => {
        const url = new URL(request.url);
        if (url.pathname === "/internal/online-users" || url.pathname === "/internal/count")
          return Response.json({ userIds: ["u1", "u2", "u3"], count: 3 });
        const body = await request.json().catch(() => null);
        if (url.pathname === "/internal/broadcast") broadcasts.push(body);
        return Response.json({ success: true });
      },
    }),
  },
};

async function api(pathname, userId, { method = "GET", body, headers: extra = {}, form } = {}) {
  const headers = new Headers(extra);
  if (userId) headers.set("authorization", `Bearer ${tokenFor(userId)}`);
  let payload;
  if (form) {
    payload = new URLSearchParams(form);
    headers.set("content-type", "application/x-www-form-urlencoded");
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    headers.set("content-type", "application/json");
  }
  const response = await handleApi(
    new Request(`https://test.invalid${pathname}`, { method, headers, body: payload }),
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

const login = (email, userAgent, country = "GR") =>
  api("/api/auth/login", null, {
    method: "POST",
    body: { identifier: email, password: PASSWORD, turnstileToken: "test", client: "web" },
    headers: { "user-agent": userAgent, "CF-IPCountry": country },
  });

test("the first device never alerts; a new device emails a 'This wasn't me' link", async () => {
  emails.length = 0;
  assert.equal((await login("u2@example.test", CHROME_WIN)).response.status, 200);
  assert.equal(emails.length, 0, "first known device: no alert");
  assert.equal((await login("u2@example.test", CHROME_WIN)).response.status, 200);
  assert.equal(emails.length, 0, "same device again: no alert");
  assert.equal((await login("u2@example.test", SAFARI_MAC, "DE")).response.status, 200);
  assert.equal(emails.length, 1);
  assert.equal(emails[0].to, "u2@example.test");
  assert.match(emails[0].text, /Safari on macOS · Germany/);
  assert.match(emails[0].html, /This wasn't me/);
});

test("'This wasn't me' requires an explicit POST, then signs out everywhere and sends a reset link once", async () => {
  const link = /https?:\/\/[^\s"]+\/api\/auth\/secure-account#token=([^\s"&]+)/.exec(emails[0].text);
  assert.ok(link, "email contains the link");
  const token = decodeURIComponent(link[1]);

  const page = await api("/api/auth/secure-account", null);
  assert.equal(page.response.status, 200);
  const html = await page.response.text();
  assert.match(html, /data-email-action="secure"/);
  assert.equal(
    db.scalar("SELECT COUNT(*) FROM decave_sessions WHERE user_id='u2'") > 0,
    true,
    "opening the link alone changes nothing",
  );

  emails.length = 0;
  const done = await api("/api/auth/secure-account", null, { method: "POST", body: { token } });
  assert.equal(done.response.status, 200);
  assert.match(await done.response.text(), /Account secured/);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_sessions WHERE user_id='u2'"), 0, "every session is gone");
  assert.equal(emails.length, 1);
  assert.match(emails[0].subject, /Reset your DeCave password/);

  const again = await api("/api/auth/secure-account", null, { method: "POST", body: { token } });
  assert.equal(again.response.status, 400, "the link works once");

  // Give u2 back the API session the later tests use.
  db.exec(
    "INSERT INTO decave_sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)",
    hashToken(tokenFor("u2")),
    "u2",
    "2100-01-01T00:00:00.000Z",
    NOW,
  );
  db.exec(
    "INSERT INTO decave_session_clients(token_hash,user_id,client,device_label,created_at) VALUES(?,?,?,?,?)",
    hashToken(tokenFor("u2")),
    "u2",
    "mobile",
    "Mobile app",
    NOW,
  );
});

test("sign-in alerts can be turned off", async () => {
  emails.length = 0;
  await login("u3@example.test", CHROME_WIN);
  const off = await api("/api/account/preferences", "u3", { method: "PUT", body: { loginAlerts: false } });
  assert.equal(off.data.loginAlerts, false);
  await login("u3@example.test", SAFARI_MAC);
  assert.equal(emails.length, 0);
});

test("sessions report when each device was last active", async () => {
  await login("u1@example.test", CHROME_WIN);
  const { data } = await api("/api/auth/sessions", "u1");
  const web = data.sessions.find((session) => session.deviceLabel.startsWith("Chrome on Windows"));
  assert.ok(web?.lastActiveAt, "a fresh sign-in counts as activity");
  assert.ok(data.sessions.some((session) => "lastActiveAt" in session));
});

test("game activity follows Everyone / Friends / Nobody for everyone else", async () => {
  const seenBy = async (viewer) => (await api(`/api/users/${pub("u1")}/profile`, viewer)).data.activityText;
  const friendList = async () =>
    (await api("/api/social", "u2")).data.friends.find((friend) => friend.username === "user-u1")?.activityText;

  assert.equal(await seenBy("u3"), "Playing PUBG", "everyone (default)");

  broadcasts.length = 0;
  const friendsOnly = await api("/api/account/preferences", "u1", {
    method: "PUT",
    body: { activityVisibility: "friends" },
  });
  assert.equal(friendsOnly.data.activityVisibility, "friends");
  assert.equal(await seenBy("u3"), "", "a Hub member who isn't a friend no longer sees it");
  assert.equal(await seenBy("u2"), "Playing PUBG", "a friend still does");
  assert.equal(await friendList(), "Playing PUBG");
  const general = broadcasts.find((item) => item.event?.type === "PROFILE_UPDATED");
  const friendsCopy = broadcasts.find(
    (item) => item.event?.type === "PROFILE_UPDATED" && item.event.user.activityText === "Playing PUBG",
  );
  assert.equal(general.event.user.activityText, "", "public profile data drops friends-only game activity");
  assert.deepEqual(
    [...general.filter.userIds].sort(),
    ["u1", "u2", "u3"],
    "profile fanout is scoped to self, friends, and shared-Hub members",
  );
  assert.deepEqual(friendsCopy.filter.userIds, ["u2"]);
  assert.equal(friendsCopy.event.user.activityText, "Playing PUBG");

  await api("/api/account/preferences", "u1", { method: "PUT", body: { activityVisibility: "nobody" } });
  assert.equal(await seenBy("u2"), "");
  assert.equal(await friendList(), "");
  assert.equal(await seenBy("u1"), "Playing PUBG", "you always see your own");
  const me = await api("/api/account/preferences", "u1");
  assert.equal(me.data.activityVisibility, "nobody");
});

test("synced settings round-trip and are size-limited", async () => {
  const settings = sync.buildSyncedSettings({
    appSkin: "pearl",
    textScale: 110,
    extra: {
      themeMode: "system",
      lightSkin: "bright",
      darkSkin: "nebula",
      motion: "reduce",
      density: "compact",
      highContrast: true,
      underlineLinks: false,
      showAltText: false,
      quietHours: { enabled: true, start: "22:00", end: "07:00", allowMentions: true },
      outputVolume: 150,
      cameraDeviceId: "cam-1",
      showAudioDiagnostics: true,
    },
    notifications: { desktop: true, mentions: true },
    notificationPreset: "mentions",
    sounds: { theme: "soft" },
    privacy: { notificationPreview: "sender", sendTypingIndicators: false },
    notifyLevels: { hubs: { 1: "all" }, rooms: {} },
  });
  assert.equal("outputVolume" in settings.extra, false, "device choices stay on the device");
  assert.equal("cameraDeviceId" in settings.extra, false);
  const saved = await api("/api/account/preferences", "u1", { method: "PUT", body: { clientSettings: settings } });
  assert.equal(saved.response.status, 200);
  assert.ok(saved.data.clientSettingsUpdatedAt);
  const loaded = await api("/api/account/preferences", "u1");
  const parsed = sync.readSyncedSettings(loaded.data.clientSettings);
  assert.equal(parsed.appSkin, "pearl");
  assert.equal(parsed.extra.density, "compact");
  assert.deepEqual(parsed.notifyLevels, { hubs: { 1: "all" }, rooms: {} });

  const huge = await api("/api/account/preferences", "u1", {
    method: "PUT",
    body: { clientSettings: { v: 1, junk: "x".repeat(40_000) } },
  });
  assert.equal(huge.response.status, 413);
  assert.equal(sync.shouldApplyRemote(loaded.data.clientSettingsUpdatedAt, null), true);
  assert.equal(sync.shouldApplyRemote(loaded.data.clientSettingsUpdatedAt, loaded.data.clientSettingsUpdatedAt), false);
  assert.equal(sync.shouldApplyRemote(null, null), false);
  assert.equal(sync.readSyncedSettings({ v: 99 }), null, "unknown versions are ignored");
});

test("notification levels: rooms override Hubs, Mentions only is the default", () => {
  let value = levels.EMPTY_NOTIFY_LEVELS;
  assert.equal(levels.effectiveNotifyLevel(value, 1, 10), "mentions");
  value = levels.withHubLevel(value, 1, "all");
  value = levels.withRoomLevel(value, 10, "nothing");
  assert.equal(levels.effectiveNotifyLevel(value, 1, 10), "nothing");
  assert.equal(levels.effectiveNotifyLevel(value, 1, 11), "all");
  value = levels.withRoomLevel(value, 10, "default");
  assert.equal(levels.effectiveNotifyLevel(value, 1, 10), "all");
  value = levels.withHubLevel(value, 1, "mentions");
  assert.deepEqual(value, { hubs: {}, rooms: {} }, "defaults are not stored");
  assert.deepEqual(levels.notifyDecision("mentions", false), { notify: false, sound: false });
  assert.deepEqual(levels.notifyDecision("mentions", true), { notify: true, sound: true });
  assert.deepEqual(levels.notifyDecision("all", false), { notify: true, sound: true });
  assert.deepEqual(levels.notifyDecision("nothing", true), { notify: false, sound: false });
  assert.deepEqual(levels.normalizeNotifyLevels({ hubs: { 1: "all", x: "all", 2: "loud" }, rooms: [] }), {
    hubs: { 1: "all" },
    rooms: {},
  });
});

test("last-active wording", () => {
  const now = Date.parse("2030-01-10T12:00:00Z");
  assert.equal(describeLastActive("2030-01-10T11:55:00Z", now), "Active now");
  assert.equal(describeLastActive("2030-01-10T11:30:00Z", now), "Active 30 minutes ago");
  assert.equal(describeLastActive("2030-01-10T09:00:00Z", now), "Active 3 hours ago");
  assert.equal(describeLastActive("2030-01-08T12:00:00Z", now), "Active 2 days ago");
  assert.equal(
    describeLastActive("2029-12-01T12:00:00Z", now, () => "1 Dec 2029"),
    "Not used since 1 Dec 2029",
  );
  assert.equal(describeLastActive(null, now), "");
});

test("streaming apps are recognised by process name on Windows and macOS", () => {
  const windows = parseTasklistCsv(
    '"obs64.exe","1234","Console","1","250,000 K"\r\n"chrome.exe","88","Console","1","90,000 K"\r\n"Streamlabs OBS.exe","9","Console","1","1 K"\r\n',
  );
  assert.deepEqual(windows, ["obs64.exe", "chrome.exe", "Streamlabs OBS.exe"]);
  assert.deepEqual(matchCaptureApps(windows), ["OBS Studio", "Streamlabs"]);
  assert.deepEqual(matchCaptureApps(["/Applications/OBS.app/Contents/MacOS/obs", "Finder"]), ["OBS Studio"]);
  assert.deepEqual(matchCaptureApps(["notepad.exe", "obsidian.exe"]), [], "no partial-name matches");
});
