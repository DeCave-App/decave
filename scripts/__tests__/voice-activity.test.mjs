import assert from "node:assert/strict";
import test from "node:test";
import { VoiceActivity } from "../../src/audio/VoiceActivity.ts";

test("quiet RTP speech lights up, holds word gaps and expires old sources", async () => {
  const activity = new VoiceActivity();
  let source = { audioLevel: 0.006, timestamp: 1000 };
  const receiver = { getSynchronizationSources: () => [source], getStats: async () => new Map() };
  assert.equal(await activity.speaking(receiver, 1000), true);
  source = { audioLevel: 0, timestamp: 1100 };
  assert.equal(await activity.speaking(receiver, 1100), true);
  assert.equal(await activity.speaking(receiver, 1300), false);
  source = { audioLevel: 0.9, timestamp: 1000 };
  assert.equal(await activity.speaking(receiver, 2000), false);
});

test("decoded energy detects speech without optional RTP audioLevel", async () => {
  const activity = new VoiceActivity();
  const report = { id: "audio", type: "inbound-rtp", kind: "audio", totalAudioEnergy: 0, totalSamplesDuration: 1 };
  const receiver = { getSynchronizationSources: () => [], getStats: async () => new Map([["audio", report]]) };
  assert.equal(await activity.speaking(receiver, 1000), false);
  report.totalSamplesDuration += 0.1;
  report.totalAudioEnergy += 0.006 ** 2 * 0.1;
  assert.equal(await activity.speaking(receiver, 1100), true);
  assert.equal(await activity.speaking(receiver, 1500), false, "unchanged counters must expire");
});

test("stats audioLevel works when synchronization sources throw", async () => {
  const activity = new VoiceActivity();
  const receiver = {
    getSynchronizationSources() {
      throw new Error("unsupported");
    },
    getStats: async () => new Map([["audio", { type: "inbound-rtp", kind: "audio", audioLevel: 0.01 }]]),
  };
  assert.equal(await activity.speaking(receiver, 1000), true);
});

test("ended receivers rejecting stats do not break other indicators", async () => {
  const receiver = {
    getSynchronizationSources: () => [],
    getStats: async () => {
      throw new Error("closed");
    },
  };
  assert.equal(await new VoiceActivity().speaking(receiver, 1000), false);
});
