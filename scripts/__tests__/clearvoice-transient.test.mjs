import assert from "node:assert/strict";
import test from "node:test";
import { ClearVoiceTransientDetector } from "../../src/audio/clearvoice/ClearVoiceTransientDetector.ts";

const SAMPLE_RATE = 16_000;
const FFT_SIZE = 512;
const BINS = FFT_SIZE / 2 + 1;

function spectrum({ low = 0, mid = 0, high = 0 } = {}) {
  const output = new Float32Array(BINS * 2);
  for (let bin = 0; bin < BINS; bin += 1) {
    const frequency = (bin * SAMPLE_RATE) / FFT_SIZE;
    const magnitude = frequency < 900 ? low : frequency >= 2500 ? high : mid;
    output[bin * 2] = magnitude;
  }
  return output;
}

function warm(detector, frame) {
  let result;
  for (let index = 0; index < 12; index += 1) result = detector.process(frame, 0.05);
  return result;
}

test("impact detector attenuates a low-frequency desk-thump body", () => {
  const detector = new ClearVoiceTransientDetector(SAMPLE_RATE, FFT_SIZE);
  const room = spectrum({ low: 0.012, mid: 0.008, high: 0.004 });
  warm(detector, room);
  const impact = detector.process(spectrum({ low: 1.0, mid: 0.55, high: 0.12 }), 0.05);

  assert.ok(impact.impactScore > 0.2, "impact was not detected");
  assert.ok(impact.impactState > 0.2, "impact state did not attack");
  assert.ok(impact.gains[4] < 0.8, "low-frequency impact body was not ducked");
});

test("speech protection reduces impact suppression on a voiced overlap", () => {
  const quietDetector = new ClearVoiceTransientDetector(SAMPLE_RATE, FFT_SIZE);
  const voicedDetector = new ClearVoiceTransientDetector(SAMPLE_RATE, FFT_SIZE);
  const room = spectrum({ low: 0.012, mid: 0.008, high: 0.004 });
  warm(quietDetector, room);
  warm(voicedDetector, room);
  const quiet = quietDetector.process(spectrum({ low: 1.0, mid: 0.55, high: 0.12 }), 0.05);
  const voiced = voicedDetector.process(spectrum({ low: 1.0, mid: 0.55, high: 0.12 }), 0.95);

  assert.ok(voiced.gains[4] > quiet.gains[4], "voiced overlap was not protected");
  assert.ok(voiced.gains[4] < 1, "impact was completely ignored during speech");
});

test("voiced broadband airflow does not trigger the full click suppressor", () => {
  const quietDetector = new ClearVoiceTransientDetector(SAMPLE_RATE, FFT_SIZE);
  const voicedDetector = new ClearVoiceTransientDetector(SAMPLE_RATE, FFT_SIZE);
  const room = spectrum({ low: 0.012, mid: 0.008, high: 0.004 });
  warm(quietDetector, room);
  warm(voicedDetector, room);

  const airflow = spectrum({ low: 0.02, mid: 0.34, high: 0.82 });
  const quiet = quietDetector.process(airflow, 0.18);
  const voiced = voicedDetector.process(airflow, 0.82);

  assert.ok(voiced.gains[220] > quiet.gains[220] + 0.08, "voiced airflow was suppressed like a click");
  assert.ok(voiced.clickScore < quiet.clickScore, "airflow protection did not reduce click confidence");
});
