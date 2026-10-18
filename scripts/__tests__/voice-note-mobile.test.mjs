// Mobile voice notes: pure controllers (recorder, mic gesture, sender, playback,
// played reporter) plus source checks for the screen wiring.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const dir = "../../mobile/src/components/voice-notes";
const { createVoiceRecorderController, meteringToLevel } = await import(`${dir}/recorder.ts`);
const { createMicGesture, HOLD_CANCEL_DISTANCE_PX } = await import(`${dir}/mic-gesture.ts`);
const { createVoiceNoteSender, voiceAttachmentMeta } = await import(`${dir}/send.ts`);
const { createPlaybackQueue, createPlayedTracker, nextSpeed } = await import(`${dir}/playback.ts`);
const { createPlayedReceipts, receiptRequest, addPlayedId } = await import(`${dir}/played.ts`);
const { createDmE2eeSending } = await import("../../mobile/src/lib/e2ee/dm-e2ee-sending.ts");
const settle = () => new Promise((r) => setTimeout(r, 5));
const { VOICE_NOTE_MAX_MS, VOICE_NOTE_PAD_STEP, encodeWave } = await import("../../mobile/src/lib/voice-note.ts");
const { decryptAttachment } = await import("../../mobile/src/lib/e2ee/dm-e2ee.ts");

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

function fakeDeps(overrides = {}) {
  let now = 0;
  let timer = null;
  const log = [];
  const deps = {
    log,
    advance(ms) {
      for (let t = 0; t < ms; t += 50) {
        now += 50;
        timer?.();
      }
    },
    requestPermission: async () => true,
    begin: async () => {
      log.push("begin");
    },
    end: async () => {
      log.push("end");
      return "file:///cache/rec.m4a";
    },
    deleteFile: (uri) => log.push(`delete:${uri}`),
    level: () => 0.5,
    now: () => now,
    setInterval: (fn) => {
      timer = fn;
      return 1;
    },
    clearInterval: () => {
      timer = null;
    },
    ...overrides,
  };
  return deps;
}

test("recorder stops itself at 2:00 and offers a preview", async () => {
  const deps = fakeDeps();
  const rec = createVoiceRecorderController(deps);
  await rec.start();
  assert.equal(rec.getSnapshot().state, "recording");
  deps.advance(VOICE_NOTE_MAX_MS + 5000);
  await new Promise((r) => setTimeout(r, 0));
  const snap = rec.getSnapshot();
  assert.equal(snap.state, "preview");
  assert.equal(snap.result.meta.ms, VOICE_NOTE_MAX_MS);
  assert.equal(snap.result.uri, "file:///cache/rec.m4a");
  assert.equal(snap.result.mime, "audio/mp4");
  assert.deepEqual(deps.log, ["begin", "end"]);
});

test("recorder discards clips shorter than 500 ms and deletes the file", async () => {
  const deps = fakeDeps();
  const rec = createVoiceRecorderController(deps);
  await rec.start();
  deps.advance(400);
  const draft = await rec.stop();
  assert.equal(draft, null);
  assert.equal(rec.getSnapshot().state, "idle");
  assert.ok(deps.log.includes("delete:file:///cache/rec.m4a"));
});

test("recorder stop returns the draft (hold-to-record sends it straight away)", async () => {
  const deps = fakeDeps();
  const rec = createVoiceRecorderController(deps);
  await rec.start();
  deps.advance(3000);
  const draft = await rec.stop();
  assert.equal(draft.meta.ms, 3000);
  assert.equal(draft.meta.wave.length, encodeWave([1]).length);
});

test("recorder reports a denied permission and discard deletes the file", async () => {
  const denied = createVoiceRecorderController(fakeDeps({ requestPermission: async () => false }));
  await denied.start();
  assert.equal(denied.getSnapshot().state, "error");
  assert.equal(denied.getSnapshot().error, "permission");

  const deps = fakeDeps();
  const rec = createVoiceRecorderController(deps);
  await rec.start();
  deps.advance(2000);
  await rec.discard();
  assert.equal(rec.getSnapshot().state, "idle");
  assert.ok(deps.log.includes("delete:file:///cache/rec.m4a"));
});

function appState() {
  let listener = null;
  return { subscribe: (fn) => ((listener = fn), () => {}), emit: (state) => listener?.(state) };
}

