import { createPeriodicHannWindow, transformInPlace } from "./ClearVoiceStreamingTransform";

declare const sampleRate: number;

const MODEL_INPUT_SAMPLE_RATE = 48_000;
const FFT_SIZE = 512;
const WINDOW_SIZE = 320;
const HOP_SIZE = 160;
const FREQUENCY_BINS = FFT_SIZE / 2 + 1;
const WINDOW_OFFSET = (FFT_SIZE - WINDOW_SIZE) / 2;
// The model runs at 16 kHz, one third of the 48 kHz bridge clock. One shared
// Kaiser low-pass prototype is used for both the 3:1 decimator and the 1:3
// interpolator: flat to about 7 kHz, at least 70 dB down from 9 kHz. Content
// between 8 and 9 kHz can only fold into the unused 7-8 kHz edge of the model
// band, so the speech band stays clean. Each stage adds about 1.2 ms of delay.
const RESAMPLE_FACTOR = 3;
const RESAMPLER_TAP_COUNT = 120;
const RESAMPLER_CUTOFF_HZ = 8_000;
const RESAMPLER_KAISER_BETA = 7.8;
const DEVICE_SAMPLE_RATE = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : MODEL_INPUT_SAMPLE_RATE;

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: AudioWorkletNodeOptions);
  process(inputs: Float32Array[][], outputs: Float32Array[][], _parameters: Record<string, Float32Array>): boolean;
}

declare function registerProcessor(name: string, processorCtor: typeof AudioWorkletProcessor): void;

type ModelPortMessage =
  | { type: "ready" }
  | { type: "error"; reason: string }
  | { type: "result"; sequence: number; spectrum: Float32Array; speechProbability: number };

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function besselI0(value: number): number {
  let sum = 1;
  let term = 1;
  for (let order = 1; order < 64; order += 1) {
    term *= (value / (2 * order)) ** 2;
    sum += term;
    if (term < sum * 1.0e-12) break;
  }
  return sum;
}

function createResamplerTaps(): Float32Array {
  // Linear-phase Kaiser-windowed sinc at the 48 kHz bridge clock, normalized
  // to unity DC gain. The previous 17-tap Blackman filter was already -3.5 dB
  // at 6 kHz yet only -16 dB at 10 kHz, so it dulled consonants while still
  // folding keyboard energy back into the speech band.
  const taps = new Float32Array(RESAMPLER_TAP_COUNT);
  const center = (RESAMPLER_TAP_COUNT - 1) / 2;
  const cutoff = RESAMPLER_CUTOFF_HZ / MODEL_INPUT_SAMPLE_RATE;
  const windowNormalization = besselI0(RESAMPLER_KAISER_BETA);
  let sum = 0;
  for (let index = 0; index < RESAMPLER_TAP_COUNT; index += 1) {
    const offset = index - center;
    const sinc = offset === 0 ? 1 : Math.sin(2 * Math.PI * cutoff * offset) / (2 * Math.PI * cutoff * offset);
    const position = offset / center;
    const window =
      besselI0(RESAMPLER_KAISER_BETA * Math.sqrt(Math.max(0, 1 - position * position))) / windowNormalization;
    taps[index] = 2 * cutoff * sinc * window;
    sum += taps[index];
  }
  for (let index = 0; index < taps.length; index += 1) taps[index] /= sum;
  return taps;
}

/** 3:1 FIR decimator that only evaluates the samples it keeps. */
class PolyphaseDecimator {
  private readonly history: Float32Array;
  private writeIndex = 0;
  private phase = 0;

  constructor(
    private readonly taps: Float32Array,
    private readonly emit: (sample: number) => void,
  ) {
    // Each sample is written twice so the newest taps.length samples are
    // always contiguous and the dot product needs no modulo.
    this.history = new Float32Array(taps.length * 2);
  }

  reset(): void {
    this.history.fill(0);
    this.writeIndex = 0;
    this.phase = 0;
  }

