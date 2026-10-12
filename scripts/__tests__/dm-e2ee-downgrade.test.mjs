import test from "node:test";
import assert from "node:assert/strict";
import { DmE2eeSession as SharedSession } from "../../shared/dm-e2ee-session.ts";
import { DmE2eeSession as MobileSession } from "../../mobile/src/lib/e2ee/dm-e2ee-session.ts";
import { createDmE2eeSending } from "../../shared/dm-e2ee-sending.ts";
import {
  deriveAccountKeys,
  generateAccountSeed,
  keyringToBytes,
  publicKeyOf,
  openDirectMessage,
} from "../../shared/dm-e2ee.ts";

const alice = deriveAccountKeys(generateAccountSeed());
const bob = deriveAccountKeys(generateAccountSeed());
function fixture(Session) {
  const store = { keyring: keyringToBytes([alice]), device: { pins: {} } };
  const control = {
    enabled: true,
    peer: publicKeyOf(bob),
    own: publicKeyOf(alice),
    readFailure: false,
    writeFailure: false,
    now: Date.now(),
  };
  const adapter = {
    client: "web",
    rotateAfterMs: Infinity,
    now: () => control.now,
    request: async (path) => ({
      ok: true,
      status: 200,
      data:
        path === "/api/dm-keys/me"
          ? { enabled: control.enabled, key: control.own, keys: [control.own] }
          : path.startsWith("/api/dm-keys/users/")
            ? { current: control.peer, keys: control.peer ? [control.peer] : [] }
            : { requests: [] },
    }),
    loadKeyring: async () => store.keyring,
    saveKeyring: async (_id, value) => {
      store.keyring = value;
    },
    forgetKeyring: async (_id, options) => {
      store.keyring = null;
      if (!options?.preserveDeviceState) store.device = { pins: {} };
    },
    loadDeviceState: async () => {
      if (control.readFailure) throw new Error("security state read failed");
      return structuredClone(store.device);
    },
    saveDeviceState: async (_id, value) => {
      if (control.writeFailure) throw new Error("security state write failed");
      store.device = structuredClone(value);
    },
  };
  const session = new Session(adapter);
  return { session, sending: createDmE2eeSending(session), store, control };
}