test("going to the background stops a tap recording into its preview and discards a hold", async () => {
  const app = appState();
  const deps = fakeDeps({ subscribeAppState: app.subscribe });
  const rec = createVoiceRecorderController(deps);
  await rec.start("tap");
  deps.advance(2000);
  app.emit("background");
  await settle();
  assert.equal(rec.getSnapshot().state, "preview");
  assert.equal(rec.getSnapshot().result.meta.ms, 2000);

  const app2 = appState();
  const deps2 = fakeDeps({ subscribeAppState: app2.subscribe });
  const hold = createVoiceRecorderController(deps2);
  await hold.start("hold");
  deps2.advance(2000);
  app2.emit("inactive");
  assert.equal(hold.getSnapshot().state, "recording", "only background counts");
  app2.emit("background");
  await settle();
  assert.equal(hold.getSnapshot().state, "idle");
  assert.ok(deps2.log.includes("delete:file:///cache/rec.m4a"));
});

test("releaseHold reads the controller: sends a running or auto-stopped note, discards a pending start", async () => {
  const deps = fakeDeps();
  const rec = createVoiceRecorderController(deps);
  await rec.start("hold");
  deps.advance(1500);
  assert.equal((await rec.releaseHold()).meta.ms, 1500);

  const deps2 = fakeDeps();
  const auto = createVoiceRecorderController(deps2);
  await auto.start("hold");
  deps2.advance(VOICE_NOTE_MAX_MS + 100);
  assert.equal((await auto.releaseHold()).meta.ms, VOICE_NOTE_MAX_MS);

  let grant;
  const slow = createVoiceRecorderController(fakeDeps({ requestPermission: () => new Promise((r) => (grant = r)) }));
  const starting = slow.start("hold");
  assert.equal(await slow.releaseHold(), null);
  grant(true);
  await starting;
  assert.equal(slow.getSnapshot().state, "idle", "a start released early never records");
});

test("metering in dBFS maps to 0..1 levels", () => {
  assert.equal(meteringToLevel(-160), 0);
  assert.equal(meteringToLevel(0), 1);
  assert.equal(meteringToLevel(undefined), 0);
  assert.ok(meteringToLevel(-30) > 0 && meteringToLevel(-30) < 1);
});

function gesture() {
  const events = [];
  let pending = null;
  const g = createMicGesture({
    onTap: () => events.push("tap"),
    onHoldStart: () => events.push("hold"),
    onHoldRelease: () => events.push("send"),
    onHoldCancel: () => events.push("cancel"),
    onCancelArmed: (armed) => events.push(armed ? "armed" : "disarmed"),
    setTimeout: (fn) => {
      pending = fn;
      return 1;
    },
    clearTimeout: () => {
      pending = null;
    },
  });
  return { g, events, fire: () => pending?.() };
}

test("a quick tap starts tap mode", () => {
  const { g, events } = gesture();
  g.press(200);
  g.release();
  assert.deepEqual(events, ["tap"]);
});

test("hold then release sends; sliding left more than 80 px cancels", () => {
  assert.equal(HOLD_CANCEL_DISTANCE_PX, 80);
  const a = gesture();
  a.g.press(300);
  a.fire();
  a.g.move(300 - 79);
  a.g.release();
  assert.deepEqual(a.events, ["hold", "send"]);

  const b = gesture();
  b.g.press(300);
  b.fire();
  b.g.move(300 - 81);
  assert.deepEqual(b.events, ["hold", "armed", "cancel"]);
  b.g.release();
  assert.deepEqual(b.events, ["hold", "armed", "cancel"], "release after a cancel does nothing");
});

test("a gesture taken over by the system cancels the hold", () => {
  const { g, events, fire } = gesture();
  g.press(100);
  fire();
  g.terminate();
  assert.deepEqual(events, ["hold", "cancel"]);
});

function senderDeps(log) {
  return {
    readBytes: async () => new Uint8Array(1000).fill(7),
    upload: async (path, headers, body) => {
      log.push({ path, headers, body });
      return { id: "a1", name: "encrypted", mimeType: "application/octet-stream", size: body.length, url: "/u/a1" };
    },
    sendDm: async (peer, text) => log.push({ peer, text }),
    sendRoom: async (channel, attachment) => log.push({ channel, attachment }),
  };
}

const draft = { uri: "file:///r.m4a", mime: "audio/mp4", meta: { ms: 4200, wave: encodeWave([0.2, 0.8]) } };

