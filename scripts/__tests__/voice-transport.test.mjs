import assert from "node:assert/strict";
import test from "node:test";
import {
  applyVoiceCodecPreferences,
  applyVoiceSenderParameters,
  preferRedundantVoiceCodecs,
  voiceBitrateForListeners,
  withVoiceOpusBitrate,
} from "../../src/voice/voice-transport.ts";

const chromeOffer = [
  "v=0",
  "o=- 4611731400430051336 2 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "a=group:BUNDLE 0 1",
  "m=audio 9 UDP/TLS/RTP/SAVPF 111 63 9 13 110",
  "c=IN IP4 0.0.0.0",
  "a=mid:0",
  "a=sendrecv",
  "a=rtpmap:111 opus/48000/2",
  "a=rtcp-fb:111 transport-cc",
  "a=fmtp:111 minptime=10;useinbandfec=1",
  "a=rtpmap:63 red/48000/2",
  "a=fmtp:63 111/111",
  "a=rtpmap:9 G722/8000",
  "a=rtpmap:13 CN/8000",
  "a=rtpmap:110 telephone-event/48000",
  "m=video 9 UDP/TLS/RTP/SAVPF 96",
  "c=IN IP4 0.0.0.0",
  "a=mid:1",
  "a=rtpmap:96 VP8/90000",
  "a=fmtp:96 max-fs=12288",
  "",
].join("\r\n");

test("remote Opus descriptions ask this client's encoder for the voice bitrate", () => {
  const result = withVoiceOpusBitrate({ type: "offer", sdp: chromeOffer }, 64_000);
  assert.equal(result.type, "offer");
  assert.equal(
    result.sdp,
    chromeOffer.replace(
      "a=fmtp:111 minptime=10;useinbandfec=1",
      "a=fmtp:111 minptime=10;useinbandfec=1;maxaveragebitrate=64000",
    ),
  );
});

test("an existing Opus bitrate is replaced in place and a second pass changes nothing", () => {
  const capped = chromeOffer.replace(
    "minptime=10;useinbandfec=1",
    "minptime=10;maxaveragebitrate=32000;useinbandfec=1",
  );
  const once = withVoiceOpusBitrate({ type: "answer", sdp: capped }, 64_000);
  assert.match(once.sdp, /\r\na=fmtp:111 minptime=10;maxaveragebitrate=64000;useinbandfec=1\r\n/);
  assert.equal(withVoiceOpusBitrate(once, 64_000).sdp, once.sdp);
});

test("an Opus payload without parameters gets bitrate and in-band FEC", () => {
  const bare = chromeOffer.replace("a=fmtp:111 minptime=10;useinbandfec=1\r\n", "");
  const result = withVoiceOpusBitrate({ type: "offer", sdp: bare }, 48_000);
  assert.match(result.sdp, /a=rtpmap:111 opus\/48000\/2\r\na=fmtp:111 maxaveragebitrate=48000;useinbandfec=1\r\n/);
});

test("RED, video and other codec parameters are left untouched", () => {
  const result = withVoiceOpusBitrate({ type: "offer", sdp: chromeOffer }, 64_000);
  assert.match(result.sdp, /\r\na=fmtp:63 111\/111\r\n/);
  assert.match(result.sdp, /\r\na=fmtp:96 max-fs=12288\r\n/);
  assert.doesNotMatch(result.sdp, /a=fmtp:(63|96)[^\r]*maxaveragebitrate/);
});

test("descriptions without SDP are returned unchanged", () => {
  const rollback = { type: "rollback" };
  assert.equal(withVoiceOpusBitrate(rollback, 64_000), rollback);
});

test("per-listener voice bitrate steps down as a mesh call grows", () => {
  const table = [
    [0, 64_000],
    [1, 64_000],
    [4, 64_000],
    [5, 48_000],
    [8, 48_000],
    [9, 32_000],
    [24, 32_000],
  ];
  for (const [listeners, bitrate] of table)
    assert.equal(voiceBitrateForListeners(listeners), bitrate, `${listeners} listeners`);
});

const opus = { mimeType: "audio/opus", clockRate: 48000, channels: 2, sdpFmtpLine: "minptime=10;useinbandfec=1" };
const red = { mimeType: "audio/red", clockRate: 48000, channels: 2 };
const cn = { mimeType: "audio/CN", clockRate: 8000 };
const dtmf = { mimeType: "audio/telephone-event", clockRate: 48000 };

