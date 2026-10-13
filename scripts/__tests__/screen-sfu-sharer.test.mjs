import test from "node:test";
import assert from "node:assert/strict";
import {
  shouldSendMeshScreen,
  chooseShareTransport,
  fullEncodingFor,
  createScreenKeyManager,
  createScreenSfuSharer,
} from "../../src/voice/screen-sfu/sharer.ts";
import { SCREEN_SHARE_PROFILES, screenBitratePerViewer } from "../../src/app/voice.ts";

test("shouldSendMeshScreen follows SFU state, capability and mesh requests", () => {
  const none = new Set();
  const active = { sfuActive: true, meshRequested: none };
  assert.equal(shouldSendMeshScreen({ connectionId: "a" }, active), true, "old client");
  assert.equal(shouldSendMeshScreen({ connectionId: "a", sfuScreenCapable: true }, active), false);
  assert.equal(
    shouldSendMeshScreen(
      { connectionId: "a", sfuScreenCapable: true },
      { sfuActive: true, meshRequested: new Set(["a"]) },
    ),
    true,
  );
  const inactive = { sfuActive: false, meshRequested: none };
  assert.equal(shouldSendMeshScreen({ connectionId: "a", sfuScreenCapable: true }, inactive), true);
  assert.equal(shouldSendMeshScreen({ connectionId: "b" }, inactive), true);
});

test("chooseShareTransport picks mesh unless offered, E2EE ready and runtime capable", () => {
  const ok = { sfuOffered: true, e2eeReady: true, capableRuntime: true };
  assert.equal(chooseShareTransport(ok), "sfu");
  assert.equal(chooseShareTransport({ ...ok, e2eeReady: false }), "mesh", "E2EE locked");
  assert.equal(chooseShareTransport({ ...ok, sfuOffered: false }), "mesh");
  assert.equal(chooseShareTransport({ ...ok, capableRuntime: false }), "mesh");
});

test("fullEncodingFor matches the quality preset", () => {
  for (const quality of ["720p30", "1080p60", "1440p60"]) {
    const p = SCREEN_SHARE_PROFILES[quality];
    assert.deepEqual(fullEncodingFor(quality, 1), {
      maxBitrate: screenBitratePerViewer(p.maxBitrate, 1),
      maxFramerate: p.fps,
      scaleResolutionDownBy: 1,
    });
  }
});

function keyHarness(selfUserId = "me") {
  const sent = [];
  const keys = [];
  const sealCalls = [];
  const km = createScreenKeyManager({
    channelId: 7,
    selfConnectionId: "self",
    selfUserId,
    async sealKey(binding, key, userIds) {
      sealCalls.push({ binding, userIds: [...userIds] });
      return { envelopes: [{ envelope: { binding, users: [...userIds] }, sealedFor: [...userIds] }] };
    },
    send(p) {
      sent.push(p);
      return true;
    },
    onKey(index, key) {
      keys.push({ index, key });
    },
  });
  return { km, sent, keys, sealCalls };
}

const people = [
  { connectionId: "self", userId: "me", sfuScreenCapable: true, channelId: 7 },
  { connectionId: "c1", userId: "u1", sfuScreenCapable: true, channelId: 7 },
  { connectionId: "c2", userId: "u2", sfuScreenCapable: true, channelId: 7 },
  { connectionId: "old", userId: "u3", channelId: 7 },
];

test("key manager start: index 0, one RTC_SCREEN_KEY per capable connection", async () => {
  const { km, sent, keys, sealCalls } = keyHarness();
  await km.participantsChanged(people, []);
  await km.start();
  assert.equal(km.currentIndex(), 0);
  assert.equal(keys.length, 1);
  assert.equal(keys[0].index, 0);
  assert.equal(keys[0].key.length, 16);
  assert.deepEqual(sent.map((p) => p.targetConnectionId).sort(), ["c1", "c2"]);
  for (const p of sent) {
    assert.equal(p.type, "RTC_SCREEN_KEY");
    assert.equal(p.keyIndex, 0);
  }
  assert.equal(sealCalls[0].binding, "screen:7:self:0");
});

