import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { register } from "node:module";

// Settings → Privacy & encryption → Devices with your key.
register("../test-support/cloudflare-workers-test-loader.mjs", import.meta.url);
const { handleApi } = await import("../../worker/index.ts");
const crypto = await import("../../shared/dm-e2ee.ts");
const { sessionPublicId } = await import("../../worker/db.ts");
import { D1Mock, MediaMock } from "../test-support/worker-sqlite-test-fixture.mjs";

const now = "2099-01-01T00:00:00.000Z";
const hashToken = (value) => createHash("sha256").update(value).digest("hex");
const publicId = (userId) => `DC-${userId.slice(1).padStart(16, "0")}`;
const sessionHash = (userId, device) => hashToken(`token-${userId}-${device}`);

const db = new D1Mock();
for (const userId of ["u1", "u2"]) {
  db.exec(
    `INSERT INTO decave_users(id,username,password_salt,password_hash,created_at,public_id) VALUES(?,?,?,?,?,?)`,
    userId,
    `user-${userId}`,
    "salt",
    "hash",
    now,
    publicId(userId),
  );
  for (const device of ["a", "b", "c"]) {
    db.exec(
      "INSERT INTO decave_sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)",
      sessionHash(userId, device),
      userId,
      "2100-01-01T00:00:00.000Z",
      now,
    );
    db.exec(
      "INSERT INTO decave_session_clients(token_hash,user_id,client,device_label,created_at,last_seen_at) VALUES(?,?,?,?,?,?)",
      sessionHash(userId, device),
      userId,
      device === "c" ? "desktop" : "web",
      `Device ${device.toUpperCase()}`,
      now,
      device === "b" ? "2099-01-02T00:00:00.000Z" : null,
    );
  }
}

const broadcasts = [];
const env = {
  DM_E2EE_ENABLED: "true",
  DB: db,
  MEDIA: new MediaMock(),
  ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
  AUTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
  HUB_ROOM: {
    idFromName: () => "global",
    get: () => ({
      fetch: async (request) => {
        const url = new URL(request.url);
        if (url.pathname === "/internal/broadcast") broadcasts.push(await request.clone().json());
        if (url.pathname === "/internal/online-users") return Response.json({ userIds: [] });
        return Response.json({ success: true });
      },
    }),
  },
};

async function api(pathname, userId, { method = "GET", body, device = "a" } = {}) {
  const headers = new Headers({ authorization: `Bearer token-${userId}-${device}` });
  if (body !== undefined) headers.set("content-type", "application/json");
  const response = await handleApi(
    new Request(`https://test.invalid${pathname}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  );
  return { status: response.status, data: await response.json().catch(() => null) };
}

const account = crypto.deriveAccountKeys(crypto.generateAccountSeed());

async function linkDevice(device) {
  const link = crypto.generateLinkKeyPair();
  const created = await api("/api/dm-keys/link-requests", "u1", {
    method: "POST",
    device,
    body: { linkPublicKey: link.publicKey, client: "web" },
  });
  const requestId = created.data.request.id;
  const sealed = crypto.sealForLinkedDevice(account, link.publicKey, publicId("u1"), requestId);
  const approved = await api(`/api/dm-keys/link-requests/${requestId}/approve`, "u1", {
    method: "POST",
    body: { sealed },
  });
  assert.equal(approved.status, 200);
  // The new device collects the key (and the request row goes away).
  await api(`/api/dm-keys/link-requests/${requestId}`, "u1", { device });
}

test("the list shows the device that created the key and every approved device", async () => {
  const created = await api("/api/dm-keys/me", "u1", {
    method: "POST",
    body: {
      key: crypto.publicKeyOf(account),
      backup: crypto.sealKeyBackup(account, crypto.generateRecoveryCode(), publicId("u1")),
    },
  });
  assert.equal(created.status, 201);
  await linkDevice("b");
  await linkDevice("c");

  const { status, data } = await api("/api/dm-keys/me/devices", "u1");
  assert.equal(status, 200);
  const byId = new Map(data.devices.map((device) => [device.sessionId, device]));
  assert.equal(data.devices.length, 3);
  const a = byId.get(sessionPublicId(sessionHash("u1", "a")));
  const b = byId.get(sessionPublicId(sessionHash("u1", "b")));
  assert.equal(a.current, true);
  assert.equal(a.label, "Device A");
  assert.equal(b.current, false);
  assert.equal(b.lastUsedAt, "2099-01-02T00:00:00.000Z");
  assert.equal(typeof b.addedAt, "string");
  for (const device of data.devices) assert.match(device.sessionId, /^[0-9a-f]{32}$/);
  assert.ok(!JSON.stringify(data).includes(sessionHash("u1", "b")), "session hashes never leave the server");

  const fromB = await api("/api/dm-keys/me/devices", "u1", { device: "b" });
  assert.equal(fromB.data.devices.find((device) => device.current).sessionId, sessionPublicId(sessionHash("u1", "b")));
});

test("removing another device signs it out and asks for a new key", async () => {
  const target = sessionPublicId(sessionHash("u1", "c"));
  const removed = await api(`/api/dm-keys/me/devices/${target}`, "u1", { method: "DELETE" });
  assert.equal(removed.status, 200);
  assert.equal(removed.data.rotationRequested, true);
  assert.equal((await api("/api/dm-keys/me", "u1", { device: "c" })).status, 401, "that device is signed out");

  const list = await api("/api/dm-keys/me/devices", "u1");
  assert.ok(!list.data.devices.some((device) => device.sessionId === target));
  const me = await api("/api/dm-keys/me", "u1");
  assert.equal(me.data.rotationRequested, true);
  assert.ok(broadcasts.some((entry) => JSON.stringify(entry).includes("DM_KEYS_CHANGED")));

  // The next rotation (the existing /rotate path, from any remaining device) clears the request.
  const rotated = crypto.rotateAccountKey(account, publicId("u1"));
  const response = await api("/api/dm-keys/me/rotate", "u1", {
    method: "POST",
    body: {
      key: crypto.publicKeyOf(rotated.next),
      previousKeyId: account.keyId,
      certificate: rotated.certificate,
      sealedForPrevious: rotated.sealedForPrevious,
      backup: null,
    },
  });
  assert.equal(response.status, 201, JSON.stringify(response.data));
  assert.equal((await api("/api/dm-keys/me", "u1")).data.rotationRequested, false);
});

test("this device can't be removed here, and other accounts' devices aren't found", async () => {
  const mine = await api(`/api/dm-keys/me/devices/${sessionPublicId(sessionHash("u1", "a"))}`, "u1", {
    method: "DELETE",
  });
  assert.equal(mine.status, 400);
  assert.equal(mine.data.code, "dmKeys.cannotRemoveCurrent");
  assert.equal((await api("/api/dm-keys/me", "u1")).status, 200, "still signed in");

  const theirs = await api(`/api/dm-keys/me/devices/${sessionPublicId(sessionHash("u2", "b"))}`, "u1", {
    method: "DELETE",
  });
  assert.equal(theirs.status, 404);
  assert.equal(theirs.data.code, "dmKeys.deviceNotFound");
  assert.equal((await api("/api/dm-keys/me", "u2", { device: "b" })).status, 200, "their session is untouched");
});
