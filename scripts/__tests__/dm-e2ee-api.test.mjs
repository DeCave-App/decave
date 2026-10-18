import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash, randomUUID, scryptSync } from "node:crypto";
import { register } from "node:module";

// The real Worker and HubRoom against SQLite with every migration applied.
register("../test-support/cloudflare-workers-test-loader.mjs", import.meta.url);
const { handleApi, HubRoom } = await import("../../worker/index.ts");
const crypto = await import("../../shared/dm-e2ee.ts");

import { D1Mock, MediaMock } from "../test-support/worker-sqlite-test-fixture.mjs";

const now = "2099-01-01T00:00:00.000Z";
const PASSWORD = "correct horse battery staple";
const SALT = "e2ee-test-salt";
const hashToken = (value) => createHash("sha256").update(value).digest("hex");
const publicId = (userId) => `DC-${userId.slice(1).padStart(16, "0")}`;

const db = new D1Mock();
for (const userId of ["u1", "u2", "u3", "u4"]) {
  db.exec(
    `INSERT INTO decave_users(id,username,password_salt,password_hash,created_at,public_id,email,email_normalized,email_verified_at)
     VALUES(?,?,?,?,?,?,?,?,?)`,
    userId,
    `user-${userId}`,
    SALT,
    scryptSync(PASSWORD, SALT, 64).toString("hex"),
    now,
    publicId(userId),
    `${userId}@example.test`,
    `${userId}@example.test`,
    now,
  );
  for (const device of ["a", "b"]) {
    db.exec(
      "INSERT INTO decave_sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)",
      hashToken(`token-${userId}-${device}`),
      userId,
      "2100-01-01T00:00:00.000Z",
      now,
    );
  }
}
// u1 is friends with u2 and u4; u3 is a stranger.
db.exec("INSERT INTO decave_friendships(user_a,user_b,created_at) VALUES('u1','u2',?)", now);
db.exec("INSERT INTO decave_friendships(user_a,user_b,created_at) VALUES('u1','u4',?)", now);

const broadcasts = [];
const env = {
  DM_E2EE_ENABLED: "true",
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
        if (url.pathname === "/internal/broadcast") {
          broadcasts.push(await request.clone().json());
          return Response.json({ success: true });
        }
        if (url.pathname === "/internal/online-users") return Response.json({ userIds: [] });
        return new Response("ok");
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
  let data = null;
  try {
    data = await response.clone().json();
  } catch {}
  return { status: response.status, data };
}

const keys = new Map();
async function setUpKeys(userId) {
  const account = crypto.deriveAccountKeys(crypto.generateAccountSeed());
  const code = crypto.generateRecoveryCode();
  const result = await api("/api/dm-keys/me", userId, {
    method: "POST",
    body: { key: crypto.publicKeyOf(account), backup: crypto.sealKeyBackup(account, code, publicId(userId)) },
  });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  keys.set(userId, { account, code });
  return account;
}

function sealFor(from, to, text, id = randomUUID(), sender = keys.get(from).account, recipientKey) {
  return crypto.sealDirectMessage({
    id,
    from: publicId(from),
    to: publicId(to),
    payload: { t: text },
    sender,
    recipientKey: recipientKey ?? crypto.publicKeyOf(keys.get(to).account),
  });
}

test("plaintext DMs still work while one side has no key", async () => {
  await setUpKeys("u1");
  const sent = await api(`/api/dms/${publicId("u2")}`, "u1", { method: "POST", body: { text: "before encryption" } });
  assert.equal(sent.status, 201);
  assert.equal(sent.data.message.text, "before encryption");
  assert.equal(sent.data.message.envelope, null);
});

test("once both sides have keys, plaintext is refused and envelopes are stored opaque", async () => {
  await setUpKeys("u2");
  const plain = await api(`/api/dms/${publicId("u2")}`, "u1", { method: "POST", body: { text: "leak?" } });
  assert.equal(plain.status, 409);
  assert.equal(plain.data.code, "DM_E2EE_REQUIRED");

  const envelope = sealFor("u1", "u2", "secret plans");
  const sent = await api(`/api/dms/${publicId("u2")}`, "u1", { method: "POST", body: { envelope } });
  assert.equal(sent.status, 201, JSON.stringify(sent.data));
  assert.equal(sent.data.message.id, envelope.id);
  assert.equal(sent.data.message.text, "");
  const stored = db.sqlite.prepare("SELECT text, envelope FROM decave_direct_messages WHERE id=?").get(envelope.id);
  assert.equal(stored.text, "");
  assert.ok(!stored.envelope.includes("secret"));

  // The recipient reads it from history with the sender's published key.
  const history = await api(`/api/dms/${publicId("u1")}`, "u2");
  const fromHistory = history.data.messages.find((message) => message.id === envelope.id);
  const senderKeys = await api(`/api/dm-keys/users/${publicId("u1")}`, "u2");
  const opened = crypto.openDirectMessage({
    envelope: fromHistory.envelope,
    reader: keys.get("u2").account,
    senderKey: senderKeys.data.current,
    expected: { id: fromHistory.id, from: fromHistory.fromUserId, to: fromHistory.toUserId },
  });
  assert.equal(opened.t, "secret plans");

  // The conversation list carries the envelope so the client can decrypt the preview.
  const list = await api("/api/dms", "u2");
  assert.equal(list.data.conversations[0].latestEnvelope.id, envelope.id);
  assert.equal(list.data.conversations[0].latestMessage, "");

  // Replaying the same envelope does not create a second message.
  const again = await api(`/api/dms/${publicId("u2")}`, "u1", { method: "POST", body: { envelope } });
  assert.equal(again.status, 409);
});

test("envelopes with the wrong addressing or a stale key are refused", async () => {
  const cases = [
    // Signed for another recipient.
    [sealFor("u1", "u4", "x", undefined, undefined, crypto.publicKeyOf(keys.get("u2").account)), "DM_E2EE_INVALID"],
    // Not readable by the recipient's current key.
    [
      sealFor(
        "u1",
        "u2",
        "x",
        undefined,
        undefined,
        crypto.publicKeyOf(crypto.deriveAccountKeys(crypto.generateAccountSeed())),
      ),
      "DM_E2EE_STALE_KEY",
    ],
    // Sealed with a key that isn't the sender's current one.
    [sealFor("u1", "u2", "x", undefined, crypto.deriveAccountKeys(crypto.generateAccountSeed())), "DM_E2EE_STALE_KEY"],
  ];
  for (const [envelope, code] of cases) {
    const result = await api(`/api/dms/${publicId("u2")}`, "u1", { method: "POST", body: { envelope } });
    assert.equal(result.data.code, code);
  }
  const junk = await api(`/api/dms/${publicId("u2")}`, "u1", { method: "POST", body: { envelope: { v: 1 } } });
  assert.equal(junk.status, 400);
});

test("an encrypted message can only be edited with a new envelope for the same id", async () => {
  const envelope = sealFor("u1", "u2", "first");
  await api(`/api/dms/${publicId("u2")}`, "u1", { method: "POST", body: { envelope } });
  const plain = await api(`/api/dms/messages/${envelope.id}`, "u1", { method: "PATCH", body: { text: "downgrade" } });
  assert.equal(plain.status, 409);
  const otherId = await api(`/api/dms/messages/${envelope.id}`, "u1", {
    method: "PATCH",
    body: { envelope: sealFor("u1", "u2", "moved") },
  });
  assert.equal(otherId.status, 400);
  const edited = await api(`/api/dms/messages/${envelope.id}`, "u1", {
    method: "PATCH",
    body: { envelope: sealFor("u1", "u2", "second", envelope.id) },
  });
  assert.equal(edited.status, 200);
  const stored = db.sqlite.prepare("SELECT envelope FROM decave_direct_messages WHERE id=?").get(envelope.id);
  assert.notEqual(JSON.parse(stored.envelope).c, envelope.c);
});