test("a leave rotates to index 1 with a new key and excludes the leaver", async () => {
  const { km, sent, keys, sealCalls } = keyHarness();
  await km.participantsChanged(people, []);
  await km.start();
  sent.length = 0;
  await km.participantsChanged(
    people.filter((p) => p.connectionId !== "c2"),
    ["c2"],
  );
  assert.equal(km.currentIndex(), 1);
  assert.equal(keys.length, 2);
  assert.notDeepEqual(keys[1].key, keys[0].key);
  assert.deepEqual(
    sent.map((p) => p.targetConnectionId),
    ["c1"],
  );
  assert.equal(sent[0].keyIndex, 1);
  assert.deepEqual(sealCalls.at(-1).userIds, ["u1"]);
  assert.equal(sealCalls.at(-1).binding, "screen:7:self:1");
});

test("joins get the current key without rotating", async () => {
  const { km, sent, keys } = keyHarness();
  await km.participantsChanged(people, []);
  await km.start();
  sent.length = 0;
  await km.participantsChanged([...people, { connectionId: "c4", userId: "u4", sfuScreenCapable: true }], []);
  assert.equal(km.currentIndex(), 0);
  assert.equal(keys.length, 1);
  assert.deepEqual(
    sent.map((p) => [p.targetConnectionId, p.keyIndex]),
    [["c4", 0]],
  );
});

test("two connections of one user both get keys; one leaving keeps the other", async () => {
  const { km, sent, sealCalls } = keyHarness();
  const list = [
    { connectionId: "self", userId: "me", sfuScreenCapable: true },
    { connectionId: "d1", userId: "dup", sfuScreenCapable: true },
    { connectionId: "d2", userId: "dup", sfuScreenCapable: true },
  ];
  await km.participantsChanged(list, []);
  await km.start();
  assert.deepEqual(sent.map((p) => p.targetConnectionId).sort(), ["d1", "d2"]);
  sent.length = 0;
  await km.participantsChanged(
    list.filter((p) => p.connectionId !== "d1"),
    ["d1"],
  );
  assert.equal(km.currentIndex(), 1);
  assert.deepEqual(
    sent.map((p) => p.targetConnectionId),
    ["d2"],
  );
  assert.deepEqual(sealCalls.at(-1).userIds, ["dup"]);
});

test("the sharer's own other device gets an envelope (sharer wrap)", async () => {
  const { km, sent } = keyHarness();
  await km.participantsChanged(
    [
      { connectionId: "self", userId: "me", sfuScreenCapable: true },
      { connectionId: "me2", userId: "me", sfuScreenCapable: true },
    ],
    [],
  );
  await km.start();
  assert.deepEqual(
    sent.map((p) => p.targetConnectionId),
    ["me2"],
  );
});

test("resend sends the current key to one connection", async () => {
  const { km, sent } = keyHarness();
  await km.participantsChanged(people, []);
  await km.start();
  sent.length = 0;
  await km.resend("c1");
  assert.deepEqual(
    sent.map((p) => [p.targetConnectionId, p.keyIndex]),
    [["c1", 0]],
  );
  await km.resend("unknown");
  assert.equal(sent.length, 1);
});

test("key index wraps 255 -> 0", async () => {
  const { km } = keyHarness();
  await km.participantsChanged([{ connectionId: "c1", userId: "u1", sfuScreenCapable: true }], []);
  await km.start();
  for (let i = 0; i < 255; i += 1)
    await km.participantsChanged([{ connectionId: "c1", userId: "u1", sfuScreenCapable: true }], ["x"]);
  assert.equal(km.currentIndex(), 255);
  await km.participantsChanged([{ connectionId: "c1", userId: "u1", sfuScreenCapable: true }], ["x"]);
  assert.equal(km.currentIndex(), 0);
});

