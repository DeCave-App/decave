// Voice notes: "Played" travels as `p: true` inside the listener's own encrypted
// reactions envelope, so the server only ever sees an ordinary reactions update.
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

const crypto = await import("../../shared/dm-e2ee.ts");
const { playedByOthers, createPlayedQueue } = await import("../../shared/voice-played.ts");
const { createDmE2eeSending } = await import("../../shared/dm-e2ee-sending.ts");

const sender = crypto.deriveAccountKeys(crypto.generateAccountSeed());
const listener = crypto.deriveAccountKeys(crypto.generateAccountSeed());
const stranger = crypto.deriveAccountKeys(crypto.generateAccountSeed());
const expected = { messageId: "voice-1", from: "DC-LISTENER", to: "DC-SENDER" };

function seal(overrides = {}) {
  return crypto.sealReactions({
    messageId: expected.messageId,
    from: expected.from,
    to: expected.to,
    emojis: [],
    sender: listener,
    recipientKey: crypto.publicKeyOf(sender),
    ...overrides,
  });
}

function state(envelope, reader = sender, wanted = expected) {
  return crypto.openReactionState({ envelope, reader, senderKey: crypto.publicKeyOf(listener), expected: wanted });
}

test("a played-only reactions envelope opens as played with no emojis", () => {
  const envelope = seal({ played: true });
  assert.deepEqual(state(envelope), { emojis: [], played: true });
  // The listener reads back their own mark on another device.
  assert.deepEqual(state(envelope, listener), { emojis: [], played: true });
  // Old callers see only the emojis.
  assert.deepEqual(
    crypto.openReactions({ envelope, reader: sender, senderKey: crypto.publicKeyOf(listener), expected }),
    [],
  );
});

test("emojis and the played mark travel together; without it the envelope is unplayed", () => {
  assert.deepEqual(state(seal({ emojis: ["👍"], played: true })), { emojis: ["👍"], played: true });
  assert.deepEqual(state(seal({ emojis: ["👍"] })), { emojis: ["👍"], played: false });
  assert.deepEqual(state(seal({ emojis: ["👍"], played: false })), { emojis: ["👍"], played: false });
});

test("a played envelope moved to another message or conversation, or tampered with, does not open", () => {
  const envelope = seal({ played: true });
  for (const wanted of [
    { ...expected, messageId: "voice-2" },
    { ...expected, from: "DC-OTHER" },
    { ...expected, to: "DC-OTHER" },
  ]) {
    assert.throws(() => state(envelope, sender, wanted), /belong/);
  }
  assert.throws(() => state({ ...envelope, c: envelope.c.slice(0, -2) + "AA" }));
  assert.throws(() => state(envelope, stranger));
});

test("playedByOthers ignores the account's own mark", () => {
  assert.equal(playedByOthers(["me"], "me"), false);
  assert.equal(playedByOthers([], "me"), false);
  assert.equal(playedByOthers(undefined, "me"), false);
  assert.equal(playedByOthers(["me", "bob"], "me"), true);
});

test("the mobile app keeps an identical copy of voice-played.ts", () => {
  assert.equal(
    fs.readFileSync(new URL("../../mobile/src/lib/voice-played.ts", import.meta.url), "utf8"),
    fs.readFileSync(new URL("../../shared/voice-played.ts", import.meta.url), "utf8"),
  );
});

function fakeSession(own = new Map([["m1", ["🎉"]]])) {
  const seals = [];
  const played = new Set();
  return {
    seals,
    session: {
      ownReactions: (id) => own.get(id),
      hasPlayed: (id) => played.has(id),
      getState: () => ({ available: true }),
      sealReactions: async (peerId, messageId, emojis, options) => {
        seals.push({ peerId, messageId, emojis: [...emojis], ...options });
        if (options?.played) played.add(messageId);
        return { id: messageId, emojis: [...emojis] };
      },
    },
  };
}

test("sendPlayed POSTs the reactions route with the emojis kept, and reseals once after a stale key", async () => {
  const { session, seals } = fakeSession();
  const sending = createDmE2eeSending(session);
  const calls = [];
  const replies = [
    { ok: false, data: { code: "DM_E2EE_STALE_KEY" } },
    { ok: true, data: {} },
  ];
  const request = async (path, init) => (calls.push({ path, ...init }), replies.shift());
  assert.equal(await sending.sendPlayed(request, { id: "m1", fromUserId: "DC-A" }, "DC-ME"), true);
  assert.deepEqual(
    calls.map((call) => [call.path, call.method]),
    [
      ["/api/dms/messages/m1/reactions", "POST"],
      ["/api/dms/messages/m1/reactions", "POST"],
    ],
  );
  assert.deepEqual(
    seals.map((s) => [s.peerId, s.emojis, s.played, Boolean(s.refreshKeys)]),
    [
      ["DC-A", ["🎉"], true, false],
      ["DC-A", ["🎉"], true, true],
    ],
  );
  // Own notes and messages this device hasn't opened send nothing.
  assert.equal(await sending.sendPlayed(request, { id: "m1", fromUserId: "DC-ME" }, "DC-ME"), false);
  assert.equal(await sending.sendPlayed(request, { id: "unknown", fromUserId: "DC-A" }, "DC-ME"), false);
  assert.equal(calls.length, 2);
});

test("toggling a reaction keeps the played mark, and an empty played envelope is not a removal", async () => {
  const { session, seals } = fakeSession();
  const sending = createDmE2eeSending(session);
  const message = { id: "m1", envelope: {}, reactions: { "👍": ["me"] }, playedBy: ["me"] };
  const body = await sending.dmReactionBody(message, "me", "peer", "👍");
  assert.notEqual(body.envelope, null);
  assert.deepEqual(seals.at(-1).emojis, []);
  assert.equal(seals.at(-1).played, true);
  // Without a mark, removing the last reaction still removes the envelope.
  const plain = await sending.dmReactionBody(
    { id: "m2", envelope: {}, reactions: { "👍": ["me"] } },
    "me",
    "peer",
    "👍",
  );
  assert.deepEqual(plain, { envelope: null });
});

test("the played queue keeps a failed mark pending and sends it again on retry", async () => {
  const store = new Map();
  const local = [];
  let ok = false;
  const sent = [];
  const queue = createPlayedQueue({
    send: async (message, context, selfId) => (sent.push([message.id, context, selfId]), ok),
    markLocal: (account, id) => local.push(`${account}:${id}`),
    loadPending: (account) => store.get(account) ?? [],
    savePending: (account, list) => store.set(account, list),
  });
  queue.report("me", { id: "m1", fromUserId: "peer", extra: 1 }, "ctx");
  queue.report("me", { id: "m1", fromUserId: "peer" }, "ctx"); // in flight: not sent twice
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(sent, [["m1", "ctx", "me"]]);
  assert.deepEqual(store.get("me"), [{ id: "m1", fromUserId: "peer" }]);
  ok = true;
  queue.retry("me", "ctx2");
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(store.get("me"), []);
  queue.retry("me", "ctx2");
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(sent.length, 2, "nothing left to resend");
  queue.report("me", { id: "m2", fromUserId: "me" }, "ctx");
  assert.equal(sent.length, 2, "own notes are never marked");
});