test("reactions and poll votes on encrypted DMs are encrypted too", async () => {
  const envelope = sealFor("u1", "u2", '__DECAVE_POLL__{"question":"map?","options":["a","b"]}');
  await api(`/api/dms/${publicId("u2")}`, "u1", { method: "POST", body: { envelope } });
  const path = `/api/dms/messages/${envelope.id}/reactions`;
  // Plaintext reactions would tell the server the vote.
  const plain = await api(path, "u2", { method: "POST", body: { emoji: "poll_0" } });
  assert.equal(plain.data.code, "DM_E2EE_REQUIRED");

  const sealReaction = (emojis, overrides = {}) =>
    crypto.sealReactions({
      messageId: envelope.id,
      from: publicId("u2"),
      to: publicId("u1"),
      emojis,
      sender: keys.get("u2").account,
      recipientKey: crypto.publicKeyOf(keys.get("u1").account),
      ...overrides,
    });
  const voted = await api(path, "u2", { method: "POST", body: { envelope: sealReaction(["poll_1", "🔥"]) } });
  assert.equal(voted.status, 200, JSON.stringify(voted.data));
  assert.deepEqual(voted.data.message.reactions, {});
  assert.equal(voted.data.message.reactionEnvelopes.length, 1);
  const stored = db.sqlite
    .prepare("SELECT envelope FROM decave_dm_reaction_envelopes WHERE message_id=?")
    .get(envelope.id);
  assert.ok(!stored.envelope.includes("poll_1"));
  const opened = crypto.openReactions({
    envelope: voted.data.message.reactionEnvelopes[0],
    reader: keys.get("u1").account,
    senderKey: crypto.publicKeyOf(keys.get("u2").account),
    expected: { messageId: envelope.id, from: publicId("u2"), to: publicId("u1") },
  });
  assert.deepEqual(opened, ["poll_1", "🔥"]);

  // A new envelope replaces the old one; null removes it.
  await api(path, "u2", { method: "POST", body: { envelope: sealReaction(["poll_0"]) } });
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM decave_dm_reaction_envelopes").get().n, 1);
  // Addressed to another message, from someone else, or to a stale key: refused.
  const wrongMessage = await api(path, "u2", {
    method: "POST",
    body: { envelope: sealReaction(["👍"], { messageId: randomUUID() }) },
  });
  assert.equal(wrongMessage.data.code, "DM_E2EE_INVALID");
  const impostor = await api(path, "u1", { method: "POST", body: { envelope: sealReaction(["👍"]) } });
  assert.equal(impostor.data.code, "DM_E2EE_INVALID");
  const stale = await api(path, "u2", {
    method: "POST",
    body: {
      envelope: sealReaction(["👍"], {
        recipientKey: crypto.publicKeyOf(crypto.deriveAccountKeys(crypto.generateAccountSeed())),
      }),
    },
  });
  assert.equal(stale.data.code, "DM_E2EE_STALE_KEY");
  const cleared = await api(path, "u2", { method: "POST", body: { envelope: null } });
  assert.equal(cleared.data.message.reactionEnvelopes.length, 0);

  // Deleting the message deletes its reactions.
  await api(path, "u2", { method: "POST", body: { envelope: sealReaction(["👍"]) } });
  await api(`/api/dms/messages/${envelope.id}`, "u1", { method: "DELETE" });
  assert.equal(
    db.sqlite.prepare("SELECT COUNT(*) AS n FROM decave_dm_reaction_envelopes WHERE message_id=?").get(envelope.id).n,
    0,
  );
});

test("attachment uploads are typed from their bytes, and encrypted ones stay opaque", async () => {
  const upload = (body, fileType) =>
    handleApi(
      new Request(`https://test.invalid/api/dms/${publicId("u2")}/attachments`, {
        method: "POST",
        headers: {
          authorization: "Bearer token-u1-a",
          "Content-Type": "application/octet-stream",
          "X-File-Name": "file",
          "X-File-Type": fileType,
        },
        body,
      }),
      env,
    );
  const stored = async (response) => {
    const { attachment } = await response.json();
    const key = attachment.url.replace("/uploads/", "");
    return { attachment, key, metadata: env.MEDIA.metadata.get(key), bytes: env.MEDIA.objects.get(key) };
  };
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

  // An encrypted photo: ciphertext declared as an opaque blob is stored untouched.
  const { fileKey, ciphertext } = crypto.encryptAttachment(png);
  const encrypted = await stored(await upload(ciphertext, "application/octet-stream"));
  assert.equal(encrypted.attachment.mimeType, "application/octet-stream");
  assert.equal(encrypted.metadata.contentType, "application/octet-stream");
  assert.deepEqual(crypto.decryptAttachment(new Uint8Array(encrypted.bytes), fileKey), png);
  // Even ciphertext that happens to start like an MP3 frame is not relabelled.
  const lookalike = await stored(await upload(new Uint8Array([0xff, 0xfb, 9, 9, 9]), "application/octet-stream"));
  assert.equal(lookalike.metadata.contentType, "application/octet-stream");

  // Plaintext uploads: the declared type is not trusted.
  const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
  const spoofed = await upload(html, "image/png");
  assert.equal(spoofed.status, 415);
  assert.equal((await stored(await upload(html, "text/html"))).metadata.contentType, "application/octet-stream");
  const realPng = await stored(await upload(png, "text/html"));
  assert.equal(realPng.metadata.contentType, "image/png");
  assert.equal(realPng.attachment.mimeType, "image/png");
});

test("encrypted DMs list their uploads so cleanup keeps them, and deleting removes them", async () => {
  const upload = async (userId, target) => {
    const response = await handleApi(
      new Request(`https://test.invalid/api/dms/${publicId(target)}/attachments`, {
        method: "POST",
        headers: { authorization: `Bearer token-${userId}-a`, "X-File-Name": "encrypted" },
        body: new Uint8Array([1, 2, 3]),
      }),
      env,
    );
    return (await response.json()).attachment.url.replace("/uploads/", "");
  };
  const key = await upload("u1", "u2");
  const theirs = await upload("u2", "u1");
  const envelope = sealFor("u1", "u2", "photo");
  const refused = await api(`/api/dms/${publicId("u2")}`, "u1", {
    method: "POST",
    body: { envelope, attachmentKeys: [theirs] },
  });
  assert.equal(refused.data.code, "DM_E2EE_INVALID", "someone else's upload can't be claimed");
  const sent = await api(`/api/dms/${publicId("u2")}`, "u1", {
    method: "POST",
    body: { envelope, attachmentKeys: [key] },
  });
  assert.equal(sent.status, 201);
  assert.equal(
    db.sqlite.prepare("SELECT attachment_refs FROM decave_direct_messages WHERE id=?").get(envelope.id).attachment_refs,
    key,
  );
  // The retention sweep's query no longer counts it as orphaned.
  const orphaned = db.sqlite
    .prepare(
      `SELECT access.r2_key FROM decave_attachment_access access
       WHERE access.r2_key=? AND NOT EXISTS(
         SELECT 1 FROM decave_direct_messages dm
         WHERE dm.from_user_id=access.owner_user_id
           AND (instr(dm.text, access.r2_key)>0 OR instr(COALESCE(dm.attachment_refs, ''), access.r2_key)>0))`,
    )
    .all(key);
  assert.equal(orphaned.length, 0);
  assert.ok(await env.MEDIA.get(key));
  await api(`/api/dms/messages/${envelope.id}`, "u1", { method: "DELETE" });
  assert.equal(await env.MEDIA.get(key), null);
});

