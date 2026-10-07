export type VoiceActivationGateConfig = {
  enabled: boolean;
  thresholdDb: number;
  automatic?: boolean;
  /** Optional model VAD for the post suppression stream. */
  postVadProbability?: number | null;
};

export type VoiceActivationGateMetrics = {
  /** The level used by the gate decision (post suppression in automatic mode). */
  inputDb: number;
  /** Raw sidechain level, retained for fixed sensitivity diagnostics. */
  rawDb: number;
  /** Level entering the final gate, after any noise suppression. */
  postDb: number;
  /** Measured level leaving the final gate. */
  outputDb: number;
  outputRms: number;
  /** Derived or supplied post suppression VAD confidence. */
  vadProbability: number;
  /** Current adaptive noise floor estimate for the post suppression stream. */
  noiseFloorDb: number;
  /** A normalized activity meter derived from the transmitted output. */
  activity: number;
  gain: number;
  open: boolean;
  /** True only when the measured post gate output has activity. */
  audible: boolean;
  thresholdDb: number;
};

// Keep enough delayed audio to cover onset confirmation, then use a longer
// hold/release so quiet consonants and word endings are not chopped between
// syllables. This is deliberately an envelope change rather than a lower
// threshold: room noise still has to cross the configured threshold to open.
const LOOKAHEAD_SECONDS = 0.048;
const ATTACK_SECONDS = 0.003;
const HOLD_SECONDS = 0.18;
const RELEASE_SECONDS = 0.22;
const DETECTION_WINDOW_SECONDS = 0.02;
const ONSET_CONFIRM_SECONDS = 0.024;
const SILENCE_FLOOR = 0.0001;
const OUTPUT_ACTIVITY_FLOOR = 0.000316227766; // -70 dBFS
const ADAPTATION_RISE_DB_PER_SECOND = 8;
const ADAPTATION_FALL_DB_PER_SECOND = 3;
// Speech confidence at which automatic sensitivity opens without a level match.
const VAD_OPEN_PROBABILITY = 0.46;
// The ClearVoice model's speech score is more permissive than the gate's own
// estimate. Opening at 0.46 let steady heavy noise open the gate twice as often
// in recorded tests; opening at 0.70 kept noise behavior unchanged while still
// holding the gate open through quiet syllables.
const MODEL_SPEECH_OPEN_PROBABILITY = 0.7;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Map a ClearVoice model speech score onto this gate's speech-confidence scale. */
export function calibrateModelSpeechProbability(probability: number): number {
  if (!Number.isFinite(probability)) return 0;
  const slope = (1 - VAD_OPEN_PROBABILITY) / (1 - MODEL_SPEECH_OPEN_PROBABILITY);
  return clamp(VAD_OPEN_PROBABILITY + (probability - MODEL_SPEECH_OPEN_PROBABILITY) * slope, 0, 1);
}

function smoothingCoefficient(seconds: number, sampleRate: number): number {
  // Reach 99% of the target over the requested attack/release duration.
  return Math.exp(Math.log(0.01) / Math.max(1, seconds * sampleRate));
}

/**
 * A local, audio-thread voice activation envelope. The short look-ahead keeps
 * initial consonants in the delayed signal while the gate attacks, and the
 * hold/release envelope prevents choppy word endings.
 */
export class VoiceActivationGate {
  private readonly delay: Float32Array;
  private readonly attackCoefficient: number;
  private readonly releaseCoefficient: number;
  private readonly holdSamples: number;
  private readonly onsetConfirmSamples: number;
  private readonly detectionWindow: Float32Array;
  private readonly postDetectionWindow: Float32Array;
  private delayIndex = 0;
  private gain = 0;
  private holdRemaining = 0;
  private onsetSamples = 0;
  private detectionIndex = 0;
  private detectionCount = 0;
  private detectionEnergy = 0;
  private postDetectionIndex = 0;
  private postDetectionCount = 0;
  private postDetectionEnergy = 0;
  private postPreviousSample = 0;
  private postDifferenceEnergy = 0;
  private postZeroCrossings = 0;
  private postStationarySeconds = 0;
  private previousPostDb = -80;
  private enabled = true;
  private thresholdDb = -42;
  private automatic = false;
  private noiseDb = -62;
  private postVadProbability: number | null = null;
  private readonly sampleRate: number;
  private metrics: VoiceActivationGateMetrics = {
    inputDb: -80,
    rawDb: -80,
    postDb: -80,
    outputDb: -80,
    outputRms: 0,
    vadProbability: 0,
    noiseFloorDb: -62,
    activity: 0,
    gain: 0,
    open: false,
    audible: false,
    thresholdDb: -42,
  };

