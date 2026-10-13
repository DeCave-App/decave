import assert from "node:assert/strict";
import { register } from "node:module";
import { after, test } from "node:test";
import { D1Mock, MediaMock } from "../test-support/worker-sqlite-test-fixture.mjs";

register("../test-support/cloudflare-workers-test-loader.mjs", import.meta.url);
const { handleApi } = await import("../../worker/index.ts");
const { tokenHash } = await import("../../worker/db.ts");
const { ensureHubFeatureSchema } = await import("../../worker/lib/hub-schema.ts");
const { serveR2, hubMediaObjectKeys } = await import("../../worker/lib/media.ts");
const { parseRoomAccent, roomAccentInk } = await import("../../shared/room-style.ts");

const db = new D1Mock();
const env = {
  DB: db,
  MEDIA: new MediaMock(),
  ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
  AUTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
  RECOVERY_RATE_LIMITER: { limit: async () => ({ success: true }) },
  HUB_ROOM: { idFromName: () => "global", get: () => ({ fetch: async () => Response.json({ success: true }) }) },
};
// serveR2 streams R2 bodies; the shared mock returns plain bytes.
const mockGet = env.MEDIA.get.bind(env.MEDIA);
env.MEDIA.get = async (key) => {
  const object = await mockGet(key);
  return object && { ...object, body: new Response(object.body).body };
};
await ensureHubFeatureSchema(env);
after(() => db.sqlite.close());

const now = new Date().toISOString();
for (const id of ["owner", "member", "outsider"]) {
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
  db.exec(
    `INSERT INTO decave_user_safety_profiles(user_id,age_status,age_band,teen_safety_mode,age_policy_version,
       age_assurance_method,created_at,updated_at) VALUES(?,'eligible','adult',0,'2026-10-v1-adults','self_attested',?,?)`,
    id,
    now,
    now,
  );
}
const hubId = Number(
  db.exec(
    "INSERT INTO decave_hubs(name,icon,owner_id,visibility,created_at,updated_at) VALUES('Styled','H','owner','public',?,?)",
    now,
    now,
  ).lastInsertRowid,
);
for (const [id, role] of [
  ["owner", "owner"],
  ["member", "member"],
])
  db.exec("INSERT INTO decave_hub_members(hub_id,user_id,role,joined_at) VALUES(?,?,?,?)", hubId, id, role, now);
const makeRoom = (name, isPrivate = 0) =>
  Number(
    db.exec(
      "INSERT INTO decave_rooms(hub_id,name,type,kind,category,position,private,created_at,updated_at) VALUES(?,?,'text','chat','C',0,?,?,?)",
      hubId,
      name,
      isPrivate,
      now,
      now,
    ).lastInsertRowid,
  );
const general = makeRoom("general");
const secret = makeRoom("secret", 1);

function call(path, { method = "GET", body, raw, as = "owner" } = {}) {
  const headers = new Headers({ authorization: `Bearer tok-${as}` });
  if (body !== undefined) headers.set("content-type", "application/json");
  return handleApi(
    new Request(`https://app.de-cave.com${path}`, {
      method,
      headers,
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    }),
    env,
  );
}
const fetchUpload = (url, as) =>
  serveR2(new Request(`https://app.de-cave.com${url}`, { headers: { authorization: `Bearer tok-${as}` } }), env);

/** PNG header with the given size; enough for the type sniffer and dimension check. */
function pngOfSize(width, height) {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}
const roomFor = async (as, roomId) =>
  (await (await call("/api/servers", { as })).json()).find((s) => s.id === hubId).channels.find((c) => c.id === roomId);

test("room accent: hex colours are stored, cleared with null, and anything else is refused", async () => {
  assert.equal((await call(`/api/channels/${general}`, { method: "PATCH", body: { accent: "#2DD4A7" } })).status, 200);
  assert.equal((await roomFor("member", general)).accent, "#2dd4a7");

  for (const accent of ["teal", "#fff", "url(x)", "#12345g", 42])
    assert.equal(
      (await call(`/api/channels/${general}`, { method: "PATCH", body: { accent } })).status,
      400,
      String(accent),
    );
  assert.equal((await roomFor("member", general)).accent, "#2dd4a7", "rejected values change nothing");

  // Saving other settings without `accent` keeps it.
  assert.equal((await call(`/api/channels/${general}`, { method: "PATCH", body: { name: "general" } })).status, 200);
  assert.equal((await roomFor("member", general)).accent, "#2dd4a7");

  assert.equal((await call(`/api/channels/${general}`, { method: "PATCH", body: { accent: null } })).status, 200);
  assert.equal((await roomFor("member", general)).accent, null);
});

test("room background: managers upload, members of the room see it, others don't", async () => {
  const path = `/api/channels/${secret}/media/background`;
  assert.equal((await call(path, { method: "POST", raw: pngOfSize(1920, 1080), as: "member" })).status, 403);
  assert.equal((await call(path, { method: "POST", raw: pngOfSize(200, 100) })).status, 400, "too small");
  assert.equal((await call(path, { method: "POST", raw: new Uint8Array([1, 2, 3, 4]) })).status, 400, "not an image");

  const first = await (await call(path, { method: "POST", raw: pngOfSize(1920, 1080) })).json();
  assert.match(first.url, new RegExp(`^/uploads/hub-media/${hubId}/room-background/${secret}/`));
  const owned = await roomFor("owner", secret);
  assert.equal(owned.backgroundUrl, first.url);
  assert.equal("background_key" in owned, false, "the raw R2 key is not sent to clients");

  assert.equal((await fetchUpload(first.url, "owner")).status, 200);
  assert.equal((await fetchUpload(first.url, "member")).status, 404, "a Hub member without room access");
  assert.equal((await fetchUpload(first.url, "outsider")).status, 404, "public Hub, private room");

  // Replacing deletes the old object.
  const second = await (await call(path, { method: "POST", raw: pngOfSize(1280, 720) })).json();
  assert.equal(env.MEDIA.objects.has(first.url.slice("/uploads/".length)), false);
  assert.ok((await hubMediaObjectKeys(db, hubId)).includes(second.url.slice("/uploads/".length)));

  const removed = await (await call(path, { method: "DELETE" })).json();
  assert.equal(removed.url, null);
  assert.equal(env.MEDIA.objects.has(second.url.slice("/uploads/".length)), false);
  assert.equal((await roomFor("owner", secret)).backgroundUrl, null);
});

test("deleting a room queues its background for deletion", async () => {
  const doomed = makeRoom("doomed");
  const { url } = await (
    await call(`/api/channels/${doomed}/media/background`, { method: "POST", raw: pngOfSize(1920, 1080) })
  ).json();
  assert.equal((await call(`/api/channels/${doomed}`, { method: "DELETE" })).status, 200);
  const queued = db.sqlite
    .prepare("SELECT 1 AS n FROM decave_media_deletion_queue WHERE object_key=?")
    .get(url.slice("/uploads/".length));
  assert.ok(queued, "background key is in the deletion queue");
});

test("accent helpers: parse and pick readable text", () => {
  assert.equal(parseRoomAccent(" #ABCDEF "), "#abcdef");
  assert.equal(parseRoomAccent(""), null);
  assert.equal(parseRoomAccent("#abc"), undefined);
  assert.equal(roomAccentInk("#f5c518"), "#0b0d12", "dark text on yellow");
  assert.equal(roomAccentInk("#3b1d8f"), "#ffffff", "white text on deep violet");
});