test("RED is preferred ahead of plain Opus and the rest keep their order", () => {
  assert.deepEqual(preferRedundantVoiceCodecs([opus, cn, red, dtmf]), [red, opus, cn, dtmf]);
});

test("without RED support, plain Opus stays first", () => {
  assert.deepEqual(preferRedundantVoiceCodecs([cn, opus, dtmf]), [opus, cn, dtmf]);
});

test("codec preferences are installed on the microphone transceiver", () => {
  const calls = [];
  const transceiver = { setCodecPreferences: (codecs) => calls.push(codecs) };
  assert.equal(applyVoiceCodecPreferences(transceiver, { codecs: [opus, red, cn] }), true);
  assert.deepEqual(calls, [[red, opus, cn]]);
});

test("codec preferences fail soft when the browser cannot apply them", () => {
  assert.equal(
    applyVoiceCodecPreferences(
      {
        setCodecPreferences: () => {
          throw new Error("unsupported");
        },
      },
      { codecs: [opus, red] },
    ),
    false,
  );
  assert.equal(applyVoiceCodecPreferences({}, { codecs: [opus, red] }), false);
  assert.equal(applyVoiceCodecPreferences({ setCodecPreferences: () => {} }, null), false);
});

function fakeSender(encodings, setParameters = async () => {}, transportState = "connected") {
  const applied = [];
  return {
    applied,
    transport: { state: transportState },
    getParameters: () => ({ transactionId: "t1", encodings: encodings.map((encoding) => ({ ...encoding })) }),
    setParameters: async (parameters) => {
      applied.push(parameters);
      await setParameters(parameters);
    },
  };
}

test("before the connection is up only priority is set, so the negotiated rate governs", async () => {
  // Measured in Chromium: a cap set before connecting becomes the Opus target
  // as-is (75.2 kbps instead of 64), unlike the same cap applied once connected.
  const sender = fakeSender([{ active: true }], async () => {}, "new");
  assert.equal(await applyVoiceSenderParameters(sender, 1), true);
  assert.deepEqual(sender.applied[0].encodings, [{ active: true, priority: "high", networkPriority: "high" }]);
});

test("the microphone sender is prioritized and capped for the listener count", async () => {
  // Measured in Chromium: once a cap changes mid-call, the Opus target becomes
  // the cap minus 11.2 kbps of IPv4/UDP headers (28 bytes x 50 packets/s).
  // A 48 kbps voice step therefore needs a 59.2 kbps cap.
  const sender = fakeSender([{ active: true }]);
  assert.equal(await applyVoiceSenderParameters(sender, 6), true);
  assert.equal(sender.applied.length, 1);
  assert.equal(sender.applied[0].transactionId, "t1");
  assert.deepEqual(sender.applied[0].encodings, [
    { active: true, priority: "high", networkPriority: "high", maxBitrate: 59_200 },
  ]);
});

test("sender parameters are skipped before encodings exist and failures do not throw", async () => {
  const early = fakeSender([]);
  assert.equal(await applyVoiceSenderParameters(early, 1), false);
  assert.equal(early.applied.length, 0);
  const rejecting = fakeSender([{ active: true }], async () => {
    throw new Error("InvalidStateError");
  });
  assert.equal(await applyVoiceSenderParameters(rejecting, 1), false);
});

test("overlapping sender updates are serialized so neither is rejected as stale", async () => {
  // Per the WebRTC spec, setParameters must carry the transactionId of the
  // most recent getParameters call on that sender.
  let latest = 0;
  const applied = [];
  const sender = {
    transport: { state: "connected" },
    getParameters: () => ({ transactionId: String(++latest), encodings: [{ active: true }] }),
    setParameters: async (parameters) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (parameters.transactionId !== String(latest)) throw new Error("InvalidModificationError");
      applied.push(parameters.encodings[0].maxBitrate);
    },
  };
  const results = await Promise.all([applyVoiceSenderParameters(sender, 1), applyVoiceSenderParameters(sender, 6)]);
  assert.deepEqual(results, [true, true]);
  assert.deepEqual(applied, [75_200, 59_200]);
});