  constructor(sampleRate: number, config?: Partial<VoiceActivationGateConfig>) {
    const safeSampleRate = Math.max(8_000, Number.isFinite(sampleRate) ? sampleRate : 48_000);
    this.sampleRate = safeSampleRate;
    this.delay = new Float32Array(Math.max(1, Math.round(safeSampleRate * LOOKAHEAD_SECONDS)));
    this.attackCoefficient = smoothingCoefficient(ATTACK_SECONDS, safeSampleRate);
    this.releaseCoefficient = smoothingCoefficient(RELEASE_SECONDS, safeSampleRate);
    this.holdSamples = Math.max(1, Math.round(safeSampleRate * HOLD_SECONDS));
    this.onsetConfirmSamples = Math.max(1, Math.round(safeSampleRate * ONSET_CONFIRM_SECONDS));
    this.detectionWindow = new Float32Array(Math.max(1, Math.round(safeSampleRate * DETECTION_WINDOW_SECONDS)));
    this.postDetectionWindow = new Float32Array(this.detectionWindow.length);
    this.configure(config);
  }

  configure(config?: Partial<VoiceActivationGateConfig>): void {
    if (!config) return;
    if (typeof config.enabled === "boolean") this.enabled = config.enabled;
    if (typeof config.automatic === "boolean") this.automatic = config.automatic;
    if (config.postVadProbability === null) this.postVadProbability = null;
    if (typeof config.postVadProbability === "number" && Number.isFinite(config.postVadProbability)) {
      this.postVadProbability = clamp(config.postVadProbability, 0, 1);
    }
    if (typeof config.thresholdDb === "number" && Number.isFinite(config.thresholdDb)) {
      this.thresholdDb = clamp(config.thresholdDb, -80, -10);
    }
    if (!this.enabled) this.holdRemaining = this.holdSamples;
  }

  /** Clear delayed audio and adaptive history after a device/session change. */
  reset(): void {
    this.delay.fill(0);
    this.detectionWindow.fill(0);
    this.postDetectionWindow.fill(0);
    this.delayIndex = 0;
    this.gain = 0;
    this.holdRemaining = this.enabled ? 0 : this.holdSamples;
    this.onsetSamples = 0;
    this.detectionIndex = 0;
    this.detectionCount = 0;
    this.detectionEnergy = 0;
    this.postDetectionIndex = 0;
    this.postDetectionCount = 0;
    this.postDetectionEnergy = 0;
    this.postPreviousSample = 0;
    this.postDifferenceEnergy = 0;
    this.postZeroCrossings = 0;
    this.postStationarySeconds = 0;
    this.previousPostDb = -80;
    this.noiseDb = clamp(this.thresholdDb - 10, -80, -30);
    this.metrics = {
      inputDb: -80,
      rawDb: -80,
      postDb: -80,
      outputDb: -80,
      outputRms: 0,
      vadProbability: 0,
      noiseFloorDb: this.noiseDb,
      activity: 0,
      gain: 0,
      open: !this.enabled,
      audible: false,
      thresholdDb: this.thresholdDb,
    };
  }