for (const [platform, Session] of [
  ["web/desktop", SharedSession],
  ["mobile", MobileSession],
]) {
  test(platform + ": a pinned DM cannot downgrade on HTTP edits, socket retries, cache expiry or restart", async () => {
    const { session, sending, store, control } = fixture(Session);
    await session.start("alice");
    assert.equal(session.getState().status, "ready");
    const frame = await sending.dmSocketFrame("bob", "secret", null);
    assert.ok(frame.envelope);
    assert.equal(frame.text, undefined);
    assert.deepEqual(
      openDirectMessage({
        envelope: frame.envelope,
        reader: bob,
        senderKey: publicKeyOf(alice),
        expected: { id: frame.envelope.id, from: "alice", to: "bob" },
      }),
      { t: "secret" },
    );
    assert.ok(store.device.pins.bob, "first encrypted use is durable even before verification");
    control.peer = null;
    await assert.rejects(
      sending.dmSealedBody("bob", "secret edit", { id: frame.envelope.id, refreshKeys: true }),
      /key is unavailable/,
    );
    await assert.rejects(
      sending.retryFrameAfterDmError({ code: "DM_E2EE_STALE_KEY", messageId: frame.envelope.id }),
      /key is unavailable/,
    );
    control.now += 6 * 60_000;
    await assert.rejects(session.seal("bob", "expired cache"), /key is unavailable/);
    await assert.rejects(session.peerHasKey("bob", true), /key is unavailable/);
    await session.acknowledgeKeyChange("bob", true);
    await session.stop({ forget: false });
    await session.start("alice");
    assert.equal(session.getState().pins.bob.verified, true);
    await assert.rejects(session.seal("bob", "after restart"), /key is unavailable/);
    control.peer = { ...publicKeyOf(bob), keyId: "malformed" };
    await assert.rejects(session.seal("bob", "malformed key", { refreshKeys: true }), /key is unavailable/);
    control.peer = publicKeyOf(bob);
    assert.ok((await session.seal("bob", "restored key", { refreshKeys: true })).envelope);
    control.peer = null;
    session.handleRealtimeEvent({ type: "DM_KEYS_CHANGED", userId: "bob" });
    await assert.rejects(session.seal("bob", "after invalidation"), /key is unavailable/);
  });

  test(
    platform + ": disabled or unreadable encryption state fails closed while clean legacy devices still work",
    async () => {
      const { session, store, control } = fixture(Session);
      control.enabled = false;
      await session.start("alice");
      assert.equal(session.getState().status, "error");
      await assert.rejects(session.seal("bob", "secret"), /disabled/);
      await assert.rejects(
        session.sealGroup("group", ["alice", "bob"], "secret", { markedEncrypted: false }),
        /disabled/,
      );
      store.keyring = null;
      store.device.pins.bob = { keyId: bob.keyId, verified: true };
      await session.start("alice");
      await assert.rejects(session.seal("bob", "pin alone"), /disabled/);
      store.device.pins = {};
      control.readFailure = true;
      await session.start("alice");
      await assert.rejects(session.seal("bob", "read failure"), /read failed/);
      control.readFailure = false;
      await session.start("alice");
      assert.deepEqual(await session.seal("bob", "legacy"), { text: "legacy" });
      await assert.rejects(session.sealGroup("group", ["alice", "bob"], "encrypted group", { markedEncrypted: true }));
      await session.stop({ forget: false });
      control.enabled = true;
      store.keyring = keyringToBytes([alice]);
      control.peer = null;
      await session.start("alice");
      assert.deepEqual(await session.seal("new-peer", "never encrypted"), { text: "never encrypted" });
    },
  );

  test(platform + ": failed pin writes cannot authorize encryption or a cached plaintext downgrade", async () => {
    const { session, store, control } = fixture(Session);
    await session.start("alice");
    control.peer = null;
    assert.deepEqual(await session.seal("bob", "legacy"), { text: "legacy" });
    control.peer = publicKeyOf(bob);
    control.writeFailure = true;
    await assert.rejects(session.seal("bob", "first encrypted", { refreshKeys: true }), /write failed/);
    await assert.rejects(session.seal("bob", "retry", { refreshKeys: true }), /write failed/);
    await assert.rejects(session.seal("bob", "old plaintext cache"), /key is unavailable/);
    assert.equal(store.device.pins.bob, undefined);
    control.writeFailure = false;
    assert.ok((await session.seal("bob", "durable encrypted", { refreshKeys: true })).envelope);
    assert.ok(store.device.pins.bob);
  });

  test(platform + ": an account key reset cannot erase the peer encryption requirement", async () => {
    const { session, store, control } = fixture(Session);
    await session.start("alice");
    await session.seal("bob", "secret");
    await session.stop({ forget: false });
    control.own = publicKeyOf(deriveAccountKeys(generateAccountSeed()));
    await session.start("alice");
    assert.equal(session.getState().status, "locked");
    assert.equal(store.keyring, null);
    assert.ok(store.device.pins.bob);
    await session.stop({ forget: false });
    control.enabled = false;
    await session.start("alice");
    await assert.rejects(session.seal("bob", "after server reset"), /disabled/);
  });

  test(platform + ": plaintext DM retries require the exact per-send id and clean up on success", async () => {
    const { session, sending, control } = fixture(Session);
    await session.start("alice");
    control.peer = null;
    const first = await sending.dmSocketFrame("bob", "first draft", null);
    const second = await sending.dmSocketFrame("bob", "second draft", null);
    assert.equal(typeof first.clientMessageId, "string");
    assert.notEqual(first.clientMessageId, second.clientMessageId);
    assert.equal(first.text, "first draft");

    assert.equal(
      await sending.retryFrameAfterDmError({ code: "DM_E2EE_REQUIRED", targetUserId: "bob" }),
      null,
      "an ID-less error must not select an arbitrary plaintext send",
    );
    assert.equal(
      await sending.retryFrameAfterDmError({
        code: "DM_E2EE_REQUIRED",
        clientMessageId: first.clientMessageId,
        targetUserId: "someone-else",
      }),
      null,
      "an error for another conversation must not retry this send",
    );

    control.peer = publicKeyOf(bob);
    const retryFirst = await sending.retryFrameAfterDmError({
      code: "DM_E2EE_REQUIRED",
      clientMessageId: first.clientMessageId,
      targetUserId: "bob",
    });
    assert.equal(retryFirst.targetUserId, "bob");
    assert.notEqual(retryFirst.clientMessageId, first.clientMessageId);
    assert.notEqual(retryFirst.clientMessageId, second.clientMessageId);
    assert.deepEqual(
      openDirectMessage({
        envelope: retryFirst.envelope,
        reader: bob,
        senderKey: publicKeyOf(alice),
        expected: { id: retryFirst.envelope.id, from: "alice", to: "bob" },
      }),
      { t: "first draft" },
      "the retry must preserve the failed send's body",
    );
    sending.settleDmSend("server-message-1", "bob", retryFirst.clientMessageId);
    assert.equal(
      await sending.retryFrameAfterDmError({
        code: "DM_E2EE_REQUIRED",
        clientMessageId: retryFirst.clientMessageId,
        targetUserId: "bob",
      }),
      null,
      "an acknowledged retry must no longer be pending",
    );

    const retrySecond = await sending.retryFrameAfterDmError({
      code: "DM_E2EE_REQUIRED",
      clientMessageId: second.clientMessageId,
      targetUserId: "bob",
    });
    assert.deepEqual(
      openDirectMessage({
        envelope: retrySecond.envelope,
        reader: bob,
        senderKey: publicKeyOf(alice),
        expected: { id: retrySecond.envelope.id, from: "alice", to: "bob" },
      }),
      { t: "second draft" },
      "a later failure must retry its own body, not the most recent draft",
    );
  });

  test(platform + ": plaintext group retries require the exact per-send id and group", async () => {
    const { session, sending, control } = fixture(Session);
    await session.start("alice");
    control.peer = null;
    const group = { id: "group-1", e2ee: false, members: [{ id: "alice" }, { id: "bob" }] };
    const first = await sending.groupSocketFrame(group, "first group draft", null);
    const second = await sending.groupSocketFrame(group, "second group draft", null);
    assert.notEqual(first.clientMessageId, second.clientMessageId);
    assert.equal(first.text, "first group draft");

    assert.equal(
      await sending.retryGroupFrameAfterError({ code: "DM_E2EE_REQUIRED", groupId: group.id }, () => group),
      null,
      "an ID-less group error must not select an arbitrary plaintext send",
    );
    assert.equal(
      await sending.retryGroupFrameAfterError(
        { code: "DM_E2EE_STALE_KEY", clientMessageId: first.clientMessageId, groupId: "another-group" },
        () => group,
      ),
      null,
      "an error for another group must not retry this send",
    );

    control.peer = publicKeyOf(bob);
    const retryFirst = await sending.retryGroupFrameAfterError(
      { code: "DM_E2EE_REQUIRED", clientMessageId: first.clientMessageId, groupId: group.id },
      () => group,
    );
    assert.equal(retryFirst.groupId, group.id);
    assert.notEqual(retryFirst.clientMessageId, first.clientMessageId);
    assert.notEqual(retryFirst.clientMessageId, second.clientMessageId);
    assert.ok(retryFirst.envelope, "the required-encryption retry must be sealed to the group members");
    sending.settleGroupSend("server-group-message-1", group.id, retryFirst.clientMessageId);
    assert.equal(
      await sending.retryGroupFrameAfterError(
        { code: "DM_E2EE_REQUIRED", clientMessageId: retryFirst.clientMessageId, groupId: group.id },
        () => group,
      ),
      null,
      "an acknowledged group retry must no longer be pending",
    );

    const retrySecond = await sending.retryGroupFrameAfterError(
      { code: "DM_E2EE_REQUIRED", clientMessageId: second.clientMessageId, groupId: group.id },
      () => group,
    );
    assert.equal(retrySecond.groupId, group.id);
    assert.ok(retrySecond.envelope);
  });
}
