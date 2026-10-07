import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { ClearVoicePipeline } from "../../src/audio/clearvoice/ClearVoicePipeline.ts";
import { VoiceActivationGate } from "../../src/audio/clearvoice/VoiceActivationGate.ts";

const SAMPLE_RATE = 48_000;
const QUANTUM = 128;

function processSignal(mode, makeSample, warmupBlocks = 500, measuredBlocks = 200) {
  const pipeline = new ClearVoicePipeline(SAMPLE_RATE, mode);
  const input = new Float32Array(QUANTUM);
  const output = new Float32Array(QUANTUM);
  let inputEnergy = 0;
  let outputEnergy = 0;
  let measuredSamples = 0;
  let metrics = pipeline.getMetrics();

  for (let block = 0; block < warmupBlocks + measuredBlocks; block += 1) {
    for (let index = 0; index < QUANTUM; index += 1) {
      input[index] = makeSample(block * QUANTUM + index);
    }
    metrics = pipeline.process(input, output);
    if (block >= warmupBlocks) {
      for (let index = 0; index < QUANTUM; index += 1) {
        inputEnergy += input[index] ** 2;
        outputEnergy += output[index] ** 2;
      }
      measuredSamples += QUANTUM;
    }
  }

  return {
    inputRms: Math.sqrt(inputEnergy / measuredSamples),
    outputRms: Math.sqrt(outputEnergy / measuredSamples),
    metrics,
  };
}

test("ClearVoice attenuates steady broadband room noise", () => {
  for (const mode of ["standard", "strong"]) {
    const result = processSignal(mode, () => (Math.random() * 2 - 1) * 0.012);
    assert.ok(result.outputRms < result.inputRms * 0.35, `${mode} did not attenuate noise enough`);
    assert.ok(result.metrics.speechProbability < 0.35, `${mode} misclassified steady noise as speech`);
  }
});

test("ClearVoice preserves a sustained voice-like signal", () => {
  const result = processSignal("strong", (sample) => {
    const speech = 0.12 * Math.sin((2 * Math.PI * 220 * sample) / SAMPLE_RATE);
    const roomNoise = (Math.random() * 2 - 1) * 0.006;
    return speech + roomNoise;
  });

  assert.ok(result.outputRms > result.inputRms * 0.7, "speech was attenuated too aggressively");
  assert.ok(result.metrics.speechProbability >= 0.75, "voice confidence did not remain high");
  assert.ok(result.metrics.gain >= 0.7, "voice gain fell below the preservation floor");
});

test("ClearVoice uses continuous gain instead of a binary speech gate", () => {
  const result = processSignal("standard", () => (Math.random() * 2 - 1) * 0.02);
  assert.ok(result.metrics.gain > 0.08 && result.metrics.gain < 1, "noise gain was not smoothly attenuated");
  assert.ok(Number.isFinite(result.metrics.attenuationDb));
});

function processVoiceGate(makeSample, config, blocks = 900) {
  const gate = new VoiceActivationGate(SAMPLE_RATE, config);
  const input = new Float32Array(QUANTUM);
  const output = new Float32Array(QUANTUM);
  let inputEnergy = 0;
  let outputEnergy = 0;
  let metrics = gate.getMetrics();
  for (let block = 0; block < blocks; block += 1) {
    for (let index = 0; index < QUANTUM; index += 1) {
      input[index] = makeSample(block * QUANTUM + index);
    }
    metrics = gate.process(input, output);
    if (block >= Math.floor(blocks / 2)) {
      for (let index = 0; index < QUANTUM; index += 1) {
        inputEnergy += input[index] ** 2;
        outputEnergy += output[index] ** 2;
      }
    }
  }
  return {
    inputRms: Math.sqrt(inputEnergy / (Math.floor(blocks / 2) * QUANTUM)),
    outputRms: Math.sqrt(outputEnergy / (Math.floor(blocks / 2) * QUANTUM)),
    metrics,
  };
}