  process(input: Float32Array, output: Float32Array, detectionInput: Float32Array = input): VoiceActivationGateMetrics {
    let energy = 0;
    let blockEnergy = 0;
    let postBlockEnergy = 0;
    const measurement = detectionInput.length > 0 ? detectionInput : input;
    for (let index = 0; index < measurement.length; index += 1) {
      const sample = Number.isFinite(measurement[index]) ? measurement[index] : 0;
      const sampleEnergy = sample * sample;
      blockEnergy += sampleEnergy;
      if (this.detectionCount < this.detectionWindow.length) {
        this.detectionCount += 1;
      } else {
        this.detectionEnergy -= this.detectionWindow[this.detectionIndex];
      }
      this.detectionWindow[this.detectionIndex] = sampleEnergy;
      this.detectionEnergy += sampleEnergy;
      this.detectionIndex = (this.detectionIndex + 1) % this.detectionWindow.length;
    }
    for (let index = 0; index < input.length; index += 1) {
      const sample = Number.isFinite(input[index]) ? input[index] : 0;
      const sampleEnergy = sample * sample;
      postBlockEnergy += sampleEnergy;
      if (this.postDetectionCount < this.postDetectionWindow.length) {
        this.postDetectionCount += 1;
      } else {
        this.postDetectionEnergy -= this.postDetectionWindow[this.postDetectionIndex];
      }
      this.postDetectionWindow[this.postDetectionIndex] = sampleEnergy;
      this.postDetectionEnergy += sampleEnergy;
      const difference = sample - this.postPreviousSample;
      this.postDifferenceEnergy += difference * difference;
      if (sample >= 0 !== this.postPreviousSample >= 0) this.postZeroCrossings += 1;
      this.postPreviousSample = sample;
    }
    // Use the same approximate time scale as the visible input meter. A
    // per-quantum RMS lets a 2.7 ms transient open the gate even when its
    // 20 ms average is below the user's threshold.
    energy = Math.max(0, this.detectionEnergy);
    const rms = Math.sqrt(energy / Math.max(1, this.detectionCount));
    const inputDb = clamp(20 * Math.log10(Math.max(rms, 0.0001)), -80, 0);
    const blockRms = Math.sqrt(blockEnergy / Math.max(1, measurement.length));
    const blockDb = clamp(20 * Math.log10(Math.max(blockRms, 0.0001)), -80, 0);
    const postRms = Math.sqrt(Math.max(0, this.postDetectionEnergy) / Math.max(1, this.postDetectionCount));
    const postDb = clamp(20 * Math.log10(Math.max(postRms, 0.0001)), -80, 0);
    const postBlockRms = Math.sqrt(postBlockEnergy / Math.max(1, input.length));
    const postBlockDb = clamp(20 * Math.log10(Math.max(postBlockRms, 0.0001)), -80, 0);
    const postDifferenceRms = Math.sqrt(this.postDifferenceEnergy / Math.max(1, input.length));
    const postZeroCrossingRate = this.postZeroCrossings / Math.max(1, input.length);
    const postDifferenceRatio = postDifferenceRms / Math.max(postBlockRms, 0.0001);
    // These are block-local shape features. Keep the last sample for the
    // boundary crossing, but do not let a long call make the ratio grow.
    this.postDifferenceEnergy = 0;
    this.postZeroCrossings = 0;
    const levelDelta = Math.abs(postDb - this.previousPostDb);
    const blockSeconds = input.length / this.sampleRate;
    if (levelDelta <= 1.2) {
      this.postStationarySeconds = Math.min(4, this.postStationarySeconds + blockSeconds);
    } else {
      this.postStationarySeconds = Math.max(0, this.postStationarySeconds - blockSeconds * 2);
    }
    this.previousPostDb = postDb;

    // This is intentionally a conservative time-domain VAD. It is only used
    // to protect adaptive floor learning; a model supplied by the caller can
    // replace it. Periodicity protects quiet voiced speech, while the change
    // ratio rejects steady broadband residuals that otherwise hold the gate
    // open. It is not presented as a speech recognizer.
    const voicedZeroCrossings = postZeroCrossingRate >= 0.006 && postZeroCrossingRate <= 0.28;
    const periodicity = clamp((0.72 - postDifferenceRatio) / 0.52, 0, 1);
    const postEnergyConfidence = clamp((postDb - this.noiseDb - 3) / 12, 0, 1);
    const derivedVadProbability = clamp(
      postEnergyConfidence * (0.68 * periodicity + (voicedZeroCrossings ? 0.32 : 0)),
      0,
      1,
    );
    const vadProbability = this.postVadProbability ?? derivedVadProbability;

    if (this.automatic) {
      // Learn from the post suppression stream even while the gate is open.
      // A stale raw sidechain must not freeze the estimator. Speech-like
      // periodic frames are protected, and the per-block rate limit bounds
      // threshold movement on an abrupt device or room change.
      const wasOpen = this.metrics.open || this.holdRemaining > 0 || this.gain >= 0.2;
      const stationaryNoise = this.postStationarySeconds >= 0.36 && vadProbability < 0.38;
      const belowThreshold = postDb < this.thresholdDb + 4;
      if (vadProbability < 0.34 && (belowThreshold || stationaryNoise)) {
        const seconds = postDb > this.noiseDb ? 1.4 : 3;
        const alpha = 1 - Math.exp(-blockSeconds / seconds);
        const targetNoise = clamp(postDb, -80, -30);
        const proposed = this.noiseDb + (targetNoise - this.noiseDb) * alpha;
        const maximumStep =
          (targetNoise >= this.noiseDb ? ADAPTATION_RISE_DB_PER_SECOND : ADAPTATION_FALL_DB_PER_SECOND) * blockSeconds;
        this.noiseDb += clamp(proposed - this.noiseDb, -maximumStep, maximumStep);
      } else if (!wasOpen && postDb < this.noiseDb - 3) {
        // A genuinely quieter room should be allowed to lower the floor while
        // closed, but only at the slower bounded rate.
        const maximumStep = ADAPTATION_FALL_DB_PER_SECOND * blockSeconds;
        this.noiseDb += clamp(postDb - this.noiseDb, -maximumStep, maximumStep);
      }
      this.thresholdDb = clamp(this.noiseDb + 10, -55, -30);
    }

    const detectionDb = this.automatic ? postDb : inputDb;
    const detectionBlockDb = this.automatic ? postBlockDb : blockDb;

    let detected = false;
    if (!this.enabled) {
      this.onsetSamples = this.onsetConfirmSamples;
      detected = true;
    } else if (this.holdRemaining > 0 || this.metrics.open) {
      // Once speech has been confirmed, the rolling meter and hold/release
      // protect natural word endings without repeatedly delaying each syllable.
      detected = detectionDb >= this.thresholdDb || (this.automatic && vadProbability >= VAD_OPEN_PROBABILITY);
      if (!detected) this.onsetSamples = 0;
    } else {
      // A click or small desk hit can exceed the threshold for one render
      // quantum. Require a short sustained onset before opening, while the
      // look-ahead buffer retains the beginning of real speech.
      if (detectionBlockDb >= this.thresholdDb || (this.automatic && vadProbability >= VAD_OPEN_PROBABILITY)) {
        this.onsetSamples = Math.min(this.onsetConfirmSamples, this.onsetSamples + measurement.length);
      } else {
        this.onsetSamples = 0;
      }
      detected =
        this.onsetSamples >= this.onsetConfirmSamples &&
        (detectionDb >= this.thresholdDb || (this.automatic && vadProbability >= VAD_OPEN_PROBABILITY));
    }
    if (detected) this.holdRemaining = this.holdSamples;
    else this.holdRemaining = Math.max(0, this.holdRemaining - input.length);
    const open = detected || this.holdRemaining > 0;
    const targetGain = open ? 1 : 0;
    const coefficient = open ? this.attackCoefficient : this.releaseCoefficient;

    let outputEnergy = 0;
    for (let index = 0; index < output.length; index += 1) {
      const delayed = this.delay[this.delayIndex];
      this.delay[this.delayIndex] = Number.isFinite(input[index]) ? input[index] : 0;
      this.delayIndex = (this.delayIndex + 1) % this.delay.length;
      this.gain = targetGain + (this.gain - targetGain) * coefficient;
      if (!open && this.gain < SILENCE_FLOOR) this.gain = 0;
      output[index] = delayed * this.gain;
      outputEnergy += output[index] * output[index];
    }

    const outputRms = Math.sqrt(outputEnergy / Math.max(1, output.length));
    const outputDb = clamp(20 * Math.log10(Math.max(outputRms, 0.0001)), -80, 0);

    this.metrics = {
      inputDb: detectionDb,
      rawDb: inputDb,
      postDb,
      outputDb,
      outputRms,
      vadProbability,
      noiseFloorDb: this.noiseDb,
      activity: clamp(outputRms / 0.1, 0, 1),
      gain: this.gain,
      open,
      audible: outputRms >= OUTPUT_ACTIVITY_FLOOR,
      thresholdDb: this.thresholdDb,
    };
    return this.metrics;
  }

  getMetrics(): VoiceActivationGateMetrics {
    return { ...this.metrics };
  }
}
