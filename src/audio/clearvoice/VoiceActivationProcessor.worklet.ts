import {
  calibrateModelSpeechProbability,
  VoiceActivationGate,
  type VoiceActivationGateConfig,
} from "./VoiceActivationGate";

declare const sampleRate: number;

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: AudioWorkletNodeOptions);
  process(inputs: Float32Array[][], outputs: Float32Array[][], _parameters: Record<string, Float32Array>): boolean;
}

declare function registerProcessor(name: string, processorCtor: typeof AudioWorkletProcessor): void;

class VoiceActivationProcessor extends AudioWorkletProcessor {
  private readonly gate: VoiceActivationGate;
  private renderQuanta = 0;
  private lastAudible = true;
  private usingModelSpeechScore = false;

  constructor(options?: AudioWorkletNodeOptions) {
    super(options);
    const initial = options?.processorOptions as Partial<VoiceActivationGateConfig> | undefined;
    this.gate = new VoiceActivationGate(sampleRate, initial);
    this.port.onmessage = (event: MessageEvent<unknown>) => {
      const data = event.data;
      if (!data || typeof data !== "object") return;
      const message = data as {
        type?: unknown;
        enabled?: unknown;
        thresholdDb?: unknown;
        automatic?: unknown;
        postVadProbability?: unknown;
      };
      if (message.type === "reset") {
        this.gate.reset();
        return;
      }
      if (message.type !== "configure") return;
      this.gate.configure({
        ...(typeof message.enabled === "boolean" ? { enabled: message.enabled } : {}),
        ...(typeof message.automatic === "boolean" ? { automatic: message.automatic } : {}),
        ...(typeof message.thresholdDb === "number" ? { thresholdDb: message.thresholdDb } : {}),
        ...(message.postVadProbability === null
          ? { postVadProbability: null }
          : typeof message.postVadProbability === "number"
            ? { postVadProbability: message.postVadProbability }
            : {}),
      });
    };
    this.port.postMessage({ type: "ready", sampleRate });
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

    // The first input is the audio that is actually transmitted. The optional
    // second input is the raw microphone sidechain, so the UI threshold is
    // measured against the same signal regardless of the selected processor.
    const detectionInput = inputs[1]?.[0] ?? input;
    // The optional third input carries the ClearVoice model's per-sample
    // speech score, aligned with input 0. It replaces the gate's own
    // time-domain estimate while connected; other modes leave it unconnected.
    const speechScore = inputs[2]?.[0];
    if (speechScore && speechScore.length > 0) {
      let sum = 0;
      for (const value of speechScore) sum += Number.isFinite(value) ? value : 0;
      this.gate.configure({ postVadProbability: calibrateModelSpeechProbability(sum / speechScore.length) });
      this.usingModelSpeechScore = true;
    } else if (this.usingModelSpeechScore) {
      this.gate.configure({ postVadProbability: null });
      this.usingModelSpeechScore = false;
    }
    const metrics = this.gate.process(input, output, detectionInput);
    for (let channelIndex = 1; channelIndex < outputChannels.length; channelIndex += 1) {
      outputChannels[channelIndex].set(output);
    }
    this.renderQuanta += 1;
    if (metrics.audible !== this.lastAudible || this.renderQuanta % 24 === 0) {
      this.lastAudible = metrics.audible;
      this.port.postMessage({ type: "state", metrics });
    }
    return true;
  }
}

registerProcessor("decave-voice-activation", VoiceActivationProcessor);