test("an upload revoked after validation cannot be attached by a racing DM send", async () => {
  const upload = await handleApi(
    new Request(`https://test.invalid/api/dms/${publicId("u2")}/attachments`, {
      method: "POST",
      headers: { authorization: "Bearer token-u1-a", "X-File-Name": "racing-upload" },
      body: new Uint8Array([7, 8, 9]),
    }),
    env,
  );
  const key = (await upload.json()).attachment.url.replace("/uploads/", "");
  const envelope = sealFor("u1", "u2", "racing attachment");
  const originalPrepare = db.prepare;
  const accessSql =
    "SELECT 1 FROM decave_attachment_access WHERE r2_key=? AND kind='dm' AND owner_user_id=? AND peer_user_id=?";
  let revoked = false;
  db.prepare = function (sql) {
    const statement = originalPrepare.call(this, sql);
    if (sql !== accessSql) return statement;
    let bound;
    return {
      bind(...values) {
        bound = statement.bind(...values);
        return this;
      },
      async first() {
        const row = await bound.first();
        if (row && !revoked) {
          // Simulate deletion committing after ownership validation and before
          // the conditional message insert executes.
          db.exec(
            "DELETE FROM decave_attachment_access WHERE r2_key=? AND kind='dm' AND owner_user_id=? AND peer_user_id=?",
            key,
            "u1",
            "u2",
          );
          revoked = true;
        }
        return row;
      },
    };
  };
  let result;
  try {
    result = await api(`/api/dms/${publicId("u2")}`, "u1", {
      method: "POST",
      body: { envelope, attachmentKeys: [key] },
    });
  } finally {
    db.prepare = originalPrepare;
  }
  assert.equal(revoked, true, "the test removed the access row between validation and insertion");
  assert.equal(result.status, 400);
  assert.equal(result.data.code, "DM_E2EE_INVALID");
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_direct_messages WHERE id=?", envelope.id), 0);
});

test("deleting one of two encrypted DMs that carry the same upload keeps the file", async () => {
  const response = await handleApi(
    new Request(`https://test.invalid/api/dms/${publicId("u2")}/attachments`, {
      method: "POST",
      headers: { authorization: `Bearer token-u1-a`, "X-File-Name": "encrypted" },
      body: new Uint8Array([4, 5, 6]),
    }),
    env,
  );
  const key = (await response.json()).attachment.url.replace("/uploads/", "");
  const first = sealFor("u1", "u2", "photo");
  const second = sealFor("u1", "u2", "photo again");
  for (const envelope of [first, second])
    assert.equal(
      (await api(`/api/dms/${publicId("u2")}`, "u1", { method: "POST", body: { envelope, attachmentKeys: [key] } }))
        .status,
      201,
    );
  await api(`/api/dms/messages/${first.id}`, "u1", { method: "DELETE" });
  assert.ok(await env.MEDIA.get(key), "the other message still carries the file");
  await api(`/api/dms/messages/${second.id}`, "u1", { method: "DELETE" });
  assert.equal(await env.MEDIA.get(key), null);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM decave_media_deletion_queue").get().n, 0);
});

test("DM deletion retries when an edit changes attachment refs after its pre-read", async () => {
  const upload = async () => {
    const response = await handleApi(
      new Request(`https://test.invalid/api/dms/${publicId("u2")}/attachments`, {
        method: "POST",
        headers: { authorization: "Bearer token-u1-a", "X-File-Name": "delete-race" },
        body: new Uint8Array([1, 2, 3]),
      }),
      env,
    );
    return (await response.json()).attachment.url.replace("/uploads/", "");
  };
  const originalKey = await upload();
  const editedKey = await upload();
  const original = sealFor("u1", "u2", "original attachment");
  assert.equal(
    (
      await api(`/api/dms/${publicId("u2")}`, "u1", {
        method: "POST",
        body: { envelope: original, attachmentKeys: [originalKey] },
      })
    ).status,
    201,
  );

  const originalPrepare = db.prepare;
  let editCommitted = false;
  db.prepare = function (sql) {
    const statement = originalPrepare.call(this, sql);
    if (
      editCommitted ||
      !sql.includes("SELECT id, from_user_id, to_user_id, text, envelope, created_at, attachment_refs") ||
      !sql.includes("FROM decave_direct_messages")
    )
      return statement;
    let bound;
    return {
      bind(...values) {
        bound = statement.bind(...values);
        return this;
      },
      async first() {
        const row = await bound.first();
        if (row && !editCommitted) {
          editCommitted = true;
          const edited = sealFor("u1", "u2", "edited attachment", original.id);
          const result = await api(`/api/dms/messages/${original.id}`, "u1", {
            method: "PATCH",
            body: { envelope: edited, attachmentKeys: [editedKey] },
          });
          assert.equal(result.status, 200, JSON.stringify(result.data));
        }
        return row;
      },
    };
  };
  let deletion;
  try {
    deletion = await api(`/api/dms/messages/${original.id}`, "u1", { method: "DELETE" });
  } finally {
    db.prepare = originalPrepare;
  }

  assert.equal(editCommitted, true, "the edit commits after deletion's pre-read");
  assert.equal(deletion.status, 409, "deletion detects that its attachment snapshot is stale");
  assert.equal(db.scalar("SELECT attachment_refs FROM decave_direct_messages WHERE id=?", original.id), editedKey);
  assert.ok(await env.MEDIA.get(editedKey), "the edited upload remains accessible until retry");
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_media_deletion_queue"), 0);

  const retried = await api(`/api/dms/messages/${original.id}`, "u1", { method: "DELETE" });
  assert.equal(retried.status, 200);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_direct_messages WHERE id=?", original.id), 0);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_attachment_access WHERE r2_key=?", editedKey), 0);
  assert.equal(await env.MEDIA.get(editedKey), null);
});

test("the WebSocket send path enforces the same rules", async () => {
  const { socket, room, sockets } = socketFor("u1");
  const senderOtherDevice = socketFor("u1", "b").socket;
  const recipient = socketFor("u2").socket;
  sockets.push(senderOtherDevice, recipient);

  const dmClientMessageId = "dm-attempt-9a8b";
  await room.webSocketMessage(
    socket,
    JSON.stringify({
      type: "DM_MESSAGE",
      targetUserId: publicId("u2"),
      text: "hi",
      clientMessageId: dmClientMessageId,
    }),
  );
  const refused = socket.sent.find((event) => event.type === "DM_ERROR");
  assert.equal(refused?.code, "DM_E2EE_REQUIRED");
  assert.equal(refused?.targetUserId, publicId("u2"));
  assert.equal(refused?.clientMessageId, dmClientMessageId);
  assert.equal("peerAddress" in socket.attachment, false, "legacy peer addresses are stripped from socket attachments");

  for (const candidate of sockets) candidate.sent.length = 0;
  const envelope = sealFor("u1", "u2", "over the socket");
  await room.webSocketMessage(
    socket,
    JSON.stringify({
      type: "DM_MESSAGE",
      targetUserId: publicId("u2"),
      envelope,
      clientMessageId: dmClientMessageId,
    }),
  );
  const delivered = socket.sent.find((event) => event.type === "DM_MESSAGE");
  assert.equal(delivered?.message.id, envelope.id);
  assert.equal(delivered.message.text, "");
  assert.equal(delivered.message.envelope.c, envelope.c);
  assert.equal(delivered?.clientMessageId, dmClientMessageId);
  assert.equal(senderOtherDevice.sent.find((event) => event.type === "DM_MESSAGE")?.clientMessageId, dmClientMessageId);
  const recipientDelivery = recipient.sent.find((event) => event.type === "DM_MESSAGE");
  assert.equal(recipientDelivery?.message.id, envelope.id);
  assert.equal("clientMessageId" in recipientDelivery, false, "the sender's retry token is not sent to the peer");

  for (const candidate of sockets) candidate.sent.length = 0;
  await room.webSocketMessage(
    socket,
    JSON.stringify({
      type: "DM_MESSAGE",
      targetUserId: publicId("u2"),
      text: "hi",
      clientMessageId: "not a valid client id",
    }),
  );
  const uncorrelated = socket.sent.find((event) => event.type === "DM_ERROR");
  assert.equal(uncorrelated?.code, "DM_E2EE_REQUIRED");
  assert.equal("clientMessageId" in uncorrelated, false, "unbounded/unsafe retry ids are ignored");
});