  push(sample: number): void {
    const length = this.taps.length;
    this.history[this.writeIndex] = sample;
    this.history[this.writeIndex + length] = sample;
    this.writeIndex = (this.writeIndex + 1) % length;
    this.phase += 1;
    if (this.phase < RESAMPLE_FACTOR) return;
    this.phase = 0;
    let value = 0;
    for (let index = 0; index < length; index += 1) {
      value += this.taps[index] * this.history[this.writeIndex + index];
    }
    this.emit(value);
  }
}

/** 1:3 polyphase FIR interpolator: three output samples per input sample. */
class PolyphaseInterpolator {
  private readonly phases: Float32Array[] = [];
  private readonly history: Float32Array;
  private readonly length: number;
  private writeIndex = 0;

  constructor(
    taps: Float32Array,
    private readonly emit: (sample: number) => void,
  ) {
    this.length = Math.ceil(taps.length / RESAMPLE_FACTOR);
    for (let phase = 0; phase < RESAMPLE_FACTOR; phase += 1) {
      const coefficients = new Float32Array(this.length);
      for (let index = 0; index < this.length; index += 1) {
        // Zero stuffing divides the signal level by the factor; restore it.
        coefficients[index] = (taps[phase + index * RESAMPLE_FACTOR] ?? 0) * RESAMPLE_FACTOR;
      }
      this.phases.push(coefficients);
    }
    this.history = new Float32Array(this.length * 2);
  }

  reset(): void {
    this.history.fill(0);
    this.writeIndex = 0;
  }

  push(sample: number): void {
    this.history[this.writeIndex] = sample;
    this.history[this.writeIndex + this.length] = sample;
    this.writeIndex = (this.writeIndex + 1) % this.length;
    const newest = this.writeIndex + this.length - 1;
    for (const coefficients of this.phases) {
      let value = 0;
      for (let index = 0; index < this.length; index += 1) {
        value += coefficients[index] * this.history[newest - index];
      }
      this.emit(value);
    }
  }
}

/**
 * Streaming linear resampling between the device rate and the model's 48 kHz
 * clock. The AudioWorklet may receive arbitrary device rates (44.1, 48, 96,
 * or 192 kHz), so rejecting a non-48 kHz context would unnecessarily disable
 * ClearVoice on otherwise capable devices.
 */
class StreamingLinearResampler {
  private readonly samples: number[] = [];
  private position = 0;

  constructor(
    private readonly sourceSamplesPerOutput: number,
    private readonly emit: (sample: number) => void,
  ) {}

  reset(): void {
    this.samples.length = 0;
    this.position = 0;
  }

  push(sample: number): void {
    this.samples.push(Number.isFinite(sample) ? sample : 0);
    while (this.position + 1 < this.samples.length) {
      const leftIndex = Math.floor(this.position);
      const fraction = this.position - leftIndex;
      const left = this.samples[leftIndex] ?? 0;
      const right = this.samples[leftIndex + 1] ?? left;
      this.emit(left + (right - left) * fraction);
      this.position += this.sourceSamplesPerOutput;
    }

    const consumed = Math.floor(this.position);
    if (consumed > 0) {
      this.samples.splice(0, consumed);
      this.position -= consumed;
    }
  }
}

class SampleQueue {
  private readonly values: Float32Array;
  private readIndex = 0;
  private writeIndex = 0;
  private count = 0;

  constructor(capacity: number) {
    this.values = new Float32Array(capacity);
  }

  get length(): number {
    return this.count;
  }

  clear(): void {
    this.readIndex = 0;
    this.writeIndex = 0;
    this.count = 0;
  }

  push(value: number): boolean {
    if (this.count >= this.values.length) return false;
    this.values[this.writeIndex] = value;
    this.writeIndex = (this.writeIndex + 1) % this.values.length;
    this.count += 1;
    return true;
  }

