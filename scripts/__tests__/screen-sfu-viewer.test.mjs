import test from "node:test";
import assert from "node:assert/strict";
import { createViewerController, SFU_DECRYPT_GRACE_MS } from "../../src/voice/screen-sfu/viewer.ts";

const flush = () => new Promise((resolve) => setImmediate(resolve));

function fakeViewer(log, opts = {}) {
  const health = [];
  const failed = [];
  return {
    health,
    failed,
    pull: async (id, rid) => {
      log.push(["pull", id, rid]);
      if (opts.pullError) throw opts.pullError;
      return { id: `stream-${id}` };
    },
    setLayer: async (id, rid) => void log.push(["setLayer", id, rid]),
    setKey: (id, i, k) => void log.push(["setKey", id, i, k]),
    drop: (id) => void log.push(["drop", id]),
    onDecryptHealth: (cb) => void health.push(cb),
    onFailed: (cb) => void failed.push(cb),
    close: () => void log.push(["close"]),
  };
}

function setup(over = {}) {
  const log = [];
  const sent = [];
  const screens = [];
  let clock = 0;
  const viewers = [];
  const ctl = createViewerController({
    createViewer: () => {
      const v = fakeViewer(log, over.viewerOpts);
      viewers.push(v);
      return v;
    },
    openKey: over.openKey ?? (async (envelope) => (envelope === "bad" ? null : new Uint8Array([1, 2, 3]))),
    send: (p) => {
      sent.push(p);
      return true;
    },
    setRemoteScreen: (id, stream) => void screens.push([id, stream]),
    now: () => clock,
    channelId: () => 7,
    selfConnectionId: () => "me",
    capable: () => over.capable ?? true,
    onSfuDisabled: over.onSfuDisabled,
    log: () => {},
  });
  return { ctl, log, sent, screens, viewers, setClock: (t) => (clock = t) };
}

const sharer = (extra = {}) => ({
  connectionId: "s1",
  userId: "u1",
  channelId: 7,
  screenSharing: true,
  screenSfu: { sessionId: "sess", trackName: "t" },
  ...extra,
});

test("SFU sharer is pulled at preview; watch switches to full and back", async () => {
  const { ctl, log, screens, viewers } = setup();
  ctl.participantsChanged([sharer()]);
  await flush();
  assert.deepEqual(log[0], ["pull", "s1", "p"]);
  assert.deepEqual(screens, [], "no tile before the first decrypt-ok");
  viewers[0].health[0]("s1", true);
  assert.deepEqual(screens[0], ["s1", { id: "stream-s1" }]);
  ctl.watchChanged("s1", true);
  await flush();
  assert.deepEqual(log.at(-1), ["setLayer", "s1", "f"]);
  ctl.watchChanged("s1", false);
  await flush();
  assert.deepEqual(log.at(-1), ["setLayer", "s1", "p"]);
});

test("sharer without screenSfu, in another channel, or when we are not capable is not pulled", async () => {
  for (const [list, capable] of [
    [[sharer({ screenSfu: null })], true],
    [[sharer({ channelId: 8 })], true],
    [[sharer()], false],
  ]) {
    const { ctl, log } = setup({ capable });
    ctl.participantsChanged(list);
    await flush();
    assert.deepEqual(log, []);
  }
});

test("frames failing before the key arrives, then the key: setKey, no mesh request", async () => {
  const { ctl, log, sent, viewers, setClock } = setup();
  ctl.participantsChanged([sharer()]);
  await flush();
  viewers[0].health[0]("s1", false);
  assert.deepEqual(sent, [{ type: "RTC_SCREEN_KEY_REQUEST", targetConnectionId: "s1" }]);
  setClock(1_000);
  await ctl.keyReceived({
    type: "RTC_SCREEN_KEY",
    fromConnectionId: "s1",
    fromUserId: "pub1",
    keyIndex: 0,
    envelope: "ok",
  });
  assert.ok(log.some((e) => e[0] === "setKey" && e[1] === "s1" && e[2] === 0));
  viewers[0].health[0]("s1", true);
  setClock(6_000);
  ctl.tick();
  assert.equal(sent.filter((p) => p.type === "RTC_SCREEN_MESH_REQUEST").length, 0);
  assert.ok(!log.some((e) => e[0] === "drop"));
});

test("key binding uses our channel, the sharer connection and the key index", async () => {
  const seen = [];
  const { ctl } = setup({
    openKey: async (envelope, fromUserId, binding) => {
      seen.push([envelope, fromUserId, binding]);
      return new Uint8Array([9]);
    },
  });
  await ctl.keyReceived({ fromConnectionId: "s1", fromUserId: "pub1", keyIndex: 3, envelope: "e" });
  assert.deepEqual(seen, [["e", "pub1", "screen:7:s1:3"]]);
});

