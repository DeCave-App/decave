export type ClearVoiceTransientMetrics = {
  clickScore: number;
  impactScore: number;
  clickState: number;
  impactState: number;
  transientState: number;
  lowRatio: number;
  highRatio: number;
  speechGuard: number;
  gains: Float32Array;
};

const DEFAULT_SAMPLE_RATE = 16_000;
const DEFAULT_FFT_SIZE = 512;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function smoothStep(value: number): number {
  const clamped = clamp(value, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Streaming detector for short mechanical and impact transients.
 *
 * The neural mask handles the general speech/noise separation. This detector
 * adds the missing real-time signal: a desk impact can be mostly low/mid
 * frequency and therefore should not depend on a high-frequency click score.
 * It returns smooth per-bin gains, never a binary gate.
 */
export class ClearVoiceTransientDetector {
  private readonly sampleRate: number;
  private readonly fftSize: number;
  private readonly frequencyBins: number;
  private previousLogMagnitude: Float32Array | null = null;
  private recentFrameEnergy: number[] = [];
  private fluxBaseline = 0;
  private fluxSpread = 0.015;
  private clickState = 0;
  private impactState = 0;
  private processedFrameCount = 0;

  constructor(sampleRate = DEFAULT_SAMPLE_RATE, fftSize = DEFAULT_FFT_SIZE) {
    this.sampleRate = sampleRate;
    this.fftSize = fftSize;
    this.frequencyBins = fftSize / 2 + 1;
  }

  reset(): void {
    this.previousLogMagnitude = null;
    this.recentFrameEnergy = [];
    this.fluxBaseline = 0;
    this.fluxSpread = 0.015;
    this.clickState = 0;
    this.impactState = 0;
    this.processedFrameCount = 0;
  }

  process(inputSpectrum: Float32Array, speechProbability: number): ClearVoiceTransientMetrics {
    if (inputSpectrum.length !== this.frequencyBins * 2) {
      throw new Error("ClearVoice transient detector received an invalid spectrum frame.");
    }

    const logMagnitude = new Float32Array(this.frequencyBins);
    let energySum = 0;
    let arithmeticSum = 0;
    let logSum = 0;
    let lowEnergy = 0;
    let highEnergy = 0;
    for (let bin = 0; bin < this.frequencyBins; bin += 1) {
      const offset = bin * 2;
      const magnitude = Math.hypot(inputSpectrum[offset], inputSpectrum[offset + 1]);
      const safeMagnitude = Math.max(magnitude, 1.0e-8);
      const frequency = (bin * this.sampleRate) / this.fftSize;
      logMagnitude[bin] = Math.log1p(safeMagnitude * 32);
      energySum += safeMagnitude * safeMagnitude;
      arithmeticSum += safeMagnitude;
      logSum += Math.log(safeMagnitude);
      if (frequency < 900) lowEnergy += safeMagnitude * safeMagnitude;
      if (frequency >= 2_500) highEnergy += safeMagnitude * safeMagnitude;
    }

    const frameEnergy = Math.sqrt(energySum / this.frequencyBins + 1.0e-8);
    // Use only earlier frames for the local reference. Including the current
    // frame makes a short impact look less isolated after AGC or saturation.
    const localEnergy = median(this.recentFrameEnergy);
    const onsetScore =
      this.recentFrameEnergy.length >= 3 ? clamp((frameEnergy / (localEnergy + 1.0e-6) - 1) / 1.15, 0, 1) : 0;
    this.recentFrameEnergy.push(frameEnergy);
    if (this.recentFrameEnergy.length > 15) this.recentFrameEnergy.shift();

    let flux = 0;
    if (this.previousLogMagnitude) {
      for (let bin = 0; bin < this.frequencyBins; bin += 1) {
        flux += Math.max(logMagnitude[bin] - this.previousLogMagnitude[bin], 0);
      }
      flux /= this.frequencyBins;
    }
    this.previousLogMagnitude = logMagnitude;
    const fluxDelta = flux - this.fluxBaseline;
    this.fluxBaseline += fluxDelta * (flux > this.fluxBaseline ? 0.03 : 0.01);
    this.fluxSpread += (Math.abs(fluxDelta) - this.fluxSpread) * 0.03;
    const fluxScore = clamp((flux - this.fluxBaseline - 0.015) / (Math.max(this.fluxSpread, 0.015) + 0.025), 0, 1);

    const lowRatio = clamp(lowEnergy / Math.max(energySum, 1.0e-8), 0, 1);
    const highRatio = clamp(highEnergy / Math.max(energySum, 1.0e-8), 0, 1);
    const highScore = clamp((highRatio - 0.1) / 0.42, 0, 1);
    const flatness = clamp(
      Math.exp(logSum / this.frequencyBins) / Math.max(arithmeticSum / this.frequencyBins, 1.0e-8),
      0,
      1,
    );
    const flatScore = clamp((flatness - 0.025) / 0.3, 0, 1);
    const lowBodyScore = clamp((lowRatio - 0.16) / 0.54, 0, 1);
    const nonLowBandScore = clamp((1 - lowRatio - 0.18) / 0.58, 0, 1);

    // Breath and mic airflow are also broadband, but unlike a click they are
    // mostly high-band energy with little low-frequency body. When that sound
    // overlaps a voiced frame, treating it as a mechanical transient makes
    // consonants and breathy vowels pump. Keep the protection conditional on
    // speech confidence so standalone air noise is still suppressible.
    const airflowScore =
      clamp(0.58 * ((highRatio - 0.28) / 0.42) + 0.42 * ((flatness - 0.08) / 0.34), 0, 1) * (1 - 0.7 * lowBodyScore);

    const safeSpeechProbability = clamp(Number.isFinite(speechProbability) ? speechProbability : 0, 0, 1);
    // Speech is a guard, not an on/off switch. A hard impact overlapping a
    // word can still be reduced, but a confidently voiced frame is protected.
    const speechGuard = 1 - 0.76 * clamp((safeSpeechProbability - 0.25) / 0.65, 0, 1);

    const voicedAirProtection = airflowScore * smoothStep((safeSpeechProbability - 0.34) / 0.34) * 0.52;

    let clickScore =
      (0.56 * fluxScore + 0.27 * onsetScore + 0.17 * flatScore) * (0.35 + 0.65 * highScore) * speechGuard;
    // An impact has a different shape: a fast onset plus energy in the low or
    // full band. This catches thumps that contain little upper-band energy.
    const impactShape = clamp(0.52 * lowBodyScore + 0.24 * nonLowBandScore + 0.24 * flatScore, 0, 1);
    let impactScore = (0.5 * onsetScore + 0.28 * fluxScore + 0.22 * impactShape) * speechGuard;
    clickScore *= 1 - voicedAirProtection;
    impactScore *= 1 - voicedAirProtection * 0.45;
    if (this.processedFrameCount < 4) {
      clickScore = 0;
      impactScore = 0;
    }
    clickScore = clamp(clickScore, 0, 1);
    impactScore = clamp(impactScore, 0, 1);

    this.clickState += (clickScore - this.clickState) * (clickScore > this.clickState ? 0.82 : 0.14);
    // Hold the body of a desk impact for longer than its initial click. The
    // slower release is still continuous and avoids a hard mute.
    this.impactState += (impactScore - this.impactState) * (impactScore > this.impactState ? 0.72 : 0.1);
    this.processedFrameCount += 1;

    const gains = new Float32Array(this.frequencyBins);
    for (let bin = 0; bin < this.frequencyBins; bin += 1) {
      const frequency = (bin * this.sampleRate) / this.fftSize;
      const highRamp = smoothStep((frequency - 1_800) / 2_200);
      const clickAttenuation = 0.62 + 0.38 * highRamp;
      // Unlike the old V6 full-band stage, the impact path reaches the low
      // frequencies where a heavy object hitting a desk has most of its body.
      const impactAttenuation = 0.88 + 0.12 * highRamp;
      const clickGain = 1 - this.clickState * clickAttenuation;
      const impactGain = 1 - this.impactState * impactAttenuation;
      gains[bin] = clamp(Math.min(clickGain, impactGain), 0.06, 1);
    }

    return {
      clickScore,
      impactScore,
      clickState: this.clickState,
      impactState: this.impactState,
      transientState: Math.max(this.clickState, this.impactState),
      lowRatio,
      highRatio,
      speechGuard,
      gains,
    };
  }
}