test("voice activation silences sustained audio below the selected threshold", () => {
  const amplitude = 10 ** (-52 / 20);
  const result = processVoiceGate((sample) => amplitude * Math.sin((2 * Math.PI * 180 * sample) / SAMPLE_RATE), {
    enabled: true,
    thresholdDb: -42,
  });
  assert.ok(result.outputRms < result.inputRms * 0.002, "below-threshold sound remained audible");
  assert.equal(result.metrics.open, false);
  assert.equal(result.metrics.audible, false);
});

test("voice activation preserves sustained speech above the selected threshold", () => {
  const result = processVoiceGate((sample) => 0.08 * Math.sin((2 * Math.PI * 220 * sample) / SAMPLE_RATE), {
    enabled: true,
    thresholdDb: -42,
  });
  assert.ok(result.outputRms > result.inputRms * 0.97, "speech was attenuated while the gate was open");
  assert.equal(result.metrics.open, true);
  assert.equal(result.metrics.audible, true);
});

test("voice activation thresholds use the raw microphone sidechain", () => {
  const gate = new VoiceActivationGate(SAMPLE_RATE, { enabled: true, thresholdDb: -42 });
  const input = new Float32Array(QUANTUM);
  const raw = new Float32Array(QUANTUM);
  const output = new Float32Array(QUANTUM);
  const processedAmplitude = 0.12;
  const rawAmplitude = 10 ** (-52 / 20);
  let metrics = gate.getMetrics();
  let outputEnergy = 0;
  for (let block = 0; block < 900; block += 1) {
    input.fill(processedAmplitude);
    raw.fill(rawAmplitude);
    metrics = gate.process(input, output, raw);
    if (block >= 450) {
      for (const sample of output) outputEnergy += sample ** 2;
    }
  }
  assert.ok(metrics.inputDb < -50, "threshold meter did not use raw microphone level");
  assert.equal(metrics.open, false);
  assert.ok(outputEnergy < 0.01, "processed audio stayed audible below the raw threshold");
});

test("voice activation does not stay open for sparse sub-threshold transients", () => {
  const gate = new VoiceActivationGate(SAMPLE_RATE, { enabled: true, thresholdDb: -42 });
  const input = new Float32Array(QUANTUM);
  const raw = new Float32Array(QUANTUM);
  const output = new Float32Array(QUANTUM);
  let metrics = gate.getMetrics();
  for (let block = 0; block < 900; block += 1) {
    input.fill(0.12);
    raw.fill(block % 8 === 0 ? 0.01 : 0);
    metrics = gate.process(input, output, raw);
  }
  assert.ok(metrics.inputDb < -42, "sparse transient average was above the threshold");
  assert.equal(metrics.open, false, "sparse sub-threshold transients kept the gate open");
});

test("voice activation rejects a brief above-threshold impact", () => {
  const gate = new VoiceActivationGate(SAMPLE_RATE, { enabled: true, thresholdDb: -42 });
  const input = new Float32Array(QUANTUM);
  const output = new Float32Array(QUANTUM);
  let outputPeak = 0;
  let everOpened = false;
  for (let block = 0; block < 160; block += 1) {
    // Eight render quanta are about 21 ms at 48 kHz: longer than an ordinary
    // mouse click, but still shorter than the sustained onset required to open.
    input.fill(block >= 40 && block < 48 ? 0.45 : 0);
    const metrics = gate.process(input, output);
    everOpened ||= metrics.open;
    for (const sample of output) outputPeak = Math.max(outputPeak, Math.abs(sample));
  }
  assert.equal(everOpened, false, "a brief impact opened the microphone");
  assert.ok(outputPeak < 0.0001, "the delayed impact leaked through the closed gate");
});

