import DeepFilterWorker from "./DeepFilter.worker.ts?worker";
import deepFilterWorkletPath from "./DeepFilterProcessor.worklet.ts?worker&url";
import deepFilterWasmPath from "./vendor/df_bg.wasm?url";
import deepFilterModelPath from "./vendor/DeepFilterNet3_onnx.dfnmodel?url";
import { supportsWebAssemblySimd } from "../clearvoice/WebAssemblySimd";

export type DeepFilterRuntime = {
  node: AudioWorkletNode;
  worker: Worker;
  /** Reset model and streaming state for a new capture. */
  reset: () => void;
  dispose: () => void;
};

// No attenuation cap: noise-only input is removed as far as the model can.
const ATTENUATION_LIMIT_DB = 100;
const POST_FILTER_BETA = 0;
const STARTUP_TIMEOUT_MS = 30_000;

function errorMessage(value: unknown, fallback: string): string {
  return value instanceof Error ? value.message : typeof value === "string" ? value : fallback;
}

/**
 * Start DeepFilterNet3 noise suppression. Inference runs in a dedicated worker;
 * the AudioWorklet only frames audio in and out. Rejects (so the caller can
 * fall back to ClearVoice) when the device cannot run it.
 */
export async function createDeepFilterRuntime(context: AudioContext): Promise<DeepFilterRuntime> {
  if (
    !context.audioWorklet ||
    typeof Worker === "undefined" ||
    typeof MessageChannel === "undefined" ||
    typeof WebAssembly === "undefined"
  ) {
    throw new Error("DeepFilterNet is not supported by this browser runtime.");
  }
  // The wasm build uses 128-bit SIMD; without it the module cannot compile.
  if (!supportsWebAssemblySimd()) throw new Error("DeepFilterNet needs WebAssembly SIMD.");
  if (context.sampleRate !== 48_000) {
    throw new Error(`DeepFilterNet requires 48 kHz audio; the audio engine opened at ${context.sampleRate} Hz.`);
  }

  await context.audioWorklet.addModule(deepFilterWorkletPath);

  const worker = new DeepFilterWorker();
  let node: AudioWorkletNode;
  try {
    node = new AudioWorkletNode(context, "decave-deepfilter", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelCountMode: "explicit",
      outputChannelCount: [1],
    });
  } catch (error) {
    worker.terminate();
    throw error;
  }
  const channel = new MessageChannel();
  let settled = false;
  let timeoutId: number | null = null;

  const reset = () => {
    try {
      node.port.postMessage({ type: "reset" });
    } catch {}
  };
  const dispose = () => {
    if (timeoutId !== null) window.clearTimeout(timeoutId);
    timeoutId = null;
    try {
      channel.port2.postMessage({ type: "shutdown" });
    } catch {}
    try {
      channel.port1.close();
    } catch {}
    try {
      channel.port2.close();
    } catch {}
    try {
      node.disconnect();
    } catch {}
    worker.terminate();
  };

  try {
    await new Promise<void>((resolve, reject) => {
      const fail = (reason: unknown) => {
        if (settled) return;
        settled = true;
        reject(new Error(errorMessage(reason, "DeepFilterNet could not start.")));
      };
      node.port.onmessage = (event: MessageEvent<{ type?: unknown; reason?: unknown }>) => {
        const data = event.data;
        if (!data || typeof data !== "object") return;
        if (data.type === "ready") {
          if (settled) return;
          settled = true;
          if (timeoutId !== null) window.clearTimeout(timeoutId);
          timeoutId = null;
          resolve();
        } else if (data.type === "error") {
          fail(data.reason);
        }
      };
      node.onprocessorerror = () => fail("DeepFilterNet audio worklet failed during startup.");
      worker.onerror = (event) => fail(event.message || "DeepFilterNet model worker failed during startup.");
      worker.onmessageerror = () => fail("DeepFilterNet model worker could not exchange startup data.");
      timeoutId = window.setTimeout(() => fail("DeepFilterNet startup timed out."), STARTUP_TIMEOUT_MS);
      try {
        worker.postMessage(
          {
            type: "connect",
            port: channel.port1,
            wasmUrl: new URL(deepFilterWasmPath, location.href).href,
            modelUrl: new URL(deepFilterModelPath, location.href).href,
            attenLimDb: ATTENUATION_LIMIT_DB,
            postFilterBeta: POST_FILTER_BETA,
          },
          [channel.port1],
        );
        node.port.postMessage({ type: "connect", port: channel.port2 }, [channel.port2]);
      } catch (error) {
        fail(error);
      }
    });
  } catch (error) {
    dispose();
    throw error;
  }

  // The caller installs its own listener for runtime errors and underruns.
  node.port.onmessage = null;
  return { node, worker, reset, dispose };
}
