import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createPeriodicHannWindow, transformInPlace } from "../../src/audio/clearvoice/ClearVoiceStreamingTransform.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("ClearVoice FFT followed by IFFT reconstructs the original frame", () => {
  const size = 512;
  const real = new Float32Array(size);
  const imaginary = new Float32Array(size);
  const expected = new Float32Array(size);
  for (let index = 0; index < size; index += 1) {
    const value =
      0.43 * Math.sin((2 * Math.PI * 13 * index) / size) + 0.17 * Math.cos((2 * Math.PI * 47 * index) / size);
    real[index] = value;
    expected[index] = value;
  }
  transformInPlace(real, imaginary);
  transformInPlace(real, imaginary, true);
  let maximumError = 0;
  for (let index = 0; index < size; index += 1) {
    maximumError = Math.max(maximumError, Math.abs(real[index] - expected[index]));
  }
  assert.ok(maximumError < 0.00001, `FFT/IFFT error was ${maximumError}`);
});

test("ClearVoice uses the periodic Hann window expected by PyTorch", () => {
  const size = 320;
  const window = createPeriodicHannWindow(size);
  assert.equal(window[0], 0);
  assert.ok(Math.abs(window[size / 2] - 1) < 1.0e-7);
  const expectedLast = 0.5 - 0.5 * Math.cos((2 * Math.PI * (size - 1)) / size);
  assert.ok(Math.abs(window[size - 1] - expectedLast) < 1.0e-7);
  assert.notEqual(window[size - 1], 0, "a symmetric Hann window was used instead");
});

test("the V6 worklet centers its window and performs a true inverse transform", () => {
  const source = fs.readFileSync(path.join(root, "src/audio/clearvoice/ClearVoiceAiProcessor.worklet.ts"), "utf8");
  assert.match(source, /const WINDOW_OFFSET = \(FFT_SIZE - WINDOW_SIZE\) \/ 2/);
  assert.match(source, /real\[WINDOW_OFFSET \+ index\] = this\.analysisBuffer\[index\]/);
  assert.match(source, /this\.synthesis\[index\] \+= real\[WINDOW_OFFSET \+ index\]/);
  assert.match(source, /transformInPlace\(real, imaginary, true\)/);
});

test("the source release disables ClearVoice AI and retains the existing fallback path", () => {
  const runtime = fs.readFileSync(path.join(root, "src/audio/clearvoice/ClearVoiceAiRuntime.ts"), "utf8");
  const engine = fs.readFileSync(path.join(root, "src/voice/engine.ts"), "utf8");
  assert.match(runtime, /ClearVoice AI models are not included in this source release/);
  assert.match(runtime, /throw new Error\(/);
  assert.match(
    engine,
    /catch \(clearVoiceAiError\)[\s\S]*?ClearVoice V6 unavailable; trying the legacy local RNNoise fallback:[\s\S]*?catch \(rnnoiseError\)[\s\S]*?effectiveMode = "strong"/,
  );
});

test("the SIMD probe recognizes a runtime with WebAssembly SIMD", async () => {
  // Node 24 implements WebAssembly SIMD, so a valid probe module must pass.
  // An invalid probe silently sent every browser to the slow scalar model.
  const { supportsWebAssemblySimd } = await import("../../src/audio/clearvoice/WebAssemblySimd.ts");
  assert.equal(supportsWebAssemblySimd(), true);
});