test("voice activation bypasses the threshold for push-to-talk", () => {
  const amplitude = 10 ** (-58 / 20);
  const result = processVoiceGate((sample) => amplitude * Math.sin((2 * Math.PI * 180 * sample) / SAMPLE_RATE), {
    enabled: false,
    thresholdDb: -20,
  });
  assert.ok(result.outputRms > result.inputRms * 0.97, "push-to-talk audio was gated");
  assert.equal(result.metrics.open, true);
});

test("automatic sensitivity preserves quiet continuous speech without UI updates", () => {
  const result = processVoiceGate(
    (sample) => 0.012 * Math.sin((2 * Math.PI * 220 * sample) / SAMPLE_RATE),
    { enabled: true, automatic: true, thresholdDb: -45 },
    12000,
  );
  assert.ok(result.outputRms > result.inputRms * 0.9);
  assert.equal(result.metrics.open, true);
  assert.ok(result.metrics.thresholdDb <= -50);
});

test("automatic sensitivity rejects a quiet steady noise floor", () => {
  let seed = 19;
  const result = processVoiceGate(
    () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return ((seed / 4294967296) * 2 - 1) * 0.001;
    },
    { enabled: true, automatic: true, thresholdDb: -45 },
  );
  assert.ok(result.outputRms < result.inputRms * 0.002);
  assert.equal(result.metrics.open, false);
});

test("automatic sensitivity recovers from a raw-sidechain lock-open residual", () => {
  const gate = new VoiceActivationGate(SAMPLE_RATE, {
    enabled: true,
    automatic: true,
    thresholdDb: -45,
  });
  const pipeline = new ClearVoicePipeline(SAMPLE_RATE, "strong");
  const input = new Float32Array(QUANTUM);
  const processed = new Float32Array(QUANTUM);
  const output = new Float32Array(QUANTUM);
  let seed = 0x12345678;
  let finalMetrics = gate.getMetrics();
  let finalOpenBlocks = 0;
  for (let block = 0; block < 11_250; block += 1) {
    for (let index = 0; index < QUANTUM; index += 1) {
      seed = Math.imul(seed, 1664525) + 1013904223;
      input[index] = (((seed >>> 0) / 4294967296) * 2 - 1) * 0.02;
    }
    pipeline.process(input, processed);
    finalMetrics = gate.process(processed, output, input);
    if (block >= 7_500 && finalMetrics.open) finalOpenBlocks += 1;
  }
  assert.ok(finalMetrics.postDb > -46, "the post suppression residual was not exercised");
  assert.ok(finalMetrics.rawDb > -42, "the raw sidechain was not high enough to reproduce the stale threshold");
  assert.equal(finalMetrics.open, false, "adaptive gate remained locked open on steady residual noise");
  assert.equal(finalMetrics.audible, false, "post gate activity reported speech after output was silenced");
  assert.ok(finalOpenBlocks < 500, "adaptive gate stayed open for most of the final ten seconds");
  assert.ok(finalMetrics.thresholdDb >= -32, "adaptive threshold did not move above the residual");
});

test("voice activation reports measured output activity separately from an open target", () => {
  const gate = new VoiceActivationGate(SAMPLE_RATE, { enabled: false });
  const input = new Float32Array(QUANTUM);
  const output = new Float32Array(QUANTUM);
  const metrics = gate.process(input, output);
  assert.equal(metrics.open, true, "push-to-talk bypass should keep the target open");
  assert.equal(metrics.audible, false, "silence must not be reported as transmitted activity");
  assert.equal(metrics.outputRms, 0);
  assert.equal(metrics.activity, 0);
});

test("voice activation reset clears delayed audio and adaptive history", () => {
  const gate = new VoiceActivationGate(SAMPLE_RATE, { enabled: false, automatic: true, thresholdDb: -45 });
  const input = new Float32Array(QUANTUM).fill(0.08);
  const output = new Float32Array(QUANTUM);
  for (let block = 0; block < 40; block += 1) gate.process(input, output);
  gate.reset();
  input.fill(0);
  const metrics = gate.process(input, output);
  assert.equal(metrics.outputRms, 0, "reset leaked samples from the previous capture");
  assert.equal(metrics.audible, false);
  assert.ok(metrics.noiseFloorDb <= -50, "reset kept a stale elevated noise floor");
});