test("encrypted DM upload is padded to 128 KB, encrypted, and carries no voice headers", async () => {
  const log = [];
  const { sendVoiceNote } = createVoiceNoteSender(senderDeps(log));
  await sendVoiceNote({ kind: "dm", id: "peer", encrypted: true }, draft);
  const [upload, message] = log;
  assert.equal(upload.path, "/api/dms/peer/attachments");
  assert.equal(upload.headers["X-File-Name"], "encrypted");
  assert.equal(upload.headers["X-File-Type"], "application/octet-stream");
  assert.equal(upload.headers["X-Voice-Note"], undefined);
  const attachment = JSON.parse(message.text.slice("__DECAVE_DM_ATTACHMENT__".length));
  const plain = decryptAttachment(upload.body, attachment.fileKey);
  assert.equal(plain.length, VOICE_NOTE_PAD_STEP);
  assert.equal(plain[999], 7);
  assert.equal(plain[1000], 0);
  assert.deepEqual(attachment.voice, { ms: 4200, wave: draft.meta.wave, bytes: 1000 });
  assert.equal(attachment.name, "Voice message.mp4");
  assert.deepEqual(voiceAttachmentMeta(attachment), attachment.voice);
});

test("Hub upload sends X-Voice-Note and the room message carries attachment.voice", async () => {
  const log = [];
  const { sendVoiceNote } = createVoiceNoteSender(senderDeps(log));
  await sendVoiceNote({ kind: "room", id: "42", encrypted: false }, draft);
  assert.equal(log[0].path, "/api/channels/42/attachments");
  assert.equal(log[0].headers["X-Voice-Note"], "1");
  assert.equal(log[0].body.length, 1000, "Hub audio is not padded");
  assert.deepEqual(log[1].attachment.voice, { ms: 4200, wave: draft.meta.wave });
});

function receiptHarness() {
  const store = new Map();
  const local = [];
  const calls = [];
  let status = 500;
  const session = {
    ownReactions: (id) => (id === "m1" ? [] : undefined),
    hasPlayed: () => false,
    sealReactions: async (owner, id, emojis, options) => ({ id, from: "me", to: owner, p: options?.played }),
  };
  const { sendPlayed } = createDmE2eeSending(session);
  const apiFetch = async (path, init, token) => {
    calls.push({ path, method: init.method, token, body: JSON.parse(init.body) });
    return { ok: status === 200, json: async () => ({}) };
  };
  const receipts = createPlayedReceipts({
    send: (message, token, selfId) => sendPlayed(receiptRequest(apiFetch, token), message, selfId),
    markLocal: (account, id) => local.push(`${account}:${id}`),
    loadPending: (account) => store.get(account) ?? [],
    savePending: (account, list) => store.set(account, list),
  });
  return { receipts, store, local, calls, setStatus: (s) => (status = s) };
}

test("a failed Played mark stays pending and is sent again on retry (real sending glue)", async () => {
  const h = receiptHarness();
  h.receipts.report("me", { id: "m1", fromUserId: "peer", timestamp: "x" }, "tok-1");
  h.receipts.report("me", { id: "m1", fromUserId: "peer" }, "tok-1"); // in flight: not sent twice
  await settle();
  assert.deepEqual(h.local, ["me:m1", "me:m1"], "the dot clears right away");
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].path, "/api/dms/messages/m1/reactions");
  assert.equal(h.calls[0].method, "POST");
  assert.equal(h.calls[0].token, "tok-1", "token passed through the call");
  assert.deepEqual(h.calls[0].body, { envelope: { id: "m1", from: "me", to: "peer", p: true } });
  assert.deepEqual(
    h.store.get("me").map((p) => p.id),
    ["m1"],
    "still pending after the failure",
  );

  h.setStatus(200);
  h.receipts.retry("me", "tok-2");
  await settle();
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].token, "tok-2");
  assert.deepEqual(h.store.get("me"), [], "accepted: no longer pending");
  h.receipts.retry("me", "tok-2");
  await settle();
  assert.equal(h.calls.length, 2, "nothing left to resend");
  h.receipts.report("me", { id: "m2", fromUserId: "me" }, "tok-2");
  assert.equal(h.calls.length, 2, "own notes send no receipt");
});

test("DM glue retries pending Played marks on mount and reconnect, and no token lives in module state", () => {
  const note = read("mobile/src/components/voice-notes/DmVoiceNote.tsx");
  assert.match(note, /dmPlayedReceipts\.retry\(selfId, token\)/);
  assert.match(note, /dmPlayedReceipts\.report\(selfId, message, token\)/);
  assert.doesNotMatch(note, /receiptToken/);
  const dm = read("mobile/app/dm/[id].tsx");
  assert.match(dm, /connectionState === "connected"[\s\S]{0,120}dmPlayedReceipts\.retry/);
  assert.match(read("mobile/src/lib/account-local-data.ts"), /forgetLocallyPlayed\(accountId\)/);
});

test("the local played set keeps the newest 2,000 ids", () => {
  let ids = [];
  for (let i = 0; i < 2005; i++) ids = addPlayedId(ids, `m${i}`);
  assert.equal(ids.length, 2000);
  assert.equal(ids[0], "m5");
  assert.equal(addPlayedId(ids, "m2004").length, 2000);
});

