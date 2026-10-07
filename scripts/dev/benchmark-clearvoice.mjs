#!/usr/bin/env node

/**
 * Reproducible local ClearVoice benchmark.
 *
 * Default fixtures are generated and contain no recorded speech. Real WAV
 * inputs require --consented and are measured in memory only; the runner does
 * not upload or write audio. Results report proxies, not intelligibility or
 * Krisp parity.
 *
 * Examples:
 *   node scripts/dev/benchmark-clearvoice.mjs
 *   node scripts/dev/benchmark-clearvoice.mjs --mode strong --duration 10 --output .tmp/clearvoice.json
 *   node scripts/dev/benchmark-clearvoice.mjs --speech ./consented.wav --consented
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { performance } from "node:perf_hooks";
import { ClearVoicePipeline } from "../../src/audio/clearvoice/ClearVoicePipeline.ts";
import { VoiceActivationGate } from "../../src/audio/clearvoice/VoiceActivationGate.ts";

const QUANTUM = 128;
const DEFAULT_RATE = 48_000;
const DEFAULT_DURATION = 4;
const VAD_THRESHOLD = 10 ** (-48 / 20);

function parseArgs(argv) {
  const args = { duration: DEFAULT_DURATION, sampleRate: DEFAULT_RATE, seed: 20260911, mode: "both" };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    if (key === "consented") {
      args.consented = true;
      continue;
    }
    const value = argv[++index];
    if (value === undefined) throw new Error(`Missing value for --${key}`);
    if (key === "duration") args.duration = Number(value);
    else if (key === "sample-rate") args.sampleRate = Number(value);
    else if (key === "seed") args.seed = Number(value);
    else if (key === "mode" || key === "output" || key === "speech" || key === "noise") args[key] = value;
    else throw new Error(`Unknown argument: --${key}`);
  }
  if (!Number.isFinite(args.duration) || args.duration <= 0 || args.duration > 120)
    throw new Error("--duration must be between 0 and 120 seconds");
  if (!Number.isInteger(args.sampleRate) || args.sampleRate < 8_000)
    throw new Error("--sample-rate must be an integer of at least 8000");
  if (!Number.isInteger(args.seed)) throw new Error("--seed must be an integer");
  if (!["standard", "strong", "both"].includes(args.mode)) throw new Error("--mode must be standard, strong or both");
  if ((args.speech || args.noise) && !args.consented) throw new Error("Real WAV inputs require --consented");
  return args;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function db(value) {
  return 20 * Math.log10(Math.max(value, 1.0e-8));
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function rms(values) {
  if (values.length === 0) return 0;
  let energy = 0;
  for (const value of values) energy += value * value;
  return Math.sqrt(energy / values.length);
}

function parsePcm16Wav(filename) {
  const bytes = fs.readFileSync(filename);
  if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`${filename} is not a RIFF/WAVE file`);
  }
  let offset = 12;
  let format = null;
  let data = null;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === "fmt ")
      format = {
        code: bytes.readUInt16LE(start),
        channels: bytes.readUInt16LE(start + 2),
        sampleRate: bytes.readUInt32LE(start + 4),
        bits: bytes.readUInt16LE(start + 14),
      };
    if (id === "data") data = bytes.subarray(start, Math.min(bytes.length, start + size));
    offset = start + size + (size & 1);
  }
  if (!format || !data || format.code !== 1 || format.bits !== 16) {
    throw new Error(`${filename} must be an uncompressed PCM16 WAV`);
  }
  const frameSize = format.channels * 2;
  const samples = new Float32Array(Math.floor(data.length / frameSize));
  for (let index = 0; index < samples.length; index += 1) {
    let sum = 0;
    for (let channel = 0; channel < format.channels; channel += 1) {
      sum += data.readInt16LE(index * frameSize + channel * 2) / 32768;
    }
    samples[index] = sum / format.channels;
  }
  return { sampleRate: format.sampleRate, samples };
}

function resample(samples, sourceRate, targetRate) {
  if (sourceRate === targetRate) return samples;
  const output = new Float32Array(Math.max(1, Math.round((samples.length * targetRate) / sourceRate)));
  for (let index = 0; index < output.length; index += 1) {
    const position = (index * sourceRate) / targetRate;
    const leftIndex = Math.floor(position);
    const fraction = position - leftIndex;
    const left = samples[Math.min(samples.length - 1, leftIndex)] ?? 0;
    const right = samples[Math.min(samples.length - 1, leftIndex + 1)] ?? left;
    output[index] = left + (right - left) * fraction;
  }
  return output;
}

function makeSpeech(sampleRate, duration, random) {
  const samples = new Float32Array(Math.ceil(sampleRate * duration));
  const mask = new Uint8Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const time = index / sampleRate;
    const phase = time % 1.6;
    const speaking = phase < 0.92 || (phase >= 1.1 && phase < 1.48);
    const segmentStart = phase < 0.92 ? 0 : 1.1;
    const segmentEnd = phase < 0.92 ? 0.92 : 1.48;
    const segmentPosition = phase - segmentStart;
    const edge = speaking ? Math.min(1, segmentPosition / 0.12, (segmentEnd - phase) / 0.12) : 0;
    const envelope = speaking ? 0.035 + 0.045 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 2.2 * time)) : 0;
    const fundamental = 170 + 24 * Math.sin(2 * Math.PI * 0.7 * time);
    const voiced =
      Math.sin(2 * Math.PI * fundamental * time) +
      0.45 * Math.sin(2 * Math.PI * fundamental * 2 * time + 0.2) +
      0.22 * Math.sin(2 * Math.PI * fundamental * 3 * time + 0.8);
    samples[index] = voiced * envelope * clamp(edge, 0, 1) + (random() - 0.5) * envelope * 0.035;
    mask[index] = speaking ? 1 : 0;
  }
  return { samples, mask };
}

function makeNoise(kind, sampleRate, length, random) {
  const samples = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const time = index / sampleRate;
    if (kind === "fan") samples[index] = 0.009 * Math.sin(2 * Math.PI * 118 * time) + (random() - 0.5) * 0.003;
    else if (kind === "keyboard") {
      const period = Math.round(sampleRate * 0.42);
      const age = index % period;
      samples[index] =
        age < sampleRate * 0.012
          ? (random() - 0.5) * 0.12 * Math.exp(-age / (sampleRate * 0.002))
          : (random() - 0.5) * 0.0007;
    } else if (kind === "competing-voice") {
      const envelope = 0.018 + 0.012 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 1.3 * time));
      samples[index] = envelope * (Math.sin(2 * Math.PI * 285 * time) + 0.35 * Math.sin(2 * Math.PI * 570 * time));
    } else samples[index] = (random() - 0.5) * 0.016;
  }
  return samples;
}

function repeatOrResample(samples, length) {
  const output = new Float32Array(length);
  if (samples.length === 0) return output;
  for (let index = 0; index < length; index += 1) output[index] = samples[index % samples.length];
  return output;
}

function mix(speech, noise) {
  const samples = new Float32Array(speech.samples.length);
  for (let index = 0; index < samples.length; index += 1) samples[index] = speech.samples[index] + noise[index];
  return { samples, mask: speech.mask };
}

function runPath(fixture, sampleRate, mode) {
  const pipeline = mode ? new ClearVoicePipeline(sampleRate, mode) : null;
  const gate = mode ? new VoiceActivationGate(sampleRate, { enabled: true, automatic: true, thresholdDb: -45 }) : null;
  const output = new Float32Array(fixture.samples.length);
  const blockResults = [];
  const inputBlock = new Float32Array(QUANTUM);
  const processedBlock = new Float32Array(QUANTUM);
  const outputBlock = new Float32Array(QUANTUM);
  const timings = [];
  for (let offset = 0; offset < fixture.samples.length; offset += QUANTUM) {
    const length = Math.min(QUANTUM, fixture.samples.length - offset);
    inputBlock.fill(0);
    inputBlock.set(fixture.samples.subarray(offset, offset + length));
    const started = performance.now();
    if (pipeline) {
      pipeline.process(inputBlock, processedBlock);
      gate.process(processedBlock, outputBlock, inputBlock);
    } else {
      outputBlock.set(inputBlock);
    }
    timings.push(performance.now() - started);
    output.set(outputBlock.subarray(0, length), offset);
    let speechSamples = 0;
    for (let index = 0; index < length; index += 1) speechSamples += fixture.mask[offset + index] ?? 0;
    const outputRms = rms(outputBlock.subarray(0, length));
    blockResults.push({
      speech: speechSamples >= length * 0.5,
      outputRms,
      audible: mode ? gate.getMetrics().audible : outputRms >= VAD_THRESHOLD,
    });
  }

  const alignmentLag = mode ? Math.round(sampleRate * 0.048) : 0;
  const start = Math.min(alignmentLag + Math.floor(sampleRate * 0.2), Math.floor(output.length / 4));
  const end = Math.max(start + 1, output.length - start);
  let targetEnergy = 0;
  let outputEnergy = 0;
  let targetOutputCross = 0;
  let inputNoiseEnergy = 0;
  let outputNoiseEnergy = 0;
  let clipCount = 0;
  let jumpCount = 0;
  let previous = 0;
  let speechBlocks = 0;
  let speechTruePositives = 0;
  let noiseTruePositives = 0;
  let noiseFalsePositives = 0;
  for (let index = start; index < end; index += 1) {
    const sourceIndex = Math.max(0, index - alignmentLag);
    const target = fixture.targetSpeech[sourceIndex] ?? 0;
    const input = fixture.samples[sourceIndex];
    const value = output[index];
    const speech = (fixture.mask[sourceIndex] ?? 0) > 0;
    if (speech) {
      targetEnergy += target * target;
      outputEnergy += value * value;
      targetOutputCross += target * value;
    } else {
      inputNoiseEnergy += input * input;
      outputNoiseEnergy += value * value;
    }
    if (Math.abs(value) >= 0.98) clipCount += 1;
    if (index > start && Math.abs(value - previous) > 0.25) jumpCount += 1;
    previous = value;
  }
  for (const result of blockResults.slice(Math.floor(start / QUANTUM), Math.ceil(end / QUANTUM))) {
    if (result.speech) {
      speechBlocks += 1;
      if (result.audible) speechTruePositives += 1;
    } else if (result.audible) noiseFalsePositives += 1;
    else noiseTruePositives += 1;
  }
  const correlation = targetOutputCross / Math.max(1.0e-8, Math.sqrt(targetEnergy * outputEnergy));
  const sortedTimings = [...timings].sort((left, right) => left - right);
  const percentile = (fraction) =>
    sortedTimings[Math.min(sortedTimings.length - 1, Math.floor(sortedTimings.length * fraction))] ?? 0;
  const noiseInputRms = Math.sqrt(inputNoiseEnergy / Math.max(1, end - start));
  const noiseOutputRms = Math.sqrt(outputNoiseEnergy / Math.max(1, end - start));
  return {
    mode: mode ?? "raw",
    alignmentLagSamples: alignmentLag,
    speechRetentionRatio: Math.sqrt(outputEnergy / Math.max(1.0e-8, targetEnergy)),
    speechCorrelation: clamp(correlation, -1, 1),
    noiseAttenuationDb: db(noiseOutputRms / Math.max(noiseInputRms, 1.0e-8)),
    vad: {
      precision:
        speechTruePositives + noiseFalsePositives > 0
          ? speechTruePositives / (speechTruePositives + noiseFalsePositives)
          : 1,
      recall: speechBlocks > 0 ? speechTruePositives / speechBlocks : 1,
      falseOpenRate:
        noiseFalsePositives + noiseTruePositives > 0
          ? noiseFalsePositives / (noiseFalsePositives + noiseTruePositives)
          : 0,
    },
    artifactRate: (clipCount + jumpCount) / Math.max(1, end - start),
    artifactCounts: { clippedSamples: clipCount, largeJumps: jumpCount },
    processingLatencyMs: {
      p50: percentile(0.5),
      p95: percentile(0.95),
      scope: "local process call per 128-sample quantum; excludes capture, worker scheduling and network",
    },
  };
}

function buildFixtures(args) {
  const random = seededRandom(args.seed);
  const length = Math.ceil(args.sampleRate * args.duration);
  if (args.speech || args.noise) {
    const speechInput = args.speech
      ? parsePcm16Wav(args.speech)
      : { sampleRate: args.sampleRate, samples: new Float32Array(length) };
    const noiseInput = args.noise
      ? parsePcm16Wav(args.noise)
      : { sampleRate: args.sampleRate, samples: makeNoise("white", args.sampleRate, length, random) };
    const speechSamples = repeatOrResample(
      resample(speechInput.samples, speechInput.sampleRate, args.sampleRate),
      length,
    );
    const noiseSamples = repeatOrResample(resample(noiseInput.samples, noiseInput.sampleRate, args.sampleRate), length);
    const mask = new Uint8Array(length).fill(args.speech ? 1 : 0);
    const targetSpeech = args.speech ? speechSamples : new Float32Array(length);
    return [
      {
        name: "real-consented-input",
        sourceKind: "real-consented",
        sourceFiles: [args.speech, args.noise].filter(Boolean),
        ...mix({ samples: speechSamples, mask }, noiseSamples),
        targetSpeech,
      },
    ];
  }
  const speech = makeSpeech(args.sampleRate, args.duration, random);
  const fixtures = [];
  for (const kind of ["silence", "white", "fan", "keyboard", "competing-voice"]) {
    const noise = kind === "silence" ? new Float32Array(length) : makeNoise(kind, args.sampleRate, length, random);
    const mixed = mix(speech, noise);
    fixtures.push({
      name: `synthetic-${kind}`,
      sourceKind: "synthetic-generated",
      samples: mixed.samples,
      mask: mixed.mask,
      targetSpeech: speech.samples,
    });
  }
  fixtures.push({
    name: "synthetic-noise-only",
    sourceKind: "synthetic-generated",
    samples: makeNoise("white", args.sampleRate, length, random),
    mask: new Uint8Array(length),
    targetSpeech: new Float32Array(length),
  });
  return fixtures;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const modes = args.mode === "both" ? ["standard", "strong"] : [args.mode];
  const fixtures = buildFixtures(args);
  const results = [];
  for (const fixture of fixtures) {
    const paths = [
      runPath(fixture, args.sampleRate, null),
      ...modes.map((mode) => runPath(fixture, args.sampleRate, mode)),
    ];
    results.push({
      name: fixture.name,
      sourceKind: fixture.sourceKind,
      sourceFiles: fixture.sourceFiles ?? [],
      durationSeconds: args.duration,
      sampleRate: args.sampleRate,
      paths,
    });
  }
  const report = {
    schemaVersion: 1,
    seed: args.seed,
    fixturePolicy:
      "Synthetic fixtures are deterministic; real inputs require explicit --consented and are not written or uploaded.",
    metricsPolicy:
      "Speech retention/correlation and time-domain VAD are local proxies. Artifact counts use clipping and >0.25 sample jumps. Processing latency excludes capture, worker scheduling and network.",
    results,
  };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (args.output) {
    fs.mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
    fs.writeFileSync(args.output, json, "utf8");
  }
  process.stdout.write(json);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
