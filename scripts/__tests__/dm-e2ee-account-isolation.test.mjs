import test from "node:test";
import assert from "node:assert/strict";
import { DmE2eeSession as SharedSession } from "../../shared/dm-e2ee-session.ts";
import { DmE2eeSession as MobileSession } from "../../mobile/src/lib/e2ee/dm-e2ee-session.ts";
import {
  deriveAccountKeys,
  generateAccountSeed,
  generateRecoveryCode,
  keyringFromBytes,
  keyringToBytes,
  openGroupMessage,
  publicKeyOf,
  sealGroupMessage,
  sealKeyBackup,
} from "../../shared/dm-e2ee.ts";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function accountRecord(keys, backup) {
  const published = publicKeyOf(keys);
  return { enabled: true, key: published, keys: [published], backup, historyDays: null };
}

function makeFixture(Session, { blockAliceSave = false } = {}) {
  const aliceKeys = deriveAccountKeys(generateAccountSeed());
  const bobKeys = deriveAccountKeys(generateAccountSeed());
  const recoveryCode = generateRecoveryCode();
  const backup = sealKeyBackup([aliceKeys], recoveryCode, "alice");
  const stores = new Map([["bob", keyringToBytes([bobKeys])]]);
  const records = {
    alice: accountRecord(aliceKeys, backup),
    bob: accountRecord(bobKeys, null),
  };
  const aliceSave = deferred();
  const aliceSaveEntered = deferred();
  const requestDeferred = deferred();
  const requestEntered = deferred();
  const peerRecords = new Map();
  const peerDeferrals = new Map();
  const peerRequestCounts = new Map();
  const deviceStates = new Map();
  const peerKey = (accountId, userId) => `${accountId}:${userId}`;
  let account = "alice";
  let deferNextMe = false;
  const adapter = {
    client: "mobile",
    rotateAfterMs: Infinity,
    request: async (path) => {
      if (path === "/api/dm-keys/me") {
        const result = records[account];
        if (deferNextMe) {
          deferNextMe = false;
          requestEntered.resolve();
          return requestDeferred.promise;
        }
        return { ok: true, status: 200, data: result };
      }
      const peerPrefix = "/api/dm-keys/users/";
      if (path.startsWith(peerPrefix)) {
        const userId = decodeURIComponent(path.slice(peerPrefix.length));
        const key = peerKey(account, userId);
        peerRequestCounts.set(key, (peerRequestCounts.get(key) ?? 0) + 1);
        const pending = peerDeferrals.get(key);
        if (pending) {
          pending.entered.resolve();
          return pending.response.promise;
        }
        return { ok: true, status: 200, data: peerRecords.get(key) ?? { keys: [], current: null } };
      }
      return { ok: true, status: 200, data: { requests: [] } };
    },
    loadKeyring: async (accountId) => stores.get(accountId) ?? null,
    saveKeyring: async (accountId, bytes) => {
      if (blockAliceSave && accountId === "alice") {
        aliceSaveEntered.resolve();
        await aliceSave.promise;
      }
      stores.set(accountId, bytes);
    },
    forgetKeyring: async (accountId) => stores.delete(accountId),
    loadDeviceState: async (accountId) => deviceStates.get(accountId) ?? { pins: {} },
    saveDeviceState: async (accountId, state) => deviceStates.set(accountId, state),
  };
  return {
    session: new Session(adapter),
    aliceKeys,
    bobKeys,
    recoveryCode,
    stores,
    deviceStates,
    setPeerRecord(accountId, userId, keys) {
      const published = publicKeyOf(keys);
      peerRecords.set(peerKey(accountId, userId), { keys: [published], current: published });
      return published;
    },
    deferPeerRequest(accountId, userId) {
      const request = deferred();
      const entered = deferred();
      const pending = { response: request, entered };
      peerDeferrals.set(peerKey(accountId, userId), pending);
      return {
        entered: entered.promise,
        resolve(data) {
          request.resolve({ ok: true, status: 200, data });
        },
      };
    },
    peerRequestCount(accountId, userId) {
      return peerRequestCounts.get(peerKey(accountId, userId)) ?? 0;
    },
    setAccount(value) {
      account = value;
    },
    deferNextMe() {
      deferNextMe = true;
    },
    requestEntered: requestEntered.promise,
    resolveDeferredMe(data = records.alice) {
      requestDeferred.resolve({ ok: true, status: 200, data });
    },
    aliceSaveEntered: aliceSaveEntered.promise,
    releaseAliceSave() {
      aliceSave.resolve();
    },
  };
}

