export type ClearVoiceMode = "standard" | "strong";

export type ClearVoiceMetrics = {
  rms: number;
  noiseRms: number;
  snrDb: number;
  speechProbability: number;
  transientProbability: number;
  gain: number;
  attenuationDb: number;
};

const TWO_PI = Math.PI * 2;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function db(value: number): number {
  return 20 * Math.log10(Math.max(value, 0.000001));
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

/**
 * Deterministic local voice enhancement for AudioWorklet and native ports.
 *
 * This is intentionally conservative around speech: it uses a continuous
 * confidence gain, a short hold, and a slow release instead of a binary gate.
 * The same state machine can be ported to Android/iOS without a browser API.
 */
export class ClearVoicePipeline {
  readonly sampleRate: number;
  readonly mode: ClearVoiceMode;

  private readonly highPassAlpha: number;
  private readonly attackStep: number;
  private readonly releaseStep: number;
  private readonly holdSamples: number;
  private readonly minimumGain: number;
  private highPassPreviousInput = 0;
  private highPassPreviousOutput = 0;
  private previousSample = 0;
  private envelope = 0;
  private noiseRms = 0.008;
  private gain = 1;
  private holdRemaining = 0;
  private warmupSamples = 0;
  private lastMetrics: ClearVoiceMetrics = {
    rms: 0,
    noiseRms: 0.008,
    snrDb: 0,
    speechProbability: 0,
    transientProbability: 0,
    gain: 1,
    attenuationDb: 0,
  };

  constructor(sampleRate = 48000, mode: ClearVoiceMode = "standard") {
    this.sampleRate = sampleRate;
    this.mode = mode;
    this.highPassAlpha = Math.exp((-TWO_PI * 72) / Math.max(8000, sampleRate));
    this.attackStep = 1 - Math.exp(-1 / (Math.max(8000, sampleRate) * 0.004));
    this.releaseStep = 1 - Math.exp(-1 / (Math.max(8000, sampleRate) * 0.16));
    this.holdSamples = Math.round(Math.max(8000, sampleRate) * 0.1);
    this.minimumGain = mode === "strong" ? 0.018 : 0.08;
  }

  reset(): void {
    this.highPassPreviousInput = 0;
    this.highPassPreviousOutput = 0;
    this.previousSample = 0;
    this.envelope = 0;
    this.noiseRms = 0.008;
    this.gain = 1;
    this.holdRemaining = 0;
    this.warmupSamples = 0;
  }

  getMetrics(): ClearVoiceMetrics {
    return { ...this.lastMetrics };
  }

  process(input: Float32Array, output: Float32Array): ClearVoiceMetrics {
    if (output.length === 0) return this.getMetrics();

    let sum = 0;
    let peak = 0;
    let differenceSum = 0;
    let zeroCrossings = 0;
    let previous = this.previousSample;
    const filtered = new Float32Array(output.length);

    for (let index = 0; index < output.length; index += 1) {
      const sample = Number.isFinite(input[index]) ? input[index] : 0;
      const highPassed = this.highPassAlpha * (this.highPassPreviousOutput + sample - this.highPassPreviousInput);
      filtered[index] = highPassed;
      this.highPassPreviousInput = sample;
      this.highPassPreviousOutput = highPassed;
      const absolute = Math.abs(highPassed);
      sum += highPassed * highPassed;
      peak = Math.max(peak, absolute);
      const difference = highPassed - previous;
      differenceSum += difference * difference;
      if (highPassed >= 0 !== previous >= 0) zeroCrossings += 1;
      previous = highPassed;
    }
    this.previousSample = previous;

    const length = Math.max(1, output.length);
    const rms = Math.sqrt(sum / length);
    const differenceRms = Math.sqrt(differenceSum / length);
    const zeroCrossingRate = zeroCrossings / length;
    const crestFactor = peak / Math.max(rms, 0.0001);
    const noiseReference = Math.max(this.noiseRms, 0.0007);
    const snrDb = db(rms / noiseReference);
    const energyConfidence = sigmoid((snrDb - 7.5) / 3.0);
    // Broadband fan/room noise usually has a much higher crossing rate than
    // speech. Keep a small non-zero confidence outside the speech band so the
    // smoother never hard-gates an unusual voice or consonant.
    const voicedBandConfidence = zeroCrossingRate >= 0.008 && zeroCrossingRate <= 0.28 ? 0.72 : 0.04;
    let speechProbability = clamp(energyConfidence * 0.76 + voicedBandConfidence * 0.24, 0, 1);
    if (snrDb > 13) speechProbability = Math.max(speechProbability, 0.82);

    const transientProbability = clamp(
      ((crestFactor - 3.2) / 5.2) * 0.55 + ((differenceRms / Math.max(rms, 0.0001) - 0.7) / 2.2) * 0.45,
      0,
      1,
    );
    const likelyTransientNoise =
      transientProbability > (this.mode === "strong" ? 0.42 : 0.62) && speechProbability < 0.68;

    // Only learn the floor while speech is unlikely. The slow speech update
    // prevents the estimator from treating a held vowel as room noise.
    if (speechProbability < 0.34) {
      this.noiseRms += (clamp(rms, 0.0002, 0.2) - this.noiseRms) * (this.mode === "strong" ? 0.035 : 0.02);
    } else if (speechProbability < 0.52) {
      this.noiseRms += (clamp(rms, 0.0002, 0.2) - this.noiseRms) * 0.002;
    }

    if (speechProbability >= 0.52) this.holdRemaining = this.holdSamples;
    else this.holdRemaining = Math.max(0, this.holdRemaining - output.length);

    const holdConfidence = this.holdRemaining > 0 ? (this.mode === "strong" ? 0.42 : 0.62) : 0;
    let targetGain = this.minimumGain + Math.max(speechProbability, holdConfidence) * (1 - this.minimumGain);
    if (likelyTransientNoise) targetGain *= this.mode === "strong" ? 0.16 : 0.38;

    // The first few worklet quanta remain open while the estimator warms up;
    // this protects initial consonants and guarantees an audible fail-open path.
    this.warmupSamples += output.length;
    if (this.warmupSamples < this.sampleRate * 0.045) targetGain = Math.max(targetGain, 0.82);

    for (let index = 0; index < output.length; index += 1) {
      const highPassed = filtered[index];
      const step = targetGain > this.gain ? this.attackStep : this.releaseStep;
      this.gain += (targetGain - this.gain) * step;
      this.envelope += (Math.abs(highPassed) - this.envelope) * (Math.abs(highPassed) > this.envelope ? 0.08 : 0.012);
      // A soft limiter keeps loud speech intact without allowing a transient
      // click to clip the WebRTC encoder.
      const limited = Math.tanh(highPassed * 1.15) / 1.15;
      output[index] = limited * this.gain;
    }

    this.lastMetrics = {
      rms,
      noiseRms: this.noiseRms,
      snrDb,
      speechProbability,
      transientProbability,
      gain: this.gain,
      attenuationDb: db(Math.max(this.gain, 0.0001)),
    };
    return this.getMetrics();
  }
}