test("playback queue plays one note at a time and the tracker fires once past half", async () => {
  const players = [];
  const app = appState();
  const queue = createPlaybackQueue(() => {
    const p = { calls: [], listener: null, rate: 1 };
    p.load = (uri) => p.calls.push(`load:${uri}`);
    p.play = () => p.calls.push("play");
    p.pause = () => p.calls.push("pause");
    p.seek = (s) => p.calls.push(`seek:${s}`);
    p.setRate = (r) => (p.rate = r);
    p.onStatus = (fn) => (p.listener = fn);
    p.release = () => p.calls.push("release");
    players.push(p);
    return p;
  }, app.subscribe);
  const paused = [];
  const handlers = (id) => ({
    onTime() {},
    onPlaying() {},
    onPaused: () => paused.push(id),
    onEnded() {},
    onError() {},
  });
  await queue.play("a", "file:///a", 0, 1, handlers("a"));
  await queue.play("b", "file:///b", 2, 1.5, handlers("b"));
  assert.equal(players.length, 1, "one shared player");
  assert.deepEqual(paused, ["a"]);
  assert.equal(players[0].rate, 1.5);
  assert.equal(queue.current(), "b");
  app.emit("background");
  assert.equal(players[0].calls.at(-1), "pause", "backgrounding pauses playback");

  // A seek before the new file has loaded is applied once the player reports it loaded.
  queue.seek("b", 7);
  assert.ok(!players[0].calls.includes("seek:7"));
  assert.ok(!players[0].calls.includes("seek:2"), "start position waits for the load too");
  players[0].listener({ currentTime: 0, playing: true, didJustFinish: false, loaded: true });
  assert.ok(players[0].calls.includes("seek:7"));
  queue.seek("b", 3);
  assert.ok(players[0].calls.includes("seek:3"), "loaded: seeks straight away");

  let fired = 0;
  const tracker = createPlayedTracker(() => fired++);
  for (let s = 0; s <= 6; s++) tracker.update(s, 10);
  tracker.end();
  assert.equal(fired, 1);
  assert.equal(nextSpeed(1), 1.5);
  assert.equal(nextSpeed(2), 1);
});

test("DM and Hub screens render voice attachments with VoiceNoteBubble", () => {
  const dm = read("mobile/app/dm/[id].tsx");
  const channel = read("mobile/app/channel/[id].tsx");
  assert.match(dm, /<DmVoiceNote\b/);
  assert.match(dm, /<VoiceComposer\b/);
  assert.doesNotMatch(dm, /DM_RECEIPT_UPDATED/);
  assert.match(dm, /DM_REACTION_UPDATED/);
  assert.match(channel, /<HubVoiceNote\b/);
  assert.match(channel, /<VoiceComposer\b/);
  assert.match(read("mobile/src/components/voice-notes/DmVoiceNote.tsx"), /<VoiceNoteBubble\b/);
  assert.match(read("mobile/src/components/voice-notes/HubVoiceNote.tsx"), /<VoiceNoteBubble\b/);
  assert.match(read("mobile/src/components/MessageMedia.tsx"), /VoiceNoteBubble|voice-notes/);
});

test("decrypted audio goes to a cache file that is deleted again; iOS has a mic description", () => {
  const audio = read("mobile/src/components/voice-notes/audio-file.ts");
  assert.match(audio, /Paths\.cache/);
  assert.match(audio, /\.delete\(\)/);
  assert.match(audio, /unpadVoiceNote/);
  const app = JSON.parse(read("mobile/app.json"));
  assert.ok(app.expo.ios.infoPlist.NSMicrophoneUsageDescription);
  const hook = read("mobile/src/components/voice-notes/useVoiceRecorder.ts");
  assert.match(hook, /isMeteringEnabled:\s*true/);
  assert.match(hook, /numberOfChannels:\s*1/);
  assert.match(hook, /setAudioModeAsync/);
  assert.match(hook, /inCall/, "the call's audio session is left alone");
});

test("recorder and playback controllers stop listening to AppState when disposed", () => {
  let subscribed = 0;
  const subscribeAppState = () => {
    subscribed++;
    return () => subscribed--;
  };
  const rec = createVoiceRecorderController(fakeDeps({ subscribeAppState }));
  const queue = createPlaybackQueue(
    () => ({ load() {}, play() {}, pause() {}, seek() {}, setRate() {}, onStatus() {} }),
    subscribeAppState,
  );
  assert.equal(subscribed, 2);
  rec.dispose();
  queue.dispose();
  assert.equal(subscribed, 0);
});