for (const [platform, Session] of [
  ["shared", SharedSession],
  ["mobile mirror", MobileSession],
]) {
  test(`${platform}: a late recovery response for account A cannot be adopted by account B`, async () => {
    const fixture = makeFixture(Session);
    await fixture.session.start("alice");
    assert.equal(fixture.session.getState().status, "locked");

    fixture.deferNextMe();
    const unlock = fixture.session.unlockWithRecoveryCode(fixture.recoveryCode);
    await fixture.requestEntered;

    fixture.setAccount("bob");
    await fixture.session.start("bob");
    assert.equal(fixture.session.getState().status, "ready");
    assert.equal(fixture.session.getState().keyId, fixture.bobKeys.keyId);

    fixture.resolveDeferredMe();
    await unlock;

    assert.equal(fixture.session.getState().accountId, "bob");
    assert.equal(fixture.session.getState().keyId, fixture.bobKeys.keyId);
    assert.equal(keyringFromBytes(fixture.stores.get("bob"))[0].keyId, fixture.bobKeys.keyId);

    const aOnlyGroup = sealGroupMessage({
      id: "a-only-message",
      from: "alice",
      groupId: "alice-only-group",
      payload: { t: "account A secret" },
      sender: fixture.aliceKeys,
      memberKeys: [publicKeyOf(fixture.aliceKeys)],
    });
    assert.deepEqual(
      openGroupMessage({
        envelope: aOnlyGroup,
        reader: fixture.aliceKeys,
        senderKey: publicKeyOf(fixture.aliceKeys),
        expected: { id: "a-only-message", from: "alice", groupId: "alice-only-group" },
      }),
      { t: "account A secret" },
    );
    assert.throws(() =>
      openGroupMessage({
        envelope: aOnlyGroup,
        reader: keyringFromBytes(fixture.stores.get("bob")),
        senderKey: publicKeyOf(fixture.aliceKeys),
        expected: { id: "a-only-message", from: "alice", groupId: "alice-only-group" },
      }),
    );
  });

  test(`${platform}: a recovery save already in progress cannot publish account A into account B`, async () => {
    const fixture = makeFixture(Session, { blockAliceSave: true });
    await fixture.session.start("alice");
    fixture.deferNextMe();
    const unlock = fixture.session.unlockWithRecoveryCode(fixture.recoveryCode);
    await fixture.requestEntered;
    fixture.resolveDeferredMe();
    await fixture.aliceSaveEntered;

    fixture.setAccount("bob");
    await fixture.session.start("bob");
    assert.equal(fixture.session.getState().status, "ready");
    fixture.releaseAliceSave();
    await unlock;

    assert.equal(fixture.session.getState().accountId, "bob");
    assert.equal(fixture.session.getState().keyId, fixture.bobKeys.keyId);
    assert.equal(keyringFromBytes(fixture.stores.get("bob"))[0].keyId, fixture.bobKeys.keyId);
  });

  test(`${platform}: normal recovery still adopts the captured account's key`, async () => {
    const fixture = makeFixture(Session);
    await fixture.session.start("alice");
    await fixture.session.unlockWithRecoveryCode(fixture.recoveryCode);
    assert.equal(fixture.session.getState().status, "ready");
    assert.equal(fixture.session.getState().keyId, fixture.aliceKeys.keyId);
    assert.equal(keyringFromBytes(fixture.stores.get("alice"))[0].keyId, fixture.aliceKeys.keyId);
  });

  test(`${platform}: a late peer response cannot pin or cache account A's peer key in account B`, async () => {
    const fixture = makeFixture(Session);
    const alicePeer = deriveAccountKeys(generateAccountSeed());
    const bobPeer = deriveAccountKeys(generateAccountSeed());
    const alicePublished = fixture.setPeerRecord("alice", "carol", alicePeer);
    const bobPublished = fixture.setPeerRecord("bob", "carol", bobPeer);
    const pendingAlice = fixture.deferPeerRequest("alice", "carol");
    await fixture.session.start("alice");

    const aliceLookup = fixture.session.peerHasKey("carol");
    await pendingAlice.entered;
    fixture.setAccount("bob");
    await fixture.session.start("bob");

    assert.equal(await fixture.session.peerHasKey("carol"), true);
    assert.equal(fixture.session.getState().pins.carol.keyId, bobPublished.keyId);
    pendingAlice.resolve({ keys: [alicePublished], current: alicePublished });
    await assert.rejects(aliceLookup, /account changed/i);

    assert.equal(fixture.session.getState().accountId, "bob");
    assert.equal(fixture.session.getState().pins.carol.keyId, bobPublished.keyId);
    assert.equal(fixture.deviceStates.get("bob").pins.carol.keyId, bobPublished.keyId);
    assert.equal((await fixture.session.peerKeys("carol")).current.keyId, bobPublished.keyId);
    assert.equal(fixture.peerRequestCount("bob", "carol"), 1);
  });

  test(`${platform}: an old peer request cannot clear account B's in-flight dedup entry`, async () => {
    const fixture = makeFixture(Session);
    const alicePeer = deriveAccountKeys(generateAccountSeed());
    const bobPeer = deriveAccountKeys(generateAccountSeed());
    const alicePublished = fixture.setPeerRecord("alice", "carol", alicePeer);
    const bobPublished = fixture.setPeerRecord("bob", "carol", bobPeer);
    const pendingAlice = fixture.deferPeerRequest("alice", "carol");
    await fixture.session.start("alice");
    const aliceLookup = fixture.session.peerHasKey("carol");
    await pendingAlice.entered;

    fixture.setAccount("bob");
    await fixture.session.start("bob");
    const pendingBob = fixture.deferPeerRequest("bob", "carol");
    const bobLookup = fixture.session.peerHasKey("carol");
    await pendingBob.entered;
    pendingAlice.resolve({ keys: [alicePublished], current: alicePublished });
    await assert.rejects(aliceLookup, /account changed/i);

    const duplicateBobLookup = fixture.session.peerHasKey("carol");
    assert.equal(fixture.peerRequestCount("bob", "carol"), 1);
    pendingBob.resolve({ keys: [bobPublished], current: bobPublished });
    assert.equal(await bobLookup, true);
    assert.equal(await duplicateBobLookup, true);
    assert.equal(fixture.session.getState().pins.carol.keyId, bobPublished.keyId);
  });

  test(`${platform}: a cached peer result cannot let a stale seal use the next account's keys`, async () => {
    const fixture = makeFixture(Session);
    const peer = deriveAccountKeys(generateAccountSeed());
    fixture.setPeerRecord("alice", "carol", peer);
    await fixture.session.start("alice");
    assert.equal(await fixture.session.peerHasKey("carol"), true);

    const cachedPeer = await fixture.session.peerKeys("carol");
    const originalPeerKeys = fixture.session.peerKeys.bind(fixture.session);
    const delayedPeerKeys = deferred();
    fixture.session.peerKeys = (userId, refresh) =>
      userId === "carol" ? delayedPeerKeys.promise : originalPeerKeys(userId, refresh);
    const staleSeal = fixture.session.seal("carol", "account A message");
    fixture.setAccount("bob");
    await fixture.session.start("bob");
    delayedPeerKeys.resolve(cachedPeer);
    await assert.rejects(staleSeal, /account changed/i);
    assert.equal(fixture.session.getState().accountId, "bob");
    assert.equal(fixture.session.getState().keyId, fixture.bobKeys.keyId);
  });

  test(`${platform}: a current peer lookup still pins and reuses the peer key`, async () => {
    const fixture = makeFixture(Session);
    const peer = deriveAccountKeys(generateAccountSeed());
    const published = fixture.setPeerRecord("alice", "carol", peer);
    await fixture.session.start("alice");

    assert.equal(await fixture.session.peerHasKey("carol"), true);
    assert.equal(fixture.session.getState().pins.carol.keyId, published.keyId);
    assert.equal(await fixture.session.peerHasKey("carol"), true);
    assert.equal(fixture.peerRequestCount("alice", "carol"), 1);
  });
}