test("a new device gets the key from an existing device, once", async () => {
  const link = crypto.generateLinkKeyPair();
  const created = await api("/api/dm-keys/link-requests", "u1", {
    method: "POST",
    device: "b",
    body: { linkPublicKey: link.publicKey, client: "web" },
  });
  assert.equal(created.status, 201);
  const requestId = created.data.request.id;
  assert.ok(broadcasts.some((event) => event.event?.type === "DM_LINK_REQUEST" || event.type === "DM_LINK_REQUEST"));

  // The requester cannot approve itself, and another account cannot see it.
  const listed = await api("/api/dm-keys/link-requests", "u1");
  const pending = listed.data.requests.find((request) => request.id === requestId);
  assert.equal(pending.fromThisDevice, false);
  assert.equal((await api(`/api/dm-keys/link-requests/${requestId}`, "u2", { device: "b" })).status, 404);
  const sealed = crypto.sealForLinkedDevice(keys.get("u1").account, pending.linkPublicKey, publicId("u1"), requestId);
  const selfApprove = await api(`/api/dm-keys/link-requests/${requestId}/approve`, "u1", {
    method: "POST",
    device: "b",
    body: { sealed },
  });
  assert.equal(selfApprove.status, 403);

  // Only the requesting session can collect it.
  assert.equal((await api(`/api/dm-keys/link-requests/${requestId}`, "u1", { device: "a" })).status, 404);
  const waiting = await api(`/api/dm-keys/link-requests/${requestId}`, "u1", { device: "b" });
  assert.equal(waiting.data.status, "pending");

  const approved = await api(`/api/dm-keys/link-requests/${requestId}/approve`, "u1", {
    method: "POST",
    body: { sealed },
  });
  assert.equal(approved.status, 200);
  const collected = await api(`/api/dm-keys/link-requests/${requestId}`, "u1", { device: "b" });
  assert.equal(collected.data.status, "approved");
  const linked = crypto.openFromLinkingDevice(collected.data.sealed, link.secret, publicId("u1"), requestId);
  assert.equal(linked[0].keyId, keys.get("u1").account.keyId);
  // Collected once: the sealed key is gone from the server.
  assert.equal((await api(`/api/dm-keys/link-requests/${requestId}`, "u1", { device: "b" })).status, 404);
});

test("the recovery backup unlocks the key, and resetting needs the password", async () => {
  const me = await api("/api/dm-keys/me", "u1", { device: "b" });
  const restored = crypto.openKeyBackup(me.data.backup, keys.get("u1").code, publicId("u1"));
  assert.equal(restored[0].keyId, keys.get("u1").account.keyId);

  const next = crypto.deriveAccountKeys(crypto.generateAccountSeed());
  const code = crypto.generateRecoveryCode();
  const body = { key: crypto.publicKeyOf(next), backup: crypto.sealKeyBackup(next, code, publicId("u1")) };
  assert.equal((await api("/api/dm-keys/me", "u1", { method: "POST", body })).data.code, "DM_KEY_EXISTS");
  const wrong = await api("/api/dm-keys/me", "u1", {
    method: "POST",
    body: { ...body, reset: true, currentPassword: "nope" },
  });
  assert.equal(wrong.status, 403);
  const reset = await api("/api/dm-keys/me", "u1", {
    method: "POST",
    body: { ...body, reset: true, currentPassword: PASSWORD },
  });
  assert.equal(reset.status, 201);

  // Friends are told, the old key stays published (retired) so old messages still verify.
  assert.ok(broadcasts.some((event) => JSON.stringify(event).includes("DM_KEYS_CHANGED")));
  const published = await api(`/api/dm-keys/users/${publicId("u1")}`, "u2");
  assert.equal(published.data.current.keyId, next.keyId);
  assert.ok(published.data.keys.some((key) => key.keyId === keys.get("u1").account.keyId && key.retiredAt));

  // A message sealed to the retired key is now refused.
  const stale = await api(`/api/dms/${publicId("u1")}`, "u2", {
    method: "POST",
    body: {
      envelope: sealFor("u2", "u1", "old key", undefined, undefined, crypto.publicKeyOf(keys.get("u1").account)),
    },
  });
  assert.equal(stale.data.code, "DM_E2EE_STALE_KEY");
});

test("the data export never contains encrypted message text", async () => {
  const exported = await api("/api/account/export", "u1");
  assert.equal(exported.status, 200, JSON.stringify(exported.data));
  const body = JSON.stringify(exported.data);
  assert.ok(body.includes("[end-to-end encrypted]"));
  assert.ok(body.includes("before encryption"));
  // Encrypted messages are exported as their stored envelope (ciphertext), never decrypted.
  assert.ok(
    exported.data.directMessagesSent.some((message) => typeof message.envelope === "string" && message.envelope),
  );
  assert.equal(exported.data.complete, true);
});

test("push notifications for encrypted DMs never quote the message", async () => {
  const { dmPushText } = await import("../../worker/lib/dm-e2ee.ts");
  assert.equal(dmPushText({ text: "", envelope: "{}" }), "Sent you an encrypted message");
  assert.equal(dmPushText({ text: "plain", envelope: null }), "plain");
});

// ---------------------------------------------------------------- whole-device flows
// DmE2eeSession is what the apps run. These drive it through the real Worker.

const { DmE2eeSession } = await import("../../shared/dm-e2ee-session.ts");

// Local storage per (account, device), so the same "phone" keeps its key between tests.
const deviceStores = new Map();
function device(userId, deviceName, options = {}) {
  const storeKey = `${userId}/${deviceName}`;
  if (!deviceStores.has(storeKey)) deviceStores.set(storeKey, { seeds: new Map(), state: { pins: {} } });
  const store = deviceStores.get(storeKey);
  const seeds = store.seeds;
  // A real session row per device, so link requests know who asked.
  db.exec(
    "INSERT OR IGNORE INTO decave_sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)",
    hashToken(`token-${userId}-${deviceName}`),
    userId,
    "2100-01-01T00:00:00.000Z",
    now,
  );
  const session = new DmE2eeSession({
    client: "web",
    request: async (path, init = {}) => {
      const result = await api(path, userId, { method: init.method ?? "GET", body: init.body, device: deviceName });
      return { ok: result.status >= 200 && result.status < 300, status: result.status, data: result.data ?? {} };
    },
    loadKeyring: async (accountId) => seeds.get(accountId) ?? null,
    saveKeyring: async (accountId, keyring) => void seeds.set(accountId, keyring),
    forgetKeyring: async (accountId) => void seeds.delete(accountId),
    loadDeviceState: async () => store.state,
    saveDeviceState: async (_accountId, next) => void (store.state = next),
    ...options,
  });
  return session;
}

async function until(check, label) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`timed out waiting for ${label}`);
}

