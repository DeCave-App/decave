import assert from "node:assert/strict";
import test from "node:test";
import { inputMeterLevelDb } from "../../src/voice/input-meter.ts";

// In automatic sensitivity the gate compares the level after noise
// suppression with its threshold. A raw meter next to that threshold showed
// room noise "above the threshold" while the gate correctly stayed closed.
test("automatic sensitivity meters the level the gate actually compares", () => {
  assert.equal(inputMeterLevelDb({ rawDb: -22, pushToTalk: false, gate: { inputDb: -80 } }), -80);
  assert.equal(inputMeterLevelDb({ rawDb: -46, pushToTalk: false, gate: { inputDb: -38 } }), -38);
});

test("without gate readings the meter falls back to the raw microphone", () => {
  assert.equal(inputMeterLevelDb({ rawDb: -46, pushToTalk: false, gate: null }), -46);
  assert.equal(inputMeterLevelDb({ rawDb: -46, pushToTalk: false, gate: { inputDb: Number.NaN } }), -46);
});

test("push-to-talk has no threshold, so it meters the raw microphone", () => {
  assert.equal(inputMeterLevelDb({ rawDb: -30, pushToTalk: true, gate: { inputDb: -80 } }), -30);
});
