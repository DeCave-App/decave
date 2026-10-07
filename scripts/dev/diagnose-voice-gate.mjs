// Deterministic audit probe, not a passing test that blesses current gate behavior.
// Run: node scripts/dev/diagnose-voice-gate.mjs
import { VoiceActivationGate } from "../../src/audio/clearvoice/VoiceActivationGate.ts";
import { ClearVoicePipeline } from "../../src/audio/clearvoice/ClearVoicePipeline.ts";

for (const mode of ["off", "strong"]) {
  const gate = new VoiceActivationGate(48000, { enabled: true, automatic: true, thresholdDb: -45 });
  const processor = new ClearVoicePipeline(48000, "strong");
  const input = new Float32Array(128);
  const processed = new Float32Array(128);
  const output = new Float32Array(128);
  let seed = 12345;
  let inputEnergy = 0;
  let outputEnergy = 0;
  let openBlocks = 0;
  let measuredSamples = 0;
  for (let block = 0; block < 11250; block++) {
    for (let i = 0; i < input.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      input[i] = ((seed / 4294967296) * 2 - 1) * 0.02;
    }
    if (mode === "strong") processor.process(input, processed);
    const metrics = gate.process(mode === "strong" ? processed : input, output, input);
    if (block < 7500) continue; // Measure the final ten seconds, after warmup.
    if (metrics.open) openBlocks++;
    for (let i = 0; i < input.length; i++) {
      inputEnergy += input[i] ** 2;
      outputEnergy += output[i] ** 2;
      measuredSamples++;
    }
  }
  console.log(
    JSON.stringify({
      mode,
      seconds: 30,
      inputDb: 10 * Math.log10(inputEnergy / measuredSamples),
      outputDb: 10 * Math.log10(outputEnergy / measuredSamples),
      openPercent: (100 * openBlocks) / 3750,
      finalMetrics: gate.getMetrics(),
    }),
  );
}
