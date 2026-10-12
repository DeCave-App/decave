import test from "node:test";
import assert from "node:assert/strict";
import {
  DmCryptoError,
  deriveAccountKeys,
  generateAccountSeed,
  keyringToBytes,
  openScreenKey,
  publicKeyOf,
  sealDirectMessage,
  sealScreenKey,
} from "../../shared/dm-e2ee.ts";
import { SCREEN_KEY_MAX_WRAPS, parseDmEnvelope } from "../../shared/dm-e2ee-format.ts";
import { DmE2eeSession as SharedSession } from "../../shared/dm-e2ee-session.ts";
import { DmE2eeSession as MobileSession } from "../../mobile/src/lib/e2ee/dm-e2ee-session.ts";

const alice = deriveAccountKeys(generateAccountSeed());
const bob = deriveAccountKeys(generateAccountSeed());
const carol = deriveAccountKeys(generateAccountSeed());
const mallory = deriveAccountKeys(generateAccountSeed());
const binding = "screen:chan-1:conn-9:0";
const streamKey = crypto.getRandomValues(new Uint8Array(16));
const seal = () =>
  sealScreenKey({ binding, from: "alice", streamKey, sender: alice, recipients: [publicKeyOf(bob), publicKeyOf(carol)] });
const open = (envelope, reader, extra = {}) =>
  openScreenKey({ envelope, reader, senderKey: publicKeyOf(alice), expected: { binding, from: "alice" }, ...extra });

test("each recipient opens the same 16-byte stream key", () => {
  const envelope = seal();
  assert.equal(envelope.id, binding);
  assert.equal(envelope.to, "room");
  for (const reader of [bob, carol, alice]) assert.deepEqual(open(envelope, reader), streamKey);
});

test("a third party cannot open it", () => {
  assert.throws(() => open(seal(), mallory), DmCryptoError);
});

test("a different binding is rejected", () => {
  const envelope = seal();
  for (const other of ["screen:chan-2:conn-9:0", "screen:chan-1:conn-9:1"]) {
    assert.throws(
      () => openScreenKey({ envelope, reader: bob, senderKey: publicKeyOf(alice), expected: { binding: other, from: "alice" } }),
      DmCryptoError,
    );
  }
});

test("an envelope signed by someone else's key is rejected", () => {
  assert.throws(() => open(seal(), bob, { senderKey: publicKeyOf(mallory) }), DmCryptoError);
});

test("a DM envelope cannot be opened as a screen key", () => {
  const dm = sealDirectMessage({
    id: "0f8fad5b-d9cb-469f-a165-70867728950e",
    from: "alice",
    to: "room",
    payload: { t: "hi" },
    sender: alice,
    recipientKey: publicKeyOf(bob),
  });
  assert.throws(() => open({ ...dm, id: binding }, bob), DmCryptoError);
});

test("only 16-byte keys are sealed", () => {
  assert.throws(() => sealScreenKey({ binding, from: "alice", streamKey: new Uint8Array(15), sender: alice, recipients: [] }));
});

test("the envelope parser accepts a screen-key envelope when told to", () => {
  const envelope = seal();
  assert.equal(parseDmEnvelope(envelope), null);
  assert.deepEqual(parseDmEnvelope(envelope, 20, (id) => id === binding), envelope);
});

test("an envelope opened with the wrong sender id is rejected", () => {
  assert.throws(() => open(seal(), bob, { expected: { binding, from: "eve" } }), DmCryptoError);
});

test("sealing refuses more recipients than an envelope can carry", () => {
  const many = Array.from({ length: 20 }, () => publicKeyOf(deriveAccountKeys(generateAccountSeed())));
  assert.throws(() => sealScreenKey({ binding, from: "alice", streamKey, sender: alice, recipients: many }), DmCryptoError);
});

function sessionFixture(Session, viewers) {
  const store = { keyring: keyringToBytes([alice]), device: { pins: {} } };
  const adapter = {
    client: "web",
    rotateAfterMs: Infinity,
    now: () => Date.now(),
    request: async (path) => {
      if (path === "/api/dm-keys/me") {
        const own = publicKeyOf(alice);
        return { ok: true, status: 200, data: { enabled: true, key: own, keys: [own] } };
      }
      if (path.startsWith("/api/dm-keys/users/")) {
        const key = viewers.get(decodeURIComponent(path.split("/").pop()))?.pub ?? null;
        return { ok: true, status: 200, data: { current: key, keys: key ? [key] : [] } };
      }
      return { ok: true, status: 200, data: { requests: [] } };
    },
    loadKeyring: async () => store.keyring,
    saveKeyring: async (_id, value) => {
      store.keyring = value;
    },
    forgetKeyring: async () => {},
    loadDeviceState: async () => structuredClone(store.device),
    saveDeviceState: async (_id, value) => {
      store.device = structuredClone(value);
    },
  };
  return new Session(adapter);
}

for (const [platform, Session] of [
  ["web/desktop", SharedSession],
  ["mobile", MobileSession],
]) {
  test(platform + ": 25 viewers are chunked across envelopes and every one can open", async () => {
    const viewers = new Map();
    for (let i = 0; i < 25; i++) {
      const keys = deriveAccountKeys(generateAccountSeed());
      viewers.set(`v${i}`, { keys, pub: publicKeyOf(keys) });
    }
    const session = sessionFixture(Session, viewers);
    await session.start("alice");
    assert.equal(session.canSealScreenKeys(), true);
    const ids = [...viewers.keys(), "keyless"];
    const { envelopes } = await session.sealScreenKey(binding, streamKey, ids);
    assert.ok(envelopes.length >= 2);
    const covered = envelopes.flatMap((e) => e.sealedFor);
    assert.deepEqual([...covered].sort(), [...viewers.keys()].sort());
    for (const { envelope, sealedFor } of envelopes) {
      assert.ok(envelope.w.length <= SCREEN_KEY_MAX_WRAPS);
      for (const id of sealedFor) {
        assert.deepEqual(
          openScreenKey({ envelope, reader: viewers.get(id).keys, senderKey: publicKeyOf(alice), expected: { binding, from: "alice" } }),
          streamKey,
        );
      }
    }
  });

  test(platform + ": the sharer's own session opens its key; bad input gives null", async () => {
    const session = sessionFixture(Session, new Map());
    await session.start("alice");
    const { envelopes } = await session.sealScreenKey(binding, streamKey, ["nobody"]);
    assert.equal(envelopes.length, 1);
    assert.deepEqual(envelopes[0].sealedFor, []);
    assert.deepEqual(await session.openScreenKey(envelopes[0].envelope, "alice", binding), streamKey);
    assert.equal(await session.openScreenKey(envelopes[0].envelope, "alice", "screen:other:1:0"), null);
    assert.equal(await session.openScreenKey({ junk: true }, "alice", binding), null);
  });
}