test("a fresh account sets up on its first device, then other devices unlock or get approved", async () => {
  db.exec("INSERT INTO decave_friendships(user_a,user_b,created_at) VALUES('u3','u4',?)", now);
  const phone = device("u3", "phone");
  await phone.start(publicId("u3"));
  assert.equal(phone.getState().status, "ready");
  const code = phone.getState().pendingRecoveryCode;
  assert.ok(code, "the first device shows a recovery code");
  phone.acknowledgeRecoveryCode();

  // A laptop signing in later is locked until it gets the key.
  const laptop = device("u3", "laptop");
  await laptop.start(publicId("u3"));
  assert.equal(laptop.getState().status, "locked");
  assert.equal(laptop.getState().pendingRecoveryCode, null);
  await assert.rejects(laptop.unlockWithRecoveryCode(code.replace(/^./, code[0] === "A" ? "B" : "A")));
  await laptop.unlockWithRecoveryCode(code);
  assert.equal(laptop.getState().status, "ready");
  assert.equal(laptop.getState().keyId, phone.getState().keyId);

  // A browser gets it by approval; both screens show the same comparison code.
  const browser = device("u3", "browser");
  await browser.start(publicId("u3"));
  await browser.requestLink();
  await phone.refreshApprovals();
  const [approval] = phone.getState().approvals;
  assert.equal(approval.code, browser.getState().link.code);
  await phone.answerApproval(approval.id, true);
  browser.handleRealtimeEvent({ type: "DM_LINK_RESOLVED" });
  await until(() => browser.getState().status === "ready", "the browser to be approved");
  assert.equal(browser.getState().keyId, phone.getState().keyId);
});

test("two accounts exchange encrypted messages, history included, across devices", async () => {
  const u4 = device("u4", "desktop");
  await u4.start(publicId("u4"));
  const u3 = device("u3", "phone2");
  await u3.start(publicId("u3"));
  // u3's phone2 is a new device: locked, so it can't send to an encrypted peer.
  assert.equal(u3.getState().status, "locked");
  await assert.rejects(u3.seal(publicId("u4"), "hello"), /Unlock/);

  const sealed = await u4.seal(publicId("u3"), "see you at 8");
  assert.ok(sealed.envelope);
  const sent = await api(`/api/dms/${publicId("u3")}`, "u4", {
    method: "POST",
    device: "a",
    body: { envelope: sealed.envelope },
  });
  assert.equal(sent.status, 201);

  // Locked devices show a placeholder rather than failing.
  const locked = await u3.open(sent.data.message);
  assert.equal(locked.e2ee, "locked");
  assert.equal(locked.text, "");

  // After unlocking, the same stored message reads fine, and so do the sender's own devices.
  const code = await (async () => {
    const owner = device("u3", "phone");
    await owner.start(publicId("u3"));
    await owner.replaceRecoveryCode();
    return owner.getState().pendingRecoveryCode;
  })();
  await u3.unlockWithRecoveryCode(code);
  const read = await u3.open(sent.data.message);
  assert.deepEqual([read.e2ee, read.text], ["encrypted", "see you at 8"]);
  const own = await u4.open(sent.data.message);
  assert.equal(own.text, "see you at 8");

  // Plaintext history from before encryption is passed through, marked as such.
  const old = await u3.open({
    id: "old",
    fromUserId: publicId("u4"),
    toUserId: publicId("u3"),
    text: "hi",
    envelope: null,
  });
  assert.equal(old.e2ee, "plaintext");

  const info = await u3.conversationInfo(publicId("u4"));
  const other = await u4.conversationInfo(publicId("u3"));
  assert.equal(info.encrypted, true);
  assert.equal(info.safetyNumber, other.safetyNumber);
});

test("a peer's key change is flagged until acknowledged, and their new key is used", async () => {
  const u4 = device("u4", "desktop2");
  const seedHolder = device("u4", "desktop");
  await seedHolder.start(publicId("u4"));
  const u3 = device("u3", "phone");
  await u3.start(publicId("u3"));
  await u3.conversationInfo(publicId("u4"));
  const before = u3.getState().pins[publicId("u4")];
  assert.equal(before.changed, false);

  await u4.start(publicId("u4"));
  await u4.resetKey(PASSWORD);
  assert.ok(u4.getState().pendingRecoveryCode);
  u3.handleRealtimeEvent({ type: "DM_KEYS_CHANGED", userId: publicId("u4") });
  const sealed = await u3.seal(publicId("u4"), "new key?");
  assert.ok(sealed.envelope.w.some((wrap) => wrap.k === u4.getState().keyId));
  assert.equal(u3.getState().pins[publicId("u4")].changed, true);
  await u3.acknowledgeKeyChange(publicId("u4"));
  assert.equal(u3.getState().pins[publicId("u4")].changed, undefined);

  // The device still holding the old key notices the reset and locks itself.
  seedHolder.handleRealtimeEvent({ type: "DM_KEYS_CHANGED", userId: publicId("u4") });
  await until(() => seedHolder.getState().status === "locked", "the old device to lock");
});

test("signing out with forget removes the key from the device", async () => {
  const laptop = device("u3", "laptop");
  await laptop.start(publicId("u3"));
  assert.equal(laptop.getState().status, "ready", "the laptop kept its key from earlier");
  await laptop.stop({ forget: true });
  await laptop.start(publicId("u3"));
  assert.equal(laptop.getState().status, "locked");
});

test("a recovery code that was never confirmed is replaced, and shown again, on the next start", async () => {
  db.exec(
    `INSERT INTO decave_users(id,username,password_salt,password_hash,created_at,public_id,email,email_normalized,email_verified_at)
     VALUES('u5','user-u5',?,?,?,?,'u5@example.test','u5@example.test',?)`,
    SALT,
    scryptSync(PASSWORD, SALT, 64).toString("hex"),
    now,
    publicId("u5"),
    now,
  );
  const first = device("u5", "desktop");
  await first.start(publicId("u5"));
  const unseen = first.getState().pendingRecoveryCode;
  assert.ok(unseen);
  // The app closes before the code is confirmed.
  await first.stop({ forget: false });

  const again = device("u5", "desktop");
  await again.start(publicId("u5"));
  await until(() => again.getState().pendingRecoveryCode, "a fresh code");
  const fresh = again.getState().pendingRecoveryCode;
  assert.notEqual(fresh, unseen);
  again.acknowledgeRecoveryCode();

  // Only the code that was shown last works.
  const other = device("u5", "laptop");
  await other.start(publicId("u5"));
  await assert.rejects(other.unlockWithRecoveryCode(unseen));
  await other.unlockWithRecoveryCode(fresh);

  // Once confirmed, restarting doesn't produce another code.
  const third = device("u5", "desktop");
  await third.start(publicId("u5"));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(third.getState().pendingRecoveryCode, null);
});

test("a message from one conversation can't be shown in another", async () => {
  const u4 = device("u4", "desktop2");
  await u4.start(publicId("u4"));
  const u3 = device("u3", "phone");
  await u3.start(publicId("u3"));
  const sealed = await u4.seal(publicId("u3"), "only for u3, from u4");
  const message = {
    id: sealed.envelope.id,
    fromUserId: publicId("u4"),
    toUserId: publicId("u3"),
    text: "",
    envelope: sealed.envelope,
  };
  assert.equal((await u3.open(message, publicId("u4"))).text, "only for u3, from u4");
  // The server presents it inside u3's conversation with u1: refused.
  const misplaced = await u3.open(message, publicId("u1"));
  assert.deepEqual([misplaced.e2ee, misplaced.text], ["failed", ""]);
});

