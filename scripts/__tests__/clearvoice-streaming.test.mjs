import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { createPeriodicHannWindow, transformInPlace } from "../../src/audio/clearvoice/ClearVoiceStreamingTransform.ts";

const source = fs
  .readFileSync(new URL("../../src/audio/clearvoice/ClearVoiceAiProcessor.worklet.ts", import.meta.url), "utf8")
  .replace(/import\s*\{[\s\S]*?\}\s*from\s*"\.\/ClearVoiceStreamingTransform";/, "");
const compiledSource = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function createProcessor(rate, messages) {
  let Processor;
  vm.runInNewContext(compiledSource, {
    createPeriodicHannWindow,
    transformInPlace,
    sampleRate: rate,
    AudioWorkletProcessor: class {
      port = { postMessage: (message) => messages.push(message) };
    },
    registerProcessor: (_name, constructor) => {
      Processor = constructor;
    },
  });
  return new Processor();
}

test("AI buffers worker jitter, emits audio, and reports a sustained stall", () => {
  const messages = [];
  const processor = createProcessor(48000, messages);
  const input = [[new Float32Array(128)]];
  const output = [[new Float32Array(128)]];
  const render = () => processor.process(input, output);
  for (let i = 0; i < 20; i++) processor.processedQueue.push(0.2);
  render();
  assert.ok(output[0][0][0] > 0.19);
  assert.ok(output[0][0].every(Number.isFinite));
  for (let i = 0; i < 12; i++) render();
  assert.equal(messages.filter((message) => message.type === "underrun").length, 0);
  for (let i = 0; i < 45; i++) render();
  assert.equal(messages.filter((message) => message.type === "underrun").length, 1);
  assert.ok(output[0][0].every(Number.isFinite));
});

test("AI adapter accepts common device sample rates and still produces model frames", () => {
  for (const rate of [44100, 48000, 96000, 192000]) {
    const messages = [];
    const modelFrames = [];
    const processor = createProcessor(rate, messages);
    const modelPort = {
      postMessage: (message) => modelFrames.push(message),
      start: () => {},
    };
    processor.port.onmessage({ data: { type: "connect", port: modelPort } });
    modelPort.onmessage({ data: { type: "ready" } });
    const input = [[new Float32Array(128)]];
    const output = [[new Float32Array(128)]];
    for (let index = 0; index < 150; index += 1) processor.process(input, output);
    assert.equal(
      messages.some((message) => message.type === "error"),
      false,
      `${rate} Hz should not reject startup`,
    );
    assert.ok(modelFrames.length > 0, `${rate} Hz should reach the model`);
  }
});

test("AI adapter reset drops delayed samples and restarts the model sequence", () => {
  const messages = [];
  const processor = createProcessor(48000, messages);
  const modelMessages = [];
  const modelPort = {
    postMessage: (message) => modelMessages.push(message),
    start: () => {},
  };
  processor.port.onmessage({ data: { type: "connect", port: modelPort } });
  modelPort.onmessage({ data: { type: "ready" } });
  processor.processedQueue.push(0.2);
  processor.process([[new Float32Array(128)]], [[new Float32Array(128)]]);
  processor.port.onmessage({ data: { type: "reset" } });
  const output = [[new Float32Array(128)]];
  processor.process([[new Float32Array(128)]], output);
  assert.equal(output[0][0][0], 0);
  assert.equal(processor.modelStarted, false);
  assert.ok(modelMessages.some((message) => message.type === "reset"));
});

// A pass-through stand-in for the model worker: every analysed spectrum comes
// back unchanged, so only the adapter around the model shapes the audio.
function createPassThroughProcessor(rate, speechProbability = 0.8) {
  const messages = [];
  const processor = createProcessor(rate, messages);
  const modelPort = { start: () => {} };
  modelPort.postMessage = (message) => {
    if (message.type === "frame")
      modelPort.onmessage({
        data: { type: "result", sequence: message.sequence, spectrum: message.spectrum, speechProbability },
      });
  };
  processor.port.onmessage({ data: { type: "connect", port: modelPort } });
  modelPort.onmessage({ data: { type: "ready" } });
  return { processor, messages };
}

function renderTone(frequency, seconds = 1.2, rate = 48000) {
  const { processor } = createPassThroughProcessor(rate);
  const output = new Float32Array(Math.round((seconds * rate) / 128) * 128);
  const block = new Float32Array(128);
  for (let offset = 0; offset < output.length; offset += 128) {
    for (let index = 0; index < 128; index += 1)
      block[index] = 0.25 * Math.sin((2 * Math.PI * frequency * (offset + index)) / rate);
    const out = [[new Float32Array(128)]];
    processor.process([[block]], out);
    output.set(out[0][0], offset);
  }
  return output.subarray(Math.round(0.4 * rate));
}