test("invalid microphone samples do not contaminate delayed gate output", () => {
  const gate = new VoiceActivationGate(SAMPLE_RATE, { enabled: false });
  const input = new Float32Array(QUANTUM).fill(0.1);
  const output = new Float32Array(QUANTUM);
  input[1] = NaN;
  input[2] = Infinity;
  for (let block = 0; block < 30; block++) {
    gate.process(input, output);
    assert.ok(output.every(Number.isFinite));
  }
});

const gateModule = await import("../../src/audio/clearvoice/VoiceActivationGate.ts");
const voiceActivationWorklet = ts.transpileModule(
  fs.readFileSync(new URL("../../src/audio/clearvoice/VoiceActivationProcessor.worklet.ts", import.meta.url), "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
).outputText;

function createVoiceActivationProcessor(options) {
  let Processor;
  new Function(
    "require",
    "exports",
    "sampleRate",
    "AudioWorkletProcessor",
    "registerProcessor",
    voiceActivationWorklet,
  )(
    (specifier) => {
      if (specifier === "./VoiceActivationGate") return gateModule;
      throw new Error(`Unexpected worklet import ${specifier}`);
    },
    {},
    SAMPLE_RATE,
    class {
      port = { postMessage: () => {} };
    },
    (_name, constructor) => {
      Processor = constructor;
    },
  );
  return new Processor({ processorOptions: options });
}

// A quiet voiced tone: below the automatic threshold and too faint for the
// gate's own speech estimate, so only a model speech score can hold it open.
const quietVoice = (sample) => 10 ** (-56 / 20) * Math.SQRT2 * Math.sin((2 * Math.PI * 220 * sample) / SAMPLE_RATE);

function runVoiceActivationWorklet(processor, scoreAt, blocks, startBlock = 0) {
  let inputEnergy = 0;
  let outputEnergy = 0;
  for (let block = startBlock; block < startBlock + blocks; block += 1) {
    const input = new Float32Array(QUANTUM);
    for (let index = 0; index < QUANTUM; index += 1) input[index] = quietVoice(block * QUANTUM + index);
    const score = scoreAt(block);
    const inputs = [[input], [input], score === null ? [] : [new Float32Array(QUANTUM).fill(score)]];
    const outputs = [[new Float32Array(QUANTUM)]];
    processor.process(inputs, outputs);
    if (block >= startBlock + blocks / 2) {
      for (let index = 0; index < QUANTUM; index += 1) {
        inputEnergy += input[index] ** 2;
        outputEnergy += outputs[0][0][index] ** 2;
      }
    }
  }
  return Math.sqrt(outputEnergy) / Math.max(Math.sqrt(inputEnergy), 1e-12);
}

const automaticGate = { enabled: true, automatic: true, thresholdDb: -45 };

test("a confident model speech score holds the gate open for quiet speech", () => {
  const processor = createVoiceActivationProcessor(automaticGate);
  assert.ok(runVoiceActivationWorklet(processor, () => 0.9, 900) > 0.9, "quiet speech was gated out");
});

test("a hesitant model speech score does not open the gate", () => {
  // Measured on recordings: opening at the gate's own 0.46 point let steady
  // heavy noise open it twice as often, so the model must be clearly confident.
  const processor = createVoiceActivationProcessor(automaticGate);
  assert.ok(runVoiceActivationWorklet(processor, () => 0.62, 900) < 0.01, "a 0.62 score opened the gate");
});

test("the gate stops using the model score when its input is disconnected", () => {
  const processor = createVoiceActivationProcessor(automaticGate);
  assert.ok(runVoiceActivationWorklet(processor, () => 0.9, 900) > 0.9);
  assert.ok(runVoiceActivationWorklet(processor, () => null, 900, 900) < 0.01, "a stale score kept the gate open");
});