  pop(): number | undefined {
    if (this.count === 0) return undefined;
    const value = this.values[this.readIndex];
    this.readIndex = (this.readIndex + 1) % this.values.length;
    this.count -= 1;
    return value;
  }
}

class ClearVoiceAiProcessor extends AudioWorkletProcessor {
  private readonly window = createPeriodicHannWindow(WINDOW_SIZE);
  private readonly resamplerTaps = createResamplerTaps();
  private readonly decimator = new PolyphaseDecimator(this.resamplerTaps, (sample) => this.pushModelSample(sample));
  private readonly interpolator = new PolyphaseInterpolator(this.resamplerTaps, (sample) =>
    this.pushProcessedSample(sample),
  );
  private readonly analysisBuffer: number[] = new Array(HOP_SIZE).fill(0);
  private readonly processedQueue = new SampleQueue(16_384);
  // Model speech score for each queued output sample, so the optional second
  // output stays aligned with the processed audio it describes.
  private readonly speechQueue = new SampleQueue(16_384);
  private synthesizedSpeechProbability = 0;
  private lastOutputSpeechProbability = 0;
  private readonly synthesis = new Float32Array(WINDOW_SIZE);
  private readonly synthesisNorm = new Float32Array(WINDOW_SIZE);
  private readonly results = new Map<number, { spectrum: Float32Array; speechProbability: number }>();
  private inputResampler: StreamingLinearResampler | null = null;
  private outputResampler: StreamingLinearResampler | null = null;
  private modelPort: MessagePort | null = null;
  private modelReady = false;
  private modelStarted = false;
  private nextSequence = 0;
  private nextResultSequence = 0;
  private lastOutputSample = 0;
  private consecutiveUnderruns = 0;
  private reportedUnderrun = false;
  private renderQuanta = 0;
  private latestSpeechProbability = 0;

  constructor(options?: AudioWorkletNodeOptions) {
    super(options);
    if (Math.abs(DEVICE_SAMPLE_RATE - MODEL_INPUT_SAMPLE_RATE) > 1) {
      this.inputResampler = new StreamingLinearResampler(DEVICE_SAMPLE_RATE / MODEL_INPUT_SAMPLE_RATE, (sample) =>
        this.ingestModelRateSample(sample),
      );
      this.outputResampler = new StreamingLinearResampler(MODEL_INPUT_SAMPLE_RATE / DEVICE_SAMPLE_RATE, (sample) =>
        this.enqueueProcessed(sample),
      );
    }
    this.port.onmessage = (event: MessageEvent<unknown>) => {
      const data = event.data as { type?: unknown; port?: MessagePort } | null;
      if (!data) return;
      if (data.type === "reset") {
        this.resetStream();
        this.modelPort?.postMessage({ type: "reset" });
        return;
      }
      if (data.type !== "connect" || !data.port) return;
      this.modelPort = data.port;
      this.modelPort.onmessage = (modelEvent: MessageEvent<ModelPortMessage>) => {
        this.handleModelMessage(modelEvent.data);
      };
      this.modelPort.start();
    };
  }

  private resetStream(): void {
    this.inputResampler?.reset();
    this.outputResampler?.reset();
    this.decimator.reset();
    this.interpolator.reset();
    this.analysisBuffer.fill(0);
    this.processedQueue.clear();
    this.speechQueue.clear();
    this.synthesis.fill(0);
    this.synthesisNorm.fill(0);
    this.results.clear();
    this.nextSequence = 0;
    this.nextResultSequence = 0;
    this.lastOutputSample = 0;
    this.synthesizedSpeechProbability = 0;
    this.lastOutputSpeechProbability = 0;
    this.consecutiveUnderruns = 0;
    this.reportedUnderrun = false;
    this.modelStarted = false;
    this.latestSpeechProbability = 0;
  }