// Goertzel level of one frequency, relative to a 0.25-amplitude input tone.
function toneLevelDb(signal, frequency, rate = 48000) {
  const coefficient = 2 * Math.cos((2 * Math.PI * frequency) / rate);
  let previous = 0;
  let beforePrevious = 0;
  for (let index = 0; index < signal.length; index += 1) {
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (signal.length - 1));
    const current = signal[index] * window + coefficient * previous - beforePrevious;
    beforePrevious = previous;
    previous = current;
  }
  const power = previous * previous + beforePrevious * beforePrevious - coefficient * previous * beforePrevious;
  const amplitude = (2 * Math.sqrt(Math.max(power, 0))) / (signal.length * 0.5);
  return 20 * Math.log10(Math.max(amplitude, 1e-12) / 0.25);
}

test("AI adapter passes the whole speech band at full level", () => {
  for (const frequency of [300, 1000, 4000, 6500]) {
    const level = toneLevelDb(renderTone(frequency), frequency);
    assert.ok(Math.abs(level) < 0.5, `${frequency} Hz came through at ${level.toFixed(2)} dB`);
  }
});

test("AI adapter keeps energy above the model band from folding into speech", () => {
  // 3:1 decimation folds 10 kHz to 6 kHz and 12 kHz to 4 kHz.
  for (const [frequency, folded] of [
    [10000, 6000],
    [12000, 4000],
  ]) {
    const output = renderTone(frequency);
    const level = Math.max(toneLevelDb(output, frequency), toneLevelDb(output, folded));
    assert.ok(level < -60, `${frequency} Hz leaked at ${level.toFixed(1)} dB`);
  }
});

test("AI adapter adds no mirror images above the model band", () => {
  // Upsampling 16 kHz audio can mirror a 5 kHz voice component to 11 and 21 kHz.
  const output = renderTone(5000);
  for (const image of [11000, 21000]) {
    const level = toneLevelDb(output, image);
    assert.ok(level < -60, `mirror image at ${image} Hz was ${level.toFixed(1)} dB`);
  }
});

test("AI adapter keeps input and output rates balanced over a long call", () => {
  const { processor, messages } = createPassThroughProcessor(48000);
  const block = new Float32Array(128).fill(0.01);
  let maximumQueue = 0;
  for (let quantum = 0; quantum < 12_000; quantum += 1) {
    processor.process([[block]], [[new Float32Array(128)]]);
    if (quantum > 100) maximumQueue = Math.max(maximumQueue, processor.processedQueue.length);
  }
  assert.equal(messages.filter((message) => message.type === "underrun").length, 0);
  assert.ok(maximumQueue < 2048, `processed queue grew to ${maximumQueue} samples`);
});

test("AI adapter publishes the model speech score on its second output", () => {
  const { processor } = createPassThroughProcessor(48000, 0.8);
  const block = new Float32Array(128).fill(0.01);
  const first = [[new Float32Array(128)], [new Float32Array(128).fill(-1)]];
  processor.process([[block]], first);
  assert.ok(
    first[1][0].every((value) => value === 0),
    "no score before the model has produced audio",
  );
  let latest;
  for (let quantum = 0; quantum < 40; quantum += 1) {
    latest = [[new Float32Array(128)], [new Float32Array(128)]];
    processor.process([[block]], latest);
  }
  assert.ok(
    latest[1][0].every((value) => Math.abs(value - 0.8) < 1e-6),
    "score follows the processed audio",
  );
});

test("AI adapter lets its speech score fade while the model is stalled", () => {
  const messages = [];
  const processor = createProcessor(48000, messages);
  let responding = true;
  const modelPort = { start: () => {} };
  modelPort.postMessage = (message) => {
    if (responding && message.type === "frame")
      modelPort.onmessage({
        data: { type: "result", sequence: message.sequence, spectrum: message.spectrum, speechProbability: 0.9 },
      });
  };
  processor.port.onmessage({ data: { type: "connect", port: modelPort } });
  modelPort.onmessage({ data: { type: "ready" } });
  const block = new Float32Array(128).fill(0.01);
  for (let quantum = 0; quantum < 40; quantum += 1)
    processor.process([[block]], [[new Float32Array(128)], [new Float32Array(128)]]);
  responding = false;
  let latest;
  for (let quantum = 0; quantum < 60; quantum += 1) {
    latest = [[new Float32Array(128)], [new Float32Array(128)]];
    processor.process([[block]], latest);
  }
  assert.ok(latest[1][0][127] < 0.05, `stale speech score ${latest[1][0][127].toFixed(3)} after a 160 ms stall`);
});