function sharerHarness({
  publishFails = false,
  disabled = false,
  e2eeReady = true,
  publish,
  sealFails,
  offered = true,
} = {}) {
  const sent = [];
  const requests = [];
  const refreshes = [];
  const updates = [];
  let stopped = 0;
  const publisher = {
    setKey() {},
    async updateFull(enc) {
      updates.push(enc);
    },
    async stop() {
      stopped += 1;
    },
  };
  const sharer = createScreenSfuSharer({
    sendSocket(p) {
      sent.push(p);
      return true;
    },
    signaller: {
      async request(type, body) {
        requests.push({ type, body });
        return {};
      },
      handleResult: () => false,
      rejectAll() {},
    },
    async publish() {
      if (publish) return publish(publisher);
      if (disabled) throw Object.assign(new Error("sfu-disabled"), { code: "sfu-disabled" });
      if (publishFails) throw Object.assign(new Error("timeout"), { code: "timeout" });
      return publisher;
    },
    canSeal: () => e2eeReady,
    async sealKey(binding, key, userIds) {
      if (sealFails?.(binding)) throw new Error("seal failed");
      return { envelopes: [{ envelope: {}, sealedFor: [...userIds] }] };
    },
    capableRuntime: () => true,
    channelId: () => 7,
    selfConnectionId: () => "self",
    selfUserId: () => "me",
    participants: () => people,
    quality: () => "1080p60",
    refreshMeshSenders: () => refreshes.push(true),
    log() {},
  });
  // VOICE_JOINED.screenSfu tells the client whether the server offers the SFU.
  sharer.onVoiceJoined(offered);
  return { sharer, sent, requests, refreshes, updates, stopped: () => stopped };
}

test("sharer: SFU publish keeps capable peers off mesh and sends keys", async () => {
  const h = sharerHarness();
  await h.sharer.begin({ contentHint: "" });
  assert.equal(h.sharer.isActive(), true);
  assert.equal(h.sharer.meshFor(people[1]), false);
  assert.equal(h.sharer.meshFor(people[3]), true);
  assert.deepEqual(
    h.sent
      .filter((p) => p.type === "RTC_SCREEN_KEY")
      .map((p) => p.targetConnectionId)
      .sort(),
    ["c1", "c2"],
  );
  h.sharer.handleFrame({ type: "RTC_SCREEN_MESH_REQUEST", fromConnectionId: "c1", fromUserId: "u1" });
  assert.equal(h.sharer.meshFor(people[1]), true);
});

test("sharer: quality change updates only the full layer", async () => {
  const h = sharerHarness();
  await h.sharer.begin({ contentHint: "" });
  await h.sharer.updateQuality();
  assert.deepEqual(h.updates.at(-1), fullEncodingFor("1080p60", 1));
  assert.equal("rid" in h.updates.at(-1), false);
});

test("sharer: publish failure falls back to mesh for everyone and sends RTC_SFU_STOP", async () => {
  const h = sharerHarness({ publishFails: true });
  await h.sharer.begin({ contentHint: "" });
  assert.equal(h.sharer.isActive(), false);
  assert.equal(h.sharer.meshFor(people[1]), true);
  assert.ok(h.refreshes.length >= 1);
  assert.ok(h.requests.some((r) => r.type === "RTC_SFU_STOP"));
});

test("sharer: sfu-disabled is cached for the voice session and re-advertises", async () => {
  const h = sharerHarness({ disabled: true });
  h.sharer.onVoiceJoined(true);
  assert.deepEqual(h.sent.at(-1), { type: "VOICE_SFU_CAPABLE", capable: true });
  await h.sharer.begin({ contentHint: "" });
  assert.equal(h.sharer.isActive(), false);
  assert.deepEqual(h.sent.at(-1), { type: "VOICE_SFU_CAPABLE", capable: false });
  assert.equal(h.sharer.offered(), false);
  h.sharer.end();
  await h.sharer.begin({ contentHint: "" });
  assert.equal(h.sharer.isActive(), false);
  h.sharer.onVoiceJoined(true);
  assert.equal(h.sharer.offered(), true);
});

test("sharer: E2EE locked shares on mesh without publishing", async () => {
  const h = sharerHarness({ e2eeReady: false });
  h.sharer.onVoiceJoined(true);
  assert.deepEqual(h.sent.at(-1), { type: "VOICE_SFU_CAPABLE", capable: false });
  await h.sharer.begin({ contentHint: "" });
  assert.equal(h.sharer.isActive(), false);
  assert.equal(h.sharer.meshFor(people[1]), true);
});

test("sharer: end stops the publisher", async () => {
  const h = sharerHarness();
  await h.sharer.begin({ contentHint: "" });
  h.sharer.end();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(h.stopped(), 1);
  assert.equal(h.sharer.isActive(), false);
});