test("reply links of encrypted messages stay inside the ciphertext, and edits keep them", async () => {
  const u4 = device("u4", "desktop2");
  await u4.start(publicId("u4"));
  const u3 = device("u3", "phone");
  await u3.start(publicId("u3"));
  const original = await u4.seal(publicId("u3"), "first");
  const reply = await u3.seal(publicId("u4"), "replying", { replyToId: original.envelope.id });
  const sent = await api(`/api/dms/${publicId("u4")}`, "u3", { method: "POST", body: { envelope: reply.envelope } });
  assert.equal(sent.status, 201);
  assert.equal(sent.data.message.replyToId, null, "the server stores no reply link");
  const opened = await u4.open(sent.data.message, publicId("u3"));
  assert.equal(opened.replyToId, original.envelope.id);
  // Editing the reply keeps its link without being told again.
  const edit = await u3.seal(publicId("u4"), "replying (edited)", { id: reply.envelope.id });
  const reopened = await u4.open({ ...sent.data.message, envelope: edit.envelope }, publicId("u3"));
  assert.deepEqual([reopened.text, reopened.replyToId], ["replying (edited)", original.envelope.id]);
  // A report proof comes from what this device can read.
  assert.ok(u4.reportProof(sent.data.message));
  assert.equal(u4.reportProof({ ...sent.data.message, envelope: null }), null);
});

// ---------------------------------------------------------------- part 2: rotation, reactions, groups

function addUser(userId) {
  db.exec(
    `INSERT OR IGNORE INTO decave_users(id,username,password_salt,password_hash,created_at,public_id,email,email_normalized,email_verified_at)
     VALUES(?,?,?,?,?,?,?,?,?)`,
    userId,
    `user-${userId}`,
    SALT,
    scryptSync(PASSWORD, SALT, 64).toString("hex"),
    now,
    publicId(userId),
    `${userId}@example.test`,
    `${userId}@example.test`,
    now,
  );
  db.exec(
    "INSERT OR IGNORE INTO decave_sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)",
    hashToken(`token-${userId}-a`),
    userId,
    "2100-01-01T00:00:00.000Z",
    now,
  );
}

function befriend(a, b) {
  const [first, second] = [a, b].sort();
  db.exec("INSERT OR IGNORE INTO decave_friendships(user_a,user_b,created_at) VALUES(?,?,?)", first, second, now);
}

async function ready(userId, deviceName, options) {
  const session = device(userId, deviceName, options);
  await session.start(publicId(userId));
  if (session.getState().pendingRecoveryCode) session.acknowledgeRecoveryCode();
  return session;
}

const DAY = 24 * 60 * 60_000;

test("keys rotate: other devices follow, peers see no warning, history stays readable", async () => {
  for (const id of ["u6", "u7"]) addUser(id);
  befriend("u6", "u7");
  const phone = await ready("u6", "phone");
  const code = await (async () => {
    await phone.replaceRecoveryCode();
    const shown = phone.getState().pendingRecoveryCode;
    phone.acknowledgeRecoveryCode();
    return shown;
  })();
  const laptop = device("u6", "laptop");
  await laptop.start(publicId("u6"));
  await laptop.unlockWithRecoveryCode(code);
  const friend = await ready("u7", "desktop");
  const before = await friend.conversationInfo(publicId("u6"));
  const oldKeyId = phone.getState().keyId;

  // An old message, sealed with the key that is about to be replaced.
  const old = await phone.seal(publicId("u7"), "from before the rotation");
  const oldSent = await api(`/api/dms/${publicId("u7")}`, "u6", { method: "POST", body: { envelope: old.envelope } });

  // A month later the phone rotates on start.
  const later = device("u6", "phone", { now: () => Date.now() + 31 * DAY });
  await later.start(publicId("u6"));
  const newKeyId = later.getState().keyId;
  assert.notEqual(newKeyId, oldKeyId);
  const published = await api(`/api/dm-keys/users/${publicId("u6")}`, "u7");
  assert.equal(published.data.current.keyId, newKeyId);
  assert.equal(published.data.current.previousKeyId, oldKeyId);

  // The laptop picks up the new key from the sealed successor, no approval needed.
  laptop.handleRealtimeEvent({ type: "DM_KEYS_CHANGED", userId: publicId("u6") });
  await until(() => laptop.getState().keyId === newKeyId, "the laptop to follow the rotation");
  assert.equal(laptop.getState().status, "ready");

  // The friend sees the same safety number and no key-change warning.
  friend.handleRealtimeEvent({ type: "DM_KEYS_CHANGED", userId: publicId("u6") });
  const after = await friend.conversationInfo(publicId("u6"));
  assert.equal(after.safetyNumber, before.safetyNumber);
  assert.equal(friend.getState().pins[publicId("u6")].changed, false);
  const fresh = await friend.seal(publicId("u6"), "to the new key");
  assert.ok(fresh.envelope.w.some((wrap) => wrap.k === newKeyId));

  // Both of u6's devices still read the old message.
  assert.equal((await laptop.open(oldSent.data.message)).text, "from before the rotation");
  assert.equal((await later.open(oldSent.data.message)).text, "from before the rotation");

  // The recovery backup was updated for the same code and holds both keys.
  const me = await api("/api/dm-keys/me", "u6");
  assert.deepEqual(me.data.backup.keys, [newKeyId, oldKeyId]);
  const restored = crypto.openKeyBackup(me.data.backup, code, publicId("u6"));
  assert.deepEqual(
    restored.map((keys) => keys.keyId),
    [newKeyId, oldKeyId],
  );

  // A device that missed the rotation catches up when it starts.
  const tablet = device("u6", "tablet");
  await tablet.start(publicId("u6"));
  await tablet.unlockWithRecoveryCode(code);
  assert.equal((await tablet.open(oldSent.data.message)).text, "from before the rotation");
});

test("the server only accepts a rotation signed by the current key", async () => {
  const me = await api("/api/dm-keys/me", "u6");
  const currentId = me.data.key.keyId;
  const forger = crypto.deriveAccountKeys(crypto.generateAccountSeed());
  const { next, certificate, sealedForPrevious } = crypto.rotateAccountKey(forger, publicId("u6"));
  const body = { key: crypto.publicKeyOf(next), previousKeyId: currentId, certificate, sealedForPrevious };
  const forged = await api("/api/dm-keys/me/rotate", "u6", { method: "POST", body });
  assert.equal(forged.status, 400);
  const stale = await api("/api/dm-keys/me/rotate", "u6", {
    method: "POST",
    body: { ...body, previousKeyId: forger.keyId },
  });
  assert.equal(stale.data.code, "DM_KEY_STALE");
});

test("a shorter history setting drops old keys, so old messages can't be read any more", async () => {
  const phone = device("u6", "phone", { now: () => Date.now() + 31 * DAY });
  await phone.start(publicId("u6"));
  const oldMessage = (await api(`/api/dms/${publicId("u7")}`, "u6")).data.messages.find(
    (message) => message.envelope && message.fromUserId === publicId("u6"),
  );
  assert.equal((await phone.open(oldMessage)).e2ee, "encrypted");
  await phone.setHistoryDays(30);
  assert.equal(phone.getState().historyDays, 30);
  // The key was retired today; 31 days on, it is past the 30-day window.
  assert.equal((await phone.open(oldMessage)).e2ee, "locked");
  const me = await api("/api/dm-keys/me", "u6");
  assert.equal(me.data.historyDays, 30);
  assert.equal(me.data.backup.keys.length, 1, "the backup no longer holds the dropped key");
  assert.equal((await api("/api/dm-keys/me/settings", "u6", { method: "PUT", body: { historyDays: 7 } })).status, 400);
  await phone.setHistoryDays(null);
});

