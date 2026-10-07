import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { register } from "node:module";

// With DM_E2EE_ENABLED off (the default in wrangler.jsonc) DMs behave exactly as
// before encryption existed, so today's mobile apps keep working.
register("../test-support/cloudflare-workers-test-loader.mjs", import.meta.url);
const { handleApi } = await import("../../worker/index.ts");
const { DmE2eeSession } = await import("../../shared/dm-e2ee-session.ts");
const crypto = await import("../../shared/dm-e2ee.ts");
import { D1Mock, MediaMock } from "../test-support/worker-sqlite-test-fixture.mjs";

const now = "2099-01-01T00:00:00.000Z";
const hashToken = (value) => createHash("sha256").update(value).digest("hex");
const db = new D1Mock();
for (const id of ["u1", "u2"]) {
  db.exec(
    "INSERT INTO decave_users(id,username,password_salt,password_hash,created_at,public_id) VALUES(?,?,?,?,?,?)",
    id,
    `user-${id}`,
    "s",
    "h",
    now,
    `DC-${id}`,
  );
  db.exec(
    "INSERT INTO decave_sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)",
    hashToken(`token-${id}`),
    id,
    "2100-01-01T00:00:00.000Z",
    now,
  );
}
db.exec("INSERT INTO decave_friendships(user_a,user_b,created_at) VALUES('u1','u2',?)", now);

const env = {
  DB: db,
  MEDIA: new MediaMock(),
  ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
  EMAIL: { send: async () => ({ messageId: "test" }) },
  AUTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
  RECOVERY_RATE_LIMITER: { limit: async () => ({ success: true }) },
  HUB_ROOM: {
    idFromName: () => "global",
    get: () => ({ fetch: async () => Response.json({ success: true, userIds: [] }) }),
  },
};

async function api(pathname, userId, { method = "GET", body } = {}) {
  const headers = new Headers({ authorization: `Bearer token-${userId}` });
  if (body !== undefined) headers.set("content-type", "application/json");
  const response = await handleApi(
    new Request(`https://test.invalid${pathname}`, { method, headers, body: body && JSON.stringify(body) }),
    env,
  );
  return { status: response.status, data: await response.json().catch(() => null) };
}

test("the key routes say encryption is off and accept no keys", async () => {
  assert.deepEqual((await api("/api/dm-keys/me", "u1")).data, {
    enabled: false,
    key: null,
    backup: null,
    keys: [],
    historyDays: null,
  });
  const keys = crypto.deriveAccountKeys(crypto.generateAccountSeed());
  const code = crypto.generateRecoveryCode();
  const created = await api("/api/dm-keys/me", "u1", {
    method: "POST",
    body: { key: crypto.publicKeyOf(keys), backup: crypto.sealKeyBackup(keys, code, "DC-u1") },
  });
  assert.equal(created.status, 403);
  assert.equal(created.data.code, "DM_E2EE_DISABLED");
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_dm_keys"), 0);
  assert.deepEqual((await api("/api/dm-keys/users/DC-u2", "u1")).data, { current: null, keys: [] });
});

test("the apps stay idle and send plaintext, as before", async () => {
  const seeds = new Map();
  const session = new DmE2eeSession({
    client: "web",
    request: async (path, init = {}) => {
      const result = await api(path, "u1", { method: init.method ?? "GET", body: init.body });
      return { ok: result.status < 300, status: result.status, data: result.data ?? {} };
    },
    loadKeyring: async (id) => seeds.get(id) ?? null,
    saveKeyring: async (id, seed) => void seeds.set(id, seed),
    forgetKeyring: async (id) => void seeds.delete(id),
    loadDeviceState: async () => ({ pins: {} }),
    saveDeviceState: async () => {},
  });
  await session.start("DC-u1");
  const state = session.getState();
  assert.deepEqual([state.status, state.available, state.pendingRecoveryCode], ["off", false, null]);
  assert.equal(seeds.size, 0, "no key is created");
  assert.deepEqual(await session.seal("DC-u2", "hi"), { text: "hi" });

  const sent = await api("/api/dms/DC-u2", "u1", { method: "POST", body: { text: "plain as ever" } });
  assert.equal(sent.status, 201);
  assert.equal(sent.data.message.text, "plain as ever");
  // An envelope is refused rather than stored while encryption is off.
  const envelope = crypto.sealDirectMessage({
    id: "0f8fad5b-d9cb-469f-a165-70867728950e",
    from: "DC-u1",
    to: "DC-u2",
    payload: { t: "x" },
    sender: crypto.deriveAccountKeys(crypto.generateAccountSeed()),
    recipientKey: crypto.publicKeyOf(crypto.deriveAccountKeys(crypto.generateAccountSeed())),
  });
  const refused = await api("/api/dms/DC-u2", "u1", { method: "POST", body: { envelope } });
  assert.equal(refused.data.code, "DM_E2EE_DISABLED");
});

test("with encryption off, group messages, reactions and rotation stay as before", async () => {
  const rotate = await api("/api/dm-keys/me/rotate", "u1", { method: "POST", body: {} });
  assert.equal(rotate.data.code, "DM_E2EE_DISABLED");
  const settings = await api("/api/dm-keys/me/settings", "u1", { method: "PUT", body: { historyDays: 30 } });
  assert.equal(settings.data.code, "DM_E2EE_DISABLED");
  const { checkOutgoingGroupMessage } = await import("../../worker/lib/dm-e2ee.ts");
  const sender = { id: "u1", public_id: "DC-u1" };
  const plain = await checkOutgoingGroupMessage(db, {
    enabled: false,
    sender,
    groupId: "g",
    members: [sender],
    encryptedSince: null,
    text: "hello group",
    envelope: undefined,
  });
  assert.deepEqual(plain, { ok: true, text: "hello group", envelope: null, id: null, encrypted: false });
  const refused = await checkOutgoingGroupMessage(db, {
    enabled: false,
    sender,
    groupId: "g",
    members: [sender],
    encryptedSince: null,
    text: "",
    envelope: { v: 1 },
  });
  assert.equal(refused.code, "DM_E2EE_DISABLED");
});

test("wrangler.jsonc ships with encryption switched on (launched 6 October 2026)", async () => {
  const fs = await import("node:fs");
  const config = fs.readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8");
  assert.match(config, /"DM_E2EE_ENABLED": "true"/);
});
