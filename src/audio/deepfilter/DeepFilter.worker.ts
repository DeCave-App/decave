// Model worker for DeepFilterNet3. The wasm is built from the upstream
// Rikorose/DeepFilterNet libDF sources (see ./vendor/README.md); it runs the
// full STFT -> DNN -> ISTFT chain per 480-sample hop.
import initDeepFilter, {
  df_create,
  df_free,
  df_get_frame_length,
  df_process_frame_into,
  df_set_atten_lim,
  df_set_post_filter_beta,
} from "./vendor/df.js";

type WorkerFrameMessage = { type: "frame"; sequence: number; samples: Float32Array };
type WorkerPortMessage = WorkerFrameMessage | { type: "reset" } | { type: "shutdown" };

export type DeepFilterWorkerConnectMessage = {
  type: "connect";
  port: MessagePort;
  wasmUrl: string;
  modelUrl: string;
  attenLimDb: number;
  postFilterBeta: number;
};

type WorkerScope = {
  onmessage: ((event: MessageEvent<DeepFilterWorkerConnectMessage>) => void) | null;
};

const workerScope = globalThis as unknown as WorkerScope;
let modelPort: MessagePort | null = null;
let modelBytes: Uint8Array | null = null;
let state = 0;
let hopSize = 480;
let output = new Float32Array(hopSize);
let attenLimDb = 100;
let postFilterBeta = 0;
let stopped = false;

// The model is a .tar.gz. Some servers label it Content-Encoding: gzip, in
// which case fetch hands back the bare tar; re-wrap it so libDF can parse it.
async function gzipped(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) return bytes;
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function createState(): void {
  if (!modelBytes) throw new Error("DeepFilterNet model is not loaded.");
  if (state) df_free(state);
  state = df_create(modelBytes, attenLimDb);
  df_set_atten_lim(state, attenLimDb);
  df_set_post_filter_beta(state, postFilterBeta);
  hopSize = df_get_frame_length(state);
  output = new Float32Array(hopSize);
}

function processFrame(message: WorkerFrameMessage): void {
  if (!state || stopped || message.samples.length !== hopSize) return;
  const lsnr = df_process_frame_into(state, message.samples, output);
  // Reuse the transferred input buffer for the reply so the steady state does
  // not allocate a new array per hop.
  const samples = message.samples;
  samples.set(output);
  modelPort?.postMessage({ type: "result", sequence: message.sequence, samples, lsnr }, [samples.buffer]);
}

function handlePortMessage(message: WorkerPortMessage): void {
  try {
    if (message.type === "frame") processFrame(message);
    else if (message.type === "reset") createState();
    else if (message.type === "shutdown") {
      stopped = true;
      if (state) df_free(state);
      state = 0;
      modelPort?.close();
    }
  } catch (error) {
    stopped = true;
    modelPort?.postMessage({
      type: "error",
      reason: error instanceof Error ? error.message : "DeepFilterNet failed while processing audio.",
    });
  }
}

async function connect(message: DeepFilterWorkerConnectMessage): Promise<void> {
  modelPort = message.port;
  modelPort.onmessage = (event: MessageEvent<WorkerPortMessage>) => handlePortMessage(event.data);
  modelPort.start();
  try {
    attenLimDb = message.attenLimDb;
    postFilterBeta = message.postFilterBeta;
    const [, modelResponse] = await Promise.all([initDeepFilter(message.wasmUrl), fetch(message.modelUrl)]);
    if (!modelResponse.ok) throw new Error(`DeepFilterNet model download failed (${modelResponse.status}).`);
    modelBytes = await gzipped(new Uint8Array(await modelResponse.arrayBuffer()));
    createState();
    modelPort.postMessage({ type: "ready", hopSize });
  } catch (error) {
    modelPort.postMessage({
      type: "error",
      reason: error instanceof Error ? error.message : "DeepFilterNet could not start.",
    });
  }
}

workerScope.onmessage = (event) => {
  if (event.data?.type === "connect" && event.data.port) void connect(event.data);
};
