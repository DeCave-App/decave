// AudioWorklet half of the DeepFilterNet3 bridge. It slices the 48 kHz
// microphone into the model's 480-sample hops, ships each hop to the model
// worker, and plays the enhanced hops back in order. Inference never runs on
// the audio thread, so a slow CPU produces a reported underrun instead of a
// glitching render quantum.

import { DEEP_FILTER_JITTER_CUSHION_SAMPLES } from "./jitterCushion";

declare const sampleRate: number;

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: AudioWorkletNodeOptions);
  process(inputs: Float32Array[][], outputs: Float32Array[][], _parameters: Record<string, Float32Array>): boolean;
}

declare function registerProcessor(name: string, processorCtor: typeof AudioWorkletProcessor): void;

const DEEP_FILTER_SAMPLE_RATE = 48_000;
const DEEP_FILTER_HOP_SIZE = 480;

type ModelPortMessage =
  | { type: "ready"; hopSize: number }
  | { type: "error"; reason: string }
  | { type: "result"; sequence: number; samples: Float32Array; lsnr: number };

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

  push(value: number): void {
    if (this.count >= this.values.length) return;
    this.values[this.writeIndex] = value;
    this.writeIndex = (this.writeIndex + 1) % this.values.length;
    this.count += 1;
  }

  pop(): number | undefined {
    if (this.count === 0) return undefined;
    const value = this.values[this.readIndex];
    this.readIndex = (this.readIndex + 1) % this.values.length;
    this.count -= 1;
    return value;
  }
}

class DeepFilterProcessor extends AudioWorkletProcessor {
  private hopSize = DEEP_FILTER_HOP_SIZE;
  private frame = new Float32Array(DEEP_FILTER_HOP_SIZE);
  private frameFill = 0;
  private readonly processedQueue = new SampleQueue(DEEP_FILTER_SAMPLE_RATE);
  private readonly results = new Map<number, Float32Array>();
  private modelPort: MessagePort | null = null;
  private modelReady = false;
  private modelStarted = false;
  private buffering = true;
  private nextSequence = 0;
  private nextResultSequence = 0;
  private lastOutputSample = 0;
  private consecutiveUnderruns = 0;
  private reportedUnderrun = false;
  private renderQuanta = 0;
  private latestLsnr = 0;

  constructor(options?: AudioWorkletNodeOptions) {
    super(options);
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
    this.frame.fill(0);
    this.frameFill = 0;
    this.processedQueue.clear();
    this.results.clear();
    this.nextSequence = 0;
    this.nextResultSequence = 0;
    this.lastOutputSample = 0;
    this.consecutiveUnderruns = 0;
    this.reportedUnderrun = false;
    this.modelStarted = false;
    this.buffering = true;
  }

  private handleModelMessage(message: ModelPortMessage): void {
    if (message.type === "ready") {
      if (Number.isInteger(message.hopSize) && message.hopSize > 0 && message.hopSize !== this.hopSize) {
        this.hopSize = message.hopSize;
        this.frame = new Float32Array(this.hopSize);
        this.frameFill = 0;
      }
      this.modelReady = true;
      this.port.postMessage({ type: "ready", sampleRate, mode: "deepfilternet3" });
      return;
    }
    if (message.type === "error") {
      this.modelReady = false;
      this.port.postMessage({ type: "error", reason: message.reason });
      return;
    }
    if (message.type !== "result" || !Number.isInteger(message.sequence)) return;
    this.latestLsnr = Number.isFinite(message.lsnr) ? message.lsnr : this.latestLsnr;
    this.results.set(message.sequence, message.samples);
    while (this.results.has(this.nextResultSequence)) {
      const samples = this.results.get(this.nextResultSequence);
      this.results.delete(this.nextResultSequence);
      this.nextResultSequence += 1;
      if (!samples) continue;
      for (const value of samples)
        this.processedQueue.push(Number.isFinite(value) ? Math.min(1, Math.max(-1, value)) : 0);
    }
  }

  private ingest(input: Float32Array): void {
    for (const sample of input) {
      this.frame[this.frameFill] = Number.isFinite(sample) ? sample : 0;
      this.frameFill += 1;
      if (this.frameFill < this.hopSize) continue;
      this.frameFill = 0;
      if (!this.modelPort || !this.modelReady) continue;
      const samples = this.frame.slice();
      this.modelPort.postMessage({ type: "frame", sequence: this.nextSequence, samples }, [samples.buffer]);
      this.nextSequence += 1;
    }
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0]?.[0];
    const outputChannels = outputs[0] ?? [];
    const output = outputChannels[0];
    if (!output) return true;
    if (!input) {
      for (const channel of outputChannels) channel.fill(0);
      return true;
    }

    this.ingest(input);
    if (!this.modelStarted && this.processedQueue.length === 0) {
      // The parent graph treats startup silence as "still warming up"; the raw
      // microphone is never passed through from here.
      for (const channel of outputChannels) channel.fill(0);
      return true;
    }
    if (this.buffering && this.processedQueue.length >= DEEP_FILTER_JITTER_CUSHION_SAMPLES) this.buffering = false;
    for (let index = 0; index < output.length; index += 1) {
      let value = this.buffering ? undefined : this.processedQueue.pop();
      if (value !== undefined) {
        this.modelStarted = true;
        this.consecutiveUnderruns = 0;
        this.reportedUnderrun = false;
      } else {
        // Rebuild the cushion before resuming, or every late hop chops again.
        this.buffering = true;
        // Same policy as ClearVoice V6: on an inference miss, fade the last
        // processed sample instead of leaking unprocessed room noise.
        this.consecutiveUnderruns += 1;
        value = this.lastOutputSample * 0.99;
        if (this.consecutiveUnderruns >= 4_800 && !this.reportedUnderrun) {
          this.reportedUnderrun = true;
          this.port.postMessage({ type: "underrun" });
        }
      }
      output[index] = value;
      this.lastOutputSample = value;
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
        lsnr: this.latestLsnr,
      });
    }
    return true;
  }
}

registerProcessor("decave-deepfilter", DeepFilterProcessor);