test("encrypted reactions round-trip through the session", async () => {
  const u6 = await ready("u6", "phone");
  const u7 = await ready("u7", "desktop");
  const poll = await u6.seal(publicId("u7"), '__DECAVE_POLL__{"question":"tonight?","options":["yes","no"]}');
  const sent = await api(`/api/dms/${publicId("u7")}`, "u6", { method: "POST", body: { envelope: poll.envelope } });
  const message = sent.data.message;
  const { toggledReactions } = await import("../../shared/dm-e2ee-session.ts");
  let shown = await u7.open(message, publicId("u6"));
  const vote = toggledReactions(shown.reactions, publicId("u7"), "poll_0");
  const voted = await api(`/api/dms/messages/${message.id}/reactions`, "u7", {
    method: "POST",
    body: { envelope: await u7.sealReactions(publicId("u6"), message.id, vote) },
  });
  shown = await u6.open(voted.data.message, publicId("u6") === publicId("u6") ? publicId("u7") : undefined);
  assert.deepEqual(shown.reactions, { poll_0: [publicId("u7")] });
  // Changing the vote replaces it.
  const change = toggledReactions(shown.reactions, publicId("u7"), "poll_1");
  assert.deepEqual(change, ["poll_1"]);
  const changed = await api(`/api/dms/messages/${message.id}/reactions`, "u7", {
    method: "POST",
    body: { envelope: await u7.sealReactions(publicId("u6"), message.id, [...change, "🎉"]) },
  });
  assert.deepEqual((await u6.open(changed.data.message, publicId("u7"))).reactions, {
    poll_1: [publicId("u7")],
    "🎉": [publicId("u7")],
  });
  // A reaction envelope moved onto another message is ignored.
  const other = await u6.seal(publicId("u7"), "another");
  const moved = {
    id: other.envelope.id,
    fromUserId: publicId("u6"),
    toUserId: publicId("u7"),
    text: "",
    envelope: other.envelope,
    reactionEnvelopes: changed.data.message.reactionEnvelopes,
  };
  assert.deepEqual((await u6.open(moved, publicId("u7"))).reactions, {});
});

test("a voice note's Played mark rides inside the listener's encrypted reactions envelope", async () => {
  addUser("u20");
  addUser("u21");
  befriend("u20", "u21");
  const speaker = await ready("u20", "phone");
  const listener = await ready("u21", "desktop");
  const { createDmE2eeSending } = await import("../../shared/dm-e2ee-sending.ts");
  const sending = createDmE2eeSending(listener);
  const request = async (path, init) => {
    const response = await api(path, "u21", { method: init.method, body: init.body });
    return { ok: response.status < 300, data: response.data };
  };
  const note = await speaker.seal(publicId("u21"), '__DECAVE_DM_ATTACHMENT__{"name":"voice.m4a"}');
  const sent = await api(`/api/dms/${publicId("u21")}`, "u20", { method: "POST", body: { envelope: note.envelope } });
  const message = sent.data.message;
  const broadcastsBefore = broadcasts.length;

  // Not opened on this device yet: its emojis are unknown, so nothing is sent (retried later).
  assert.equal(await sending.sendPlayed(request, message, publicId("u21")), false);
  const opened = await listener.open(message, publicId("u20"));
  assert.equal(await sending.sendPlayed(request, opened, publicId("u21")), true);

  // The server stored an ordinary reactions envelope from an account with no visible emojis.
  const rows = (
    await db.prepare("SELECT envelope FROM decave_dm_reaction_envelopes WHERE message_id=?").bind(message.id).all()
  ).results;
  assert.equal(rows.length, 1);
  assert.doesNotMatch(rows[0].envelope, /"p"|played/i);
  const live = broadcasts
    .slice(broadcastsBefore)
    .map((frame) => frame.payload?.type ?? frame.type ?? frame.message?.type);
  assert.ok(JSON.stringify(broadcasts.slice(broadcastsBefore)).includes("DM_REACTION_UPDATED"), String(live));

  const fresh = (await api(`/api/dms/${publicId("u21")}`, "u20")).data.messages.find((m) => m.id === message.id);
  let seen = await speaker.open(fresh, publicId("u21"));
  assert.deepEqual(seen.reactions, {});
  assert.deepEqual(seen.playedBy, [publicId("u21")], "the sender sees Played");
  // An old client reads only the emojis.
  assert.deepEqual(
    crypto.openReactions({
      envelope: fresh.reactionEnvelopes[0],
      reader: speaker.keyring,
      senderKey: crypto.publicKeyOf(listener.keys),
      expected: { messageId: message.id, from: publicId("u21"), to: publicId("u20") },
    }),
    [],
  );

  // Reacting and un-reacting later keeps the mark (an empty-but-played envelope is stored, not removed).
  let mine = await listener.open(fresh, publicId("u20"));
  assert.deepEqual(mine.playedBy, [publicId("u21")]);
  for (const expected of [{ "👍": [publicId("u21")] }, {}]) {
    const body = await sending.dmReactionBody(mine, publicId("u21"), publicId("u20"), "👍");
    assert.notEqual(body.envelope, null);
    const updated = await api(`/api/dms/messages/${message.id}/reactions`, "u21", { method: "POST", body });
    assert.equal(updated.status, 200);
    seen = await speaker.open(updated.data.message, publicId("u21"));
    assert.deepEqual(seen.reactions, expected);
    assert.deepEqual(seen.playedBy, [publicId("u21")]);
    mine = await listener.open(updated.data.message, publicId("u20"));
  }
});

function socketFor(userId, device = "a") {
  const socket = {
    attachment: {
      connectionId: randomUUID(),
      peerAddress: "test",
      authDeadlineAt: 0,
      client: "web",
      userId,
      sessionHash: hashToken(`token-${userId}-${device}`),
      username: `user-${userId}`,
      serverId: null,
      channelId: null,
      voiceChannelId: null,
      identifiedAt: Date.now(),
      identifyFailures: 0,
      rateLimitViolations: 0,
      lastPresenceTouchAt: Date.now(),
    },
    sent: [],
    serializeAttachment(value) {
      this.attachment = value;
    },
    deserializeAttachment() {
      return this.attachment;
    },
    send(value) {
      this.sent.push(JSON.parse(value));
    },
    close() {},
  };
  const sockets = [socket];
  const ctx = {
    getWebSockets: () => sockets,
    acceptWebSocket() {},
    waitUntil() {},
    storage: { async setAlarm() {}, async deleteAlarm() {}, async get() {}, async put() {} },
  };
  return { socket, room: new HubRoom(ctx, env), sockets };
}

test("restored sockets keep IDENTIFY failures isolated without persisted peer addresses", async () => {
  const restoredSocket = () => {
    let attachment = {
      connectionId: randomUUID(),
      authDeadlineAt: Date.now() + 30_000,
      client: "web",
      userId: null,
      sessionHash: null,
      username: null,
      serverId: 0,
      channelId: 0,
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
      identifiedAt: 0,
      identifyFailures: 0,
      rateLimitViolations: 0,
      lastPresenceTouchAt: 0,
    };
    return {
      sent: [],
      closed: null,
      serializeAttachment(value) {
        attachment = value;
      },
      deserializeAttachment() {
        return attachment;
      },
      send(value) {
        this.sent.push(JSON.parse(value));
      },
      close(code, reason) {
        this.closed = { code, reason };
      },
    };
  };
  const sockets = Array.from({ length: 16 }, restoredSocket);
  const ctx = {
    getWebSockets: () => sockets,
    acceptWebSocket() {},
    waitUntil() {},
    storage: { async setAlarm() {}, async deleteAlarm() {}, async get() {}, async put() {} },
  };
  // A new Durable Object instance has empty in-memory peer-address maps, as it
  // does after hibernation. Restored attachments intentionally hold no address.
  const room = new HubRoom(ctx, env);
  for (const socket of sockets.slice(0, 15)) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await room.webSocketMessage(socket, JSON.stringify({ type: "IDENTIFY", token: "expired-token" }));
    }
    assert.equal(socket.closed?.code, 4003);
  }

  const wsToken = await api("/api/auth/ws-token", "u1", { method: "POST" });
  assert.equal(wsToken.status, 200);
  await room.webSocketMessage(
    sockets[15],
    JSON.stringify({ type: "IDENTIFY", token: wsToken.data.wsToken, client: "web" }),
  );
  assert.equal(sockets[15].closed, null);
  assert.ok(
    sockets[15].sent.some((event) => event.type === "IDENTIFIED"),
    "failures on other restored sockets must not block this socket's valid token",
  );
});