test("no decrypt-ok for 5 s: key request at first failure, mesh request at 5 s, then drop", async () => {
  const { ctl, log, sent, screens, viewers, setClock } = setup();
  ctl.participantsChanged([sharer()]);
  await flush();
  viewers[0].health[0]("s1", false);
  viewers[0].health[0]("s1", false);
  assert.deepEqual(sent, [{ type: "RTC_SCREEN_KEY_REQUEST", targetConnectionId: "s1" }]);
  setClock(SFU_DECRYPT_GRACE_MS - 1);
  ctl.tick();
  assert.equal(sent.length, 1);
  setClock(SFU_DECRYPT_GRACE_MS);
  ctl.tick();
  assert.deepEqual(sent[1], { type: "RTC_SCREEN_MESH_REQUEST", targetConnectionId: "s1" });
  assert.deepEqual(log.at(-1), ["drop", "s1"]);
  assert.deepEqual(screens, [], "an undecryptable pull never replaced the tile");
  // Mesh is preferred from now on: no re-pull on later state.
  ctl.participantsChanged([sharer()]);
  ctl.tick();
  await flush();
  assert.equal(log.filter((e) => e[0] === "pull").length, 1);
  assert.equal(sent.length, 2);
});

test("key envelope that fails to open is ignored", async () => {
  const { ctl, log } = setup();
  ctl.participantsChanged([sharer()]);
  await flush();
  await ctl.keyReceived({ fromConnectionId: "s1", fromUserId: "pub1", keyIndex: 0, envelope: "bad" });
  assert.ok(!log.some((e) => e[0] === "setKey"));
});

test("viewer PC failure: one reconnect re-pulls, a second failure falls back to mesh", async () => {
  const { ctl, log, sent, viewers } = setup();
  ctl.participantsChanged([sharer()]);
  await ctl.keyReceived({ fromConnectionId: "s1", fromUserId: "pub1", keyIndex: 0, envelope: "ok" });
  await flush();
  viewers[0].failed[0]();
  await flush();
  assert.equal(viewers.length, 2);
  assert.equal(log.filter((e) => e[0] === "pull").length, 2);
  assert.ok(log.filter((e) => e[0] === "setKey").length >= 2, "keys replayed into the new viewer");
  viewers[1].failed[0]();
  await flush();
  assert.deepEqual(sent.at(-1), { type: "RTC_SCREEN_MESH_REQUEST", targetConnectionId: "s1" });
});

test("pull answered sfu-disabled marks SFU disabled and requests mesh", async () => {
  let disabled = 0;
  const { ctl, sent } = setup({
    viewerOpts: { pullError: Object.assign(new Error("sfu-disabled"), { code: "sfu-disabled" }) },
    onSfuDisabled: () => (disabled += 1),
  });
  ctl.participantsChanged([sharer()]);
  await flush();
  await flush();
  assert.equal(disabled, 1);
  assert.deepEqual(sent, [{ type: "RTC_SCREEN_MESH_REQUEST", targetConnectionId: "s1" }]);
});

test("sharer stops: pull dropped and tile cleared; close tears down the viewer", async () => {
  const { ctl, log, screens, viewers } = setup();
  ctl.participantsChanged([sharer()]);
  await flush();
  viewers[0].health[0]("s1", true);
  ctl.participantsChanged([sharer({ screenSharing: false, screenSfu: null })]);
  assert.deepEqual(log.at(-1), ["drop", "s1"]);
  assert.deepEqual(screens.at(-1), ["s1", null]);
  ctl.close();
  assert.deepEqual(log.at(-1), ["close"]);
});

test("handleFrame consumes RTC_SCREEN_KEY and observes VOICE_STATE", async () => {
  const { ctl, log } = setup();
  assert.equal(ctl.handleFrame({ type: "VOICE_STATE", participants: [sharer()] }), false);
  await flush();
  assert.deepEqual(log[0], ["pull", "s1", "p"]);
  assert.equal(
    ctl.handleFrame({ type: "RTC_SCREEN_KEY", fromConnectionId: "s1", fromUserId: "p", keyIndex: 1, envelope: "ok" }),
    true,
  );
  assert.equal(ctl.handleFrame({ type: "VOICE_PEER_LEFT", connectionId: "s1" }), false);
  assert.deepEqual(log.at(-1), ["drop", "s1"]);
});

test("decrypt-ok on the reconnected viewer re-arms one more reconnect", async () => {
  const { ctl, sent, viewers } = setup();
  ctl.participantsChanged([sharer()]);
  await flush();
  viewers[0].failed[0]();
  await flush();
  viewers[1].health[0]("s1", true);
  viewers[1].failed[0]();
  await flush();
  assert.equal(viewers.length, 3, "reconnected again instead of mesh");
  assert.equal(sent.filter((p) => p.type === "RTC_SCREEN_MESH_REQUEST").length, 0);
});
