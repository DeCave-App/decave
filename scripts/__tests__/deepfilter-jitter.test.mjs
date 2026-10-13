import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const source = fs.readFileSync(
  new URL("../../src/audio/deepfilter/DeepFilterProcessor.worklet.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(
  source.replace(/import\s*\{[^}]*\}\s*from\s*"\.\/jitterCushion";/, "const DEEP_FILTER_JITTER_CUSHION_SAMPLES = 960;"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText;

function createProcessor(messages) {
  let Processor;
  vm.runInNewContext(compiled, {
    sampleRate: 48000,
    AudioWorkletProcessor: class {
      port = { postMessage: (message) => messages.push(message) };
    },
    registerProcessor: (_name, ctor) => {
      Processor = ctor;
    },
  });
  return new Processor();
}

// A model worker that keeps up on average but answers each 10 ms hop after a
// variable delay (render quanta of 128 samples), like a real worker thread
// competing with the browser for CPU.
function runWithJitter(delays) {
  const messages = [];
  const processor = createProcessor(messages);
  const pending = [];
  let quantum = 0;
  processor.modelPort = {
    postMessage: (message) => {
      if (message.type !== "frame") return;
      const delay = delays[message.sequence % delays.length];
      pending.push({ at: quantum + delay, sequence: message.sequence, samples: message.samples });
    },
  };
  processor.modelReady = true;
  const input = [[new Float32Array(128).fill(0.5)]];
  const output = [[new Float32Array(128)]];
  let started = false;
  let gapSamples = 0;
  for (quantum = 0; quantum < 3000; quantum += 1) {
    for (const item of pending.filter((entry) => entry.at <= quantum)) {
      processor.handleModelMessage({ type: "result", sequence: item.sequence, samples: item.samples, lsnr: 0 });
    }
    pending.splice(0, pending.length, ...pending.filter((entry) => entry.at > quantum));
    processor.process(input, output);
    for (const value of output[0][0]) {
      if (value > 0.49) started = true;
      else if (started) gapSamples += 1;
    }
  }
  return { gapSamples, messages };
}

test("DeepFilterNet output has no gaps when the model worker answers with normal jitter", () => {
  // Mostly next quantum, sometimes ~10 ms late. Throughput always keeps up.
  const { gapSamples } = runWithJitter([1, 1, 1, 4, 1, 2, 1, 1, 4, 1]);
  assert.equal(gapSamples, 0, `voice was chopped for ${gapSamples} samples`);
});

test("DeepFilterNet still reports a sustained stall so the engine can fall back", () => {
  const { messages } = runWithJitter([1, 1, 1, 1, 1, 1, 1, 1, 1, 1_000_000]);
  assert.ok(messages.some((message) => message.type === "underrun"));
});