  private handleModelMessage(message: ModelPortMessage): void {
    if (message.type === "ready") {
      this.modelReady = true;
      this.port.postMessage({ type: "ready", sampleRate, mode: "clearvoice-ai-v6" });
      return;
    }
    if (message.type === "error") {
      this.modelReady = false;
      this.port.postMessage({ type: "error", reason: message.reason });
      return;
    }
    if (message.type !== "result" || !Number.isInteger(message.sequence)) return;
    this.results.set(message.sequence, {
      spectrum: message.spectrum,
      speechProbability: message.speechProbability,
    });
    this.consumeResultsInOrder();
  }

  private consumeResultsInOrder(): void {
    while (this.results.has(this.nextResultSequence)) {
      const result = this.results.get(this.nextResultSequence);
      this.results.delete(this.nextResultSequence);
      this.nextResultSequence += 1;
      if (!result) continue;
      this.synthesize(result.spectrum, result.speechProbability);
    }
  }

  private synthesize(spectrum: Float32Array, speechProbability: number): void {
    if (spectrum.length !== FREQUENCY_BINS * 2) return;
    this.latestSpeechProbability = clamp(Number.isFinite(speechProbability) ? speechProbability : 0, 0, 1);
    this.synthesizedSpeechProbability = this.latestSpeechProbability;
    const real = new Float32Array(FFT_SIZE);
    const imaginary = new Float32Array(FFT_SIZE);
    for (let bin = 0; bin < FREQUENCY_BINS; bin += 1) {
      real[bin] = spectrum[bin * 2];
      imaginary[bin] = spectrum[bin * 2 + 1];
      if (bin > 0 && bin < FREQUENCY_BINS - 1) {
        real[FFT_SIZE - bin] = real[bin];
        imaginary[FFT_SIZE - bin] = -imaginary[bin];
      }
    }
    // This must be an inverse transform. The previous adapter accidentally
    // performed a second forward FFT, circularly reversing each frame and
    // producing the phasey/robotic voice heard in the live V6 mode.
    transformInPlace(real, imaginary, true);

    for (let index = 0; index < WINDOW_SIZE; index += 1) {
      this.synthesis[index] += real[WINDOW_OFFSET + index] * this.window[index];
      this.synthesisNorm[index] += this.window[index] * this.window[index];
    }

    for (let index = 0; index < HOP_SIZE; index += 1) {
      const normalization = this.synthesisNorm[index];
      const value = normalization > 0.0001 ? this.synthesis[index] / normalization : 0;
      this.interpolator.push(clamp(value, -1, 1));
    }
    this.synthesis.copyWithin(0, HOP_SIZE);
    this.synthesis.fill(0, WINDOW_SIZE - HOP_SIZE);
    this.synthesisNorm.copyWithin(0, HOP_SIZE);
    this.synthesisNorm.fill(0, WINDOW_SIZE - HOP_SIZE);
  }

  private enqueueProcessed(value: number): void {
    if (this.processedQueue.push(value)) this.speechQueue.push(this.synthesizedSpeechProbability);
  }

  private pushProcessedSample(value: number): void {
    if (this.outputResampler) {
      this.outputResampler.push(value);
      return;
    }
    this.enqueueProcessed(value);
  }

  private postAnalysisFrame(): void {
    if (!this.modelPort || !this.modelReady) return;
    const real = new Float32Array(FFT_SIZE);
    const imaginary = new Float32Array(FFT_SIZE);
    for (let index = 0; index < WINDOW_SIZE; index += 1) {
      // torch.stft centers a shorter window inside n_fft. V6 consumes complex
      // spectra, so an uncentered window changes every bin phase and makes the
      // model operate on features it never saw during training.
      real[WINDOW_OFFSET + index] = this.analysisBuffer[index] * this.window[index];
    }
    transformInPlace(real, imaginary);
    const spectrum = new Float32Array(FREQUENCY_BINS * 2);
    for (let bin = 0; bin < FREQUENCY_BINS; bin += 1) {
      spectrum[bin * 2] = real[bin];
      spectrum[bin * 2 + 1] = imaginary[bin];
    }
    const sequence = this.nextSequence;
    this.nextSequence += 1;
    this.modelPort.postMessage({ type: "frame", sequence, spectrum }, [spectrum.buffer]);
  }

