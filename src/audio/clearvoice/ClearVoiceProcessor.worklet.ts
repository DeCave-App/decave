import { ClearVoicePipeline, type ClearVoiceMode } from "./ClearVoicePipeline";

declare const sampleRate: number;

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: AudioWorkletNodeOptions);
  process(inputs: Float32Array[][], outputs: Float32Array[][], _parameters: Record<string, Float32Array>): boolean;
}

declare function registerProcessor(name: string, processorCtor: typeof AudioWorkletProcessor): void;

class ClearVoiceProcessor extends AudioWorkletProcessor {
  private readonly pipeline: ClearVoicePipeline;
  private renderQuanta = 0;

  constructor(options?: AudioWorkletNodeOptions) {
    super(options);
    const mode = options?.processorOptions?.mode === "strong" ? "strong" : "standard";
    this.pipeline = new ClearVoicePipeline(sampleRate, mode as ClearVoiceMode);
    this.port.postMessage({ type: "ready", sampleRate, mode });
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

    const metrics = this.pipeline.process(input, output);
    for (let channelIndex = 1; channelIndex < outputChannels.length; channelIndex += 1) {
      outputChannels[channelIndex].set(output);
    }
    this.renderQuanta += 1;
    if (this.renderQuanta % 12 === 0) this.port.postMessage({ type: "metrics", metrics });
    return true;
  }
}

registerProcessor("decave-clearvoice", ClearVoiceProcessor);
