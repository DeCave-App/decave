/**
 * Export-only replacement for src/audio/clearvoice/ClearVoiceAiRuntime.ts.
 * The public source snapshot omits model weights, so AI inference must reject
 * startup and let the voice engine use its existing non-AI fallback.
 */
export type ClearVoiceAiRuntime = {
  node: AudioWorkletNode;
  worker: Worker;
  /** Reset model, profile, transient and streaming state for a new capture. */
  reset: () => void;
  dispose: () => void;
};

export type ClearVoiceAiRuntimeOptions = {
  targetSpeaker?: boolean;
};

export async function createClearVoiceAiRuntime(
  context: AudioContext,
  options: ClearVoiceAiRuntimeOptions = {},
): Promise<ClearVoiceAiRuntime> {
  void context;
  void options;
  throw new Error("ClearVoice AI models are not included in this source release.");
}