  private pushModelSample(sample: number): void {
    this.analysisBuffer.push(Number.isFinite(sample) ? sample : 0);
    while (this.analysisBuffer.length >= WINDOW_SIZE) {
      this.postAnalysisFrame();
      this.analysisBuffer.splice(0, HOP_SIZE);
    }
  }

  private ingestModelRateSample(sample: number): void {
    this.decimator.push(Number.isFinite(sample) ? sample : 0);
  }

  private ingestInput(input: Float32Array): void {
    for (const rawSample of input) {
      if (this.inputResampler) {
        this.inputResampler.push(rawSample);
      } else {
        this.ingestModelRateSample(rawSample);
      }
    }
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0]?.[0];
    const outputChannels = outputs[0] ?? [];
    const output = outputChannels[0];
    // Optional second output: the model's speech score for each processed
    // sample, consumed by the voice-activation gate. Left unconnected, it is
    // simply not rendered.
    const speechOutput = outputs[1]?.[0];
    if (!output) return true;
    if (!input) {
      for (const channel of outputChannels) channel.fill(0);
      speechOutput?.fill(0);
      return true;
    }

    this.ingestInput(input);
    // Worker replies arrive asynchronously. Do not require a multi-frame
    // prebuffer here: on a CPU running inference close to real time, the queue
    // naturally stays below that depth and the microphone would remain silent
    // forever. Start as soon as the first processed sample is available; the
    // bounded last-sample hold below covers short scheduling gaps.
    if (!this.modelStarted && this.processedQueue.length === 0) {
      for (const channel of outputChannels) channel.fill(0);
      speechOutput?.fill(0);
      return true;
    }
    for (let index = 0; index < output.length; index += 1) {
      let value = this.processedQueue.pop();
      const speech = this.speechQueue.pop();
      // Without fresh model output the score fades (about 20 ms time
      // constant), so a stalled model cannot hold the gate open as "speech".
      if (speech !== undefined) this.lastOutputSpeechProbability = speech;
      else this.lastOutputSpeechProbability *= 0.999;
      if (speechOutput) speechOutput[index] = this.lastOutputSpeechProbability;
      if (value !== undefined) {
        this.modelStarted = true;
        this.consecutiveUnderruns = 0;
        this.reportedUnderrun = false;
      } else if (this.modelStarted) {
        // Never pass the raw input through on an inference miss. Holding the
        // last processed sample keeps a brief gap bounded without leaking a
        // keyboard hit, chair squeak, or other unprocessed room noise.
        this.consecutiveUnderruns += 1;
        value = this.lastOutputSample * 0.99;
        if (this.consecutiveUnderruns >= 4_800 && !this.reportedUnderrun) {
          this.reportedUnderrun = true;
          this.port.postMessage({ type: "underrun" });
        }
      } else {
        // The parent graph keeps its raw route connected until a non-zero
        // processed signal is observed, so model startup cannot mute a call.
        value = 0;
      }
      output[index] = Number.isFinite(value) ? value : 0;
      this.lastOutputSample = output[index];
    }
    for (let channelIndex = 1; channelIndex < outputChannels.length; channelIndex += 1) {
      outputChannels[channelIndex].set(output);
    }
    this.renderQuanta += 1;
    if (this.renderQuanta % 50 === 0) {
      this.port.postMessage({
        type: "metrics",
        modelReady: this.modelReady,
        processedQueueSamples: this.processedQueue.length,
        speechProbability: this.latestSpeechProbability,
      });
    }
    return true;
  }
}

registerProcessor("decave-clearvoice-ai", ClearVoiceAiProcessor);