test("group chats encrypt once every member has a key, and stay encrypted", async () => {
  for (const id of ["u8", "u9"]) addUser(id);
  db.exec(
    "INSERT OR IGNORE INTO decave_sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)",
    hashToken("token-u6-b"),
    "u6",
    "2100-01-01T00:00:00.000Z",
    now,
  );
  befriend("u6", "u8");
  befriend("u6", "u9");
  befriend("u6", "u7");
  const created = await api("/api/groups", "u6", {
    method: "POST",
    body: { memberIds: [publicId("u7"), publicId("u8")], name: "squad" },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const groupId = created.data.group.id;
  const members = [publicId("u6"), publicId("u7"), publicId("u8")];
  const u6 = await ready("u6", "phone");
  const { socket, room, sockets } = socketFor("u6");
  const senderOtherDevice = socketFor("u6", "b").socket;
  const groupRecipient = socketFor("u7").socket;
  sockets.push(senderOtherDevice, groupRecipient);
  const send = async (frame) => {
    for (const candidate of sockets) candidate.sent.length = 0;
    await room.webSocketMessage(socket, JSON.stringify({ type: "GROUP_MESSAGE", groupId, ...frame }));
    return socket.sent;
  };

  // u8 has no key yet: the group stays plaintext.
  assert.equal(await u6.groupEncrypted(members, false), false);
  assert.deepEqual(await u6.sealGroup(groupId, members, "plain hello", { markedEncrypted: false }), {
    text: "plain hello",
  });
  assert.equal(
    (await send({ text: "plain hello" })).find((event) => event.type === "GROUP_MESSAGE")?.message.text,
    "plain hello",
  );

  // Once u8 has a key, plaintext is refused and envelopes for all three are required.
  const u8 = await ready("u8", "phone");
  const groupClientMessageId = "group-attempt-7f3e";
  const groupRefusal = (await send({ text: "leak?", clientMessageId: groupClientMessageId })).find(
    (event) => event.type === "GROUP_ERROR",
  );
  assert.equal(groupRefusal?.code, "DM_E2EE_REQUIRED");
  assert.equal(groupRefusal?.groupId, groupId);
  assert.equal(groupRefusal?.clientMessageId, groupClientMessageId);
  const sealed = await u6.sealGroup(groupId, members, "encrypted hello", { markedEncrypted: false, refreshKeys: true });
  assert.ok(sealed.envelope);
  assert.equal(sealed.envelope.w.length, 3);
  const delivered = (await send({ envelope: sealed.envelope, clientMessageId: groupClientMessageId })).find(
    (event) => event.type === "GROUP_MESSAGE",
  );
  assert.equal(delivered?.message.text, "");
  assert.equal(delivered.message.id, sealed.envelope.id);
  assert.equal(delivered?.clientMessageId, groupClientMessageId);
  assert.equal(
    senderOtherDevice.sent.find((event) => event.type === "GROUP_MESSAGE")?.clientMessageId,
    groupClientMessageId,
  );
  const groupRecipientDelivery = groupRecipient.sent.find((event) => event.type === "GROUP_MESSAGE");
  assert.equal(groupRecipientDelivery?.message.id, sealed.envelope.id);
  assert.equal(
    "clientMessageId" in groupRecipientDelivery,
    false,
    "the sender's retry token is not sent to group peers",
  );

  // Leaving someone out is refused.
  const partial = await u6.sealGroup(groupId, [publicId("u6"), publicId("u7")], "not for u8", {
    markedEncrypted: true,
  });
  assert.equal(
    (await send({ envelope: partial.envelope })).find((event) => event.type === "GROUP_ERROR")?.code,
    "DM_E2EE_STALE_KEY",
  );

  // Every member reads it; the group is marked encrypted, with an encrypted preview.
  const history = await api(`/api/groups/${groupId}`, "u8");
  assert.equal(history.data.group.e2ee, true);
  assert.equal(history.data.group.latestEnvelope.id, sealed.envelope.id);
  const stored = history.data.messages.find((message) => message.id === sealed.envelope.id);
  assert.equal((await u8.openGroup(stored, groupId)).text, "encrypted hello");
  const u7 = await ready("u7", "desktop");
  assert.equal((await u7.openGroup(stored, groupId)).text, "encrypted hello");
  // Shown in another group, it is refused.
  assert.equal((await u7.openGroup(stored, randomUUID())).e2ee, "failed");
  // A report proof verifies as a group message.
  const proof = u7.reportProof(stored, "group");
  const senderKey = (await api(`/api/dm-keys/users/${publicId("u6")}`, "u7")).data.current;
  assert.equal(crypto.verifyReportProof(proof, senderKey).t, "encrypted hello");
});

test("an encrypted group only takes members who have a key", async () => {
  const groups = await api("/api/groups", "u6");
  const group = groups.data.groups.find((item) => item.name === "squad");
  const refused = await api(`/api/groups/${group.id}/members`, "u6", {
    method: "POST",
    body: { userId: publicId("u9") },
  });
  assert.equal(refused.data.code, "DM_E2EE_MEMBER_NO_KEY");
  await ready("u9", "phone");
  const added = await api(`/api/groups/${group.id}/members`, "u6", {
    method: "POST",
    body: { userId: publicId("u9") },
  });
  assert.equal(added.status, 200, JSON.stringify(added.data));
  // The newcomer can't read what was sent before they joined.
  const u9 = device("u9", "phone");
  await u9.start(publicId("u9"));
  const history = await api(`/api/groups/${group.id}`, "u9");
  const encrypted = history.data.messages.find((message) => message.envelope);
  assert.equal((await u9.openGroup(encrypted, group.id)).e2ee, "locked");
});

test("an envelope already read can't be shown again under another message id", async () => {
  const u6 = await ready("u6", "phone");
  const u7 = await ready("u7", "desktop");
  const sealed = await u6.seal(publicId("u7"), "once");
  const message = {
    id: sealed.envelope.id,
    fromUserId: publicId("u6"),
    toUserId: publicId("u7"),
    text: "",
    envelope: sealed.envelope,
  };
  assert.equal((await u7.open(message, publicId("u6"))).text, "once");
  const copied = await u7.open({ ...message, id: randomUUID() }, publicId("u6"));
  assert.deepEqual([copied.e2ee, copied.text], ["failed", ""]);
  // The sender's own cached copy is checked the same way.
  const own = await u6.open({ ...message, id: randomUUID() }, publicId("u7"));
  assert.equal(own.e2ee, "failed");
});

test("call setup is verified against the peer's key, and a swapped one is rejected", async () => {
  const u6 = await ready("u6", "phone");
  const u7 = await ready("u7", "desktop");
  const sdp = "v=0\r\na=fingerprint:sha-256 11:22:33:44\r\n";
  const auth = u6.signRtc(publicId("u7"), sdp);
  assert.ok(auth);
  assert.equal(await u7.verifyRtc(publicId("u6"), sdp, auth), "verified");
  const swapped = sdp.replace("11:22:33:44", "AA:BB:CC:DD");
  assert.equal(await u7.verifyRtc(publicId("u6"), swapped, auth), "rejected");
  // Unsigned from someone with a key: voice rooms show it as unverified, direct calls refuse it.
  assert.equal(await u7.verifyRtc(publicId("u6"), sdp, undefined), "unverified");
  assert.equal(await u7.verifyRtc(publicId("u6"), sdp, undefined, { strict: true }), "rejected");
  // Someone with no key at all can still call, unverified.
  addUser("u10");
  befriend("u7", "u10");
  assert.equal(await u7.verifyRtc(publicId("u10"), sdp, undefined, { strict: true }), "unverified");
});