test("sharer: a publish that resolves after the timeout is stopped", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let resolveLate;
  const h = sharerHarness({ publish: (p) => new Promise((r) => (resolveLate = () => r(p))) });
  const begun = h.sharer.begin({ contentHint: "" });
  t.mock.timers.tick(10_000);
  await begun;
  assert.equal(h.sharer.isActive(), false);
  assert.ok(h.requests.some((r) => r.type === "RTC_SFU_STOP"));
  assert.equal(h.stopped(), 0);
  resolveLate();
  await new Promise((r) => setImmediate(r));
  assert.equal(h.stopped(), 1);
});

test("sharer: a leave seen through handleFrame rotates the key; other rooms get nothing", async () => {
  const h = sharerHarness();
  await h.sharer.begin({ contentHint: "" });
  h.sent.length = 0;
  const others = [{ connectionId: "x9", userId: "u9", sfuScreenCapable: true, channelId: 8 }];
  h.sharer.handleFrame({
    type: "VOICE_STATE",
    participants: [...people.filter((p) => p.connectionId !== "c2"), ...others],
  });
  await new Promise((r) => setImmediate(r));
  const keys = h.sent.filter((p) => p.type === "RTC_SCREEN_KEY");
  assert.deepEqual(
    keys.map((p) => [p.targetConnectionId, p.keyIndex]),
    [["c1", 1]],
  );
  h.sent.length = 0;
  h.sharer.handleFrame({ type: "VOICE_PEER_LEFT", connectionId: "c1" });
  await new Promise((r) => setImmediate(r));
  assert.equal(h.sent.filter((p) => p.type === "RTC_SCREEN_KEY").length, 0);
  assert.equal(h.sharer.isActive(), true);
});

test("sharer: a rotated key that cannot be sealed falls back to mesh", async () => {
  const h = sharerHarness({ sealFails: (binding) => binding.endsWith(":1") });
  await h.sharer.begin({ contentHint: "" });
  h.sharer.handleFrame({ type: "VOICE_PEER_LEFT", connectionId: "c2" });
  await new Promise((r) => setImmediate(r));
  assert.equal(h.sharer.isActive(), false);
  assert.equal(h.stopped(), 1);
  assert.ok(h.refreshes.length >= 1);
});

test("sharer: kill switch off (VOICE_JOINED without screenSfu) shares on mesh without publishing", async () => {
  let publishes = 0;
  const h = sharerHarness({ offered: false, publish: (p) => (publishes++, p) });
  assert.deepEqual(h.sent.at(-1), { type: "VOICE_SFU_CAPABLE", capable: false });
  assert.equal(h.sharer.offered(), false);
  await h.sharer.begin({ contentHint: "" });
  assert.equal(h.sharer.isActive(), false);
  assert.equal(publishes, 0);
  assert.equal(h.sharer.meshFor(people[1]), true);
  h.sharer.onVoiceJoined();
  assert.equal(h.sharer.offered(), false, "absent flag means not offered");
});

test("sharer: a stale publish from an ended share is stopped through its own (scoped) stop", async () => {
  let resolveFirst;
  let calls = 0;
  const stops = [];
  const make = (name) => ({
    setKey() {},
    async updateFull() {},
    async stop() {
      stops.push(name);
    },
  });
  const h = sharerHarness({
    publish: () => (++calls === 1 ? new Promise((r) => (resolveFirst = () => r(make("old")))) : make("new")),
  });
  const first = h.sharer.begin({ contentHint: "" });
  h.sharer.end();
  await h.sharer.begin({ contentHint: "" });
  assert.equal(h.sharer.isActive(), true);
  const unscoped = h.requests.filter((r) => r.type === "RTC_SFU_STOP").length;
  resolveFirst();
  await first;
  assert.deepEqual(stops, ["old"], "only the stale publisher stops itself");
  assert.equal(h.requests.filter((r) => r.type === "RTC_SFU_STOP").length, unscoped, "no extra unscoped stop");
  assert.equal(h.sharer.isActive(), true);
  assert.equal(h.sharer.meshFor(people[1]), false);
});
