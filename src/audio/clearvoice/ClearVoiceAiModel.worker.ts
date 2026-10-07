import * as ort from "onnxruntime-web/wasm";
import wasmModulePath from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";
import wasmBinaryPath from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import { ClearVoiceTransientDetector } from "./ClearVoiceTransientDetector.ts";

const HIDDEN_SIZE = 224;
const RECURRENT_LAYERS = 2;
const FREQUENCY_BINS = 257;
const FFT_SIZE = 512;
const SAMPLE_RATE = 16_000;
const SPEAKER_PROFILE_SIZE = 64;
const SPEAKER_PROFILE_ENROLL_FRAMES = 48;
const SPEAKER_PROFILE_MIN_PROBABILITY = 0.62;
const SPEAKER_PROFILE_MIN_VOICED_RATIO = 0.08;
// Flat broadband frames are poor identity evidence even when generic VAD is high.
const SPEAKER_PROFILE_MAX_FLATNESS = 0.72;

type WorkerFrameMessage = {
  type: "frame";
  sequence: number;
  spectrum: Float32Array;
};

type WorkerPortMessage = WorkerFrameMessage | { type: "reset" } | { type: "shutdown" };

type WorkerConnectMessage = {
  type: "connect";
  modelUrl: string;
  port: MessagePort;
  targetSpeaker?: boolean;
};

type WorkerResponse =
  | { type: "ready" }
  | { type: "error"; reason: string }
  | {
      type: "result";
      sequence: number;
      spectrum: Float32Array;
      speechProbability: number;
    };

type WorkerScope = {
  onmessage: ((event: MessageEvent<WorkerConnectMessage>) => void) | null;
};

const workerScope = globalThis as unknown as WorkerScope;
let modelPort: MessagePort | null = null;
let session: ort.InferenceSession | null = null;
let modelState = new Float32Array(RECURRENT_LAYERS * HIDDEN_SIZE);
let frameQueue: WorkerFrameMessage[] = [];
let pumping = false;
let stopped = false;
let stateGeneration = 0;
let targetSpeaker = false;
const speakerProfileSums = new Float32Array(SPEAKER_PROFILE_SIZE);
const speakerProfile = new Float32Array(SPEAKER_PROFILE_SIZE);
let speakerProfileCount = 0;
let speakerProfileWeight = 0;
let speakerProfileDirty = true;
const transientDetector = new ClearVoiceTransientDetector(SAMPLE_RATE, FFT_SIZE);

function send(message: WorkerResponse, transfer: Transferable[] = []): void {
  modelPort?.postMessage(message, transfer);
}

function resetState(): void {
  stateGeneration += 1;
  modelState = new Float32Array(RECURRENT_LAYERS * HIDDEN_SIZE);
  frameQueue = [];
  transientDetector.reset();
  speakerProfileSums.fill(0);
  speakerProfile.fill(0);
  speakerProfileCount = 0;
  speakerProfileWeight = 0;
  speakerProfileDirty = true;
}

function currentSpeakerProfile(): Float32Array {
  if (!speakerProfileDirty) return speakerProfile;
  speakerProfile.fill(0);
  if (speakerProfileCount === 0 || speakerProfileWeight <= 0) {
    speakerProfileDirty = false;
    return speakerProfile;
  }
  let mean = 0;
  for (let index = 0; index < SPEAKER_PROFILE_SIZE; index += 1) {
    speakerProfile[index] = speakerProfileSums[index] / speakerProfileWeight;
    mean += speakerProfile[index];
  }
  mean /= SPEAKER_PROFILE_SIZE;
  let variance = 0;
  for (let index = 0; index < SPEAKER_PROFILE_SIZE; index += 1) {
    speakerProfile[index] -= mean;
    variance += speakerProfile[index] * speakerProfile[index];
  }
  const scale = Math.sqrt(variance / SPEAKER_PROFILE_SIZE + 1.0e-5);
  for (let index = 0; index < SPEAKER_PROFILE_SIZE; index += 1) speakerProfile[index] /= scale;
  speakerProfileDirty = false;
  return speakerProfile;
}

function updateSpeakerProfile(spectrum: Float32Array, speechProbability: number): void {
  if (
    !targetSpeaker ||
    speakerProfileCount >= SPEAKER_PROFILE_ENROLL_FRAMES ||
    speechProbability < SPEAKER_PROFILE_MIN_PROBABILITY
  )
    return;
  const bandSums = new Float32Array(SPEAKER_PROFILE_SIZE);
  const bandCounts = new Float32Array(SPEAKER_PROFILE_SIZE);
  let energy = 0;
  let totalSquaredEnergy = 0;
  let voicedEnergy = 0;
  let logEnergy = 0;
  let arithmeticEnergy = 0;
  for (let bin = 0; bin < FREQUENCY_BINS; bin += 1) {
    const offset = bin * 2;
    const magnitude = Math.hypot(spectrum[offset], spectrum[offset + 1]);
    energy += magnitude;
    const squaredMagnitude = magnitude * magnitude;
    totalSquaredEnergy += squaredMagnitude;
    const frequency = (bin * SAMPLE_RATE) / FFT_SIZE;
    if (frequency >= 120 && frequency < 1_900) voicedEnergy += squaredMagnitude;
    logEnergy += Math.log(Math.max(magnitude, 1.0e-8));
    arithmeticEnergy += magnitude;
    const profileBin = Math.min(SPEAKER_PROFILE_SIZE - 1, Math.floor((bin * SPEAKER_PROFILE_SIZE) / FREQUENCY_BINS));
    bandSums[profileBin] += Math.log1p(magnitude * 8.0);
    bandCounts[profileBin] += 1;
  }
  if (energy < 0.01) return;
  const voicedRatio = voicedEnergy / Math.max(1.0e-8, totalSquaredEnergy);
  const flatness = Math.exp(logEnergy / FREQUENCY_BINS) / Math.max(arithmeticEnergy / FREQUENCY_BINS, 1.0e-8);
  // Enrollment is deliberately stricter than inference. A noise-only frame
  // must not become the target profile simply because the generic VAD was
  // briefly optimistic. Flat broadband frames are rejected, while a quiet
  // voiced frame with a modest lower-band ratio remains eligible.
  if (voicedRatio < SPEAKER_PROFILE_MIN_VOICED_RATIO || flatness > SPEAKER_PROFILE_MAX_FLATNESS) return;
  const candidate = new Float32Array(SPEAKER_PROFILE_SIZE);
  let candidateMean = 0;
  for (let index = 0; index < SPEAKER_PROFILE_SIZE; index += 1) {
    candidate[index] = bandSums[index] / Math.max(1, bandCounts[index]);
    candidateMean += candidate[index];
  }
  candidateMean /= SPEAKER_PROFILE_SIZE;
  let candidateVariance = 0;
  for (let index = 0; index < SPEAKER_PROFILE_SIZE; index += 1) {
    candidate[index] -= candidateMean;
    candidateVariance += candidate[index] * candidate[index];
  }
  const candidateScale = Math.sqrt(candidateVariance / SPEAKER_PROFILE_SIZE + 1.0e-5);
  for (let index = 0; index < SPEAKER_PROFILE_SIZE; index += 1) candidate[index] /= candidateScale;
  // Once a small seed exists, reject a distant outlier instead of allowing a
  // competing speaker or a contaminated first burst to pull the mean away.
  if (speakerProfileCount >= 4) {
    const existing = currentSpeakerProfile();
    let similarity = 0;
    for (let index = 0; index < SPEAKER_PROFILE_SIZE; index += 1) similarity += candidate[index] * existing[index];
    similarity /= SPEAKER_PROFILE_SIZE;
    if (similarity < 0.12) return;
  }
  const weight = Math.min(1, Math.max(0.15, (speechProbability - 0.55) / 0.45));
  for (let index = 0; index < SPEAKER_PROFILE_SIZE; index += 1) {
    speakerProfileSums[index] += candidate[index] * weight;
  }
  speakerProfileCount += 1;
  speakerProfileWeight += weight;
  speakerProfileDirty = true;
}

function restoreVoicedAirDetail(inputSpectrum: Float32Array, enhanced: Float32Array, speechProbability: number): void {
  // The target mask is intentionally strong against airflow. That is useful
  // for noise-only frames, but it can shave the breathy upper harmonics from
  // an otherwise voiced frame. Restore only a small, frequency-shaped
  // residual when there is enough lower-band voice energy to support it.
  const speechConfidence = Math.max(0, Math.min(1, (speechProbability - 0.58) / 0.3));
  if (speechConfidence <= 0) return;
  let totalEnergy = 0;
  let voicedEnergy = 0;
  let airEnergy = 0;
  for (let bin = 0; bin < FREQUENCY_BINS; bin += 1) {
    const offset = bin * 2;
    const energy = inputSpectrum[offset] ** 2 + inputSpectrum[offset + 1] ** 2;
    const frequency = (bin * SAMPLE_RATE) / FFT_SIZE;
    totalEnergy += energy;
    if (frequency >= 120 && frequency < 1_900) voicedEnergy += energy;
    if (frequency >= 2_200 && frequency < 7_000) airEnergy += energy;
  }
  const voicedRatio = voicedEnergy / Math.max(totalEnergy, 1.0e-8);
  const airRatio = airEnergy / Math.max(totalEnergy, 1.0e-8);
  if (voicedRatio < 0.16 || airRatio < 0.12) return;

  const residualMix = 0.18 * speechConfidence * Math.min(1, voicedRatio / 0.32);
  for (let bin = 0; bin < FREQUENCY_BINS; bin += 1) {
    const frequency = (bin * SAMPLE_RATE) / FFT_SIZE;
    if (frequency < 1_900 || frequency >= 7_000) continue;
    const highBandRamp = Math.max(0, Math.min(1, (frequency - 1_900) / 2_800));
    const mix = residualMix * (0.35 + 0.65 * highBandRamp);
    const offset = bin * 2;
    enhanced[offset] = enhanced[offset] * (1 - mix) + inputSpectrum[offset] * mix;
    enhanced[offset + 1] = enhanced[offset + 1] * (1 - mix) + inputSpectrum[offset + 1] * mix;
  }
}

async function infer(frame: WorkerFrameMessage): Promise<void> {
  if (!session) throw new Error("ClearVoice V6 model is not initialized.");
  if (frame.spectrum.length !== FREQUENCY_BINS * 2) {
    throw new Error("ClearVoice V6 received an invalid spectrum frame.");
  }

  const generation = stateGeneration;
  const spectrum = new ort.Tensor("float32", frame.spectrum, [1, 1, FREQUENCY_BINS, 2]);
  const state = new ort.Tensor("float32", modelState, [RECURRENT_LAYERS, 1, HIDDEN_SIZE]);
  const inputs: Record<string, ort.Tensor> = { spectrum, state };
  if (targetSpeaker) {
    inputs.speaker_profile = new ort.Tensor("float32", currentSpeakerProfile(), [1, SPEAKER_PROFILE_SIZE]);
  }
  const outputs = await session.run(inputs);
  if (generation !== stateGeneration || stopped) return;
  const mask = outputs.mask.data as Float32Array;
  const nextState = outputs.next_state.data as Float32Array;
  const enhanced = new Float32Array(frame.spectrum.length);
  for (let bin = 0; bin < FREQUENCY_BINS; bin += 1) {
    const offset = bin * 2;
    const inputReal = frame.spectrum[offset];
    const inputImaginary = frame.spectrum[offset + 1];
    const maskReal = mask[offset];
    const maskImaginary = mask[offset + 1];
    enhanced[offset] = inputReal * maskReal - inputImaginary * maskImaginary;
    enhanced[offset + 1] = inputReal * maskImaginary + inputImaginary * maskReal;
  }
  const speechProbability = Number((outputs.speech_probability.data as Float32Array)[0] ?? 0);
  // The target-speaker model can return a valid, well-denoised spectrum at a
  // much lower level for some microphones/voices. Restore conservative speech
  // loudness from the input energy, but only after the model is confident that
  // the frame is speech so fans, air, and eating transients are never lifted.
  if (Number.isFinite(speechProbability) && speechProbability >= 0.45) {
    let inputEnergy = 0;
    let enhancedEnergy = 0;
    for (let bin = 0; bin < FREQUENCY_BINS; bin += 1) {
      const offset = bin * 2;
      inputEnergy += frame.spectrum[offset] ** 2 + frame.spectrum[offset + 1] ** 2;
      enhancedEnergy += enhanced[offset] ** 2 + enhanced[offset + 1] ** 2;
    }
    if (enhancedEnergy > 1.0e-8 && inputEnergy > enhancedEnergy) {
      const makeupGain = Math.min(4, Math.max(1, Math.sqrt(inputEnergy / enhancedEnergy) * 0.82));
      if (makeupGain > 1.01) {
        for (let index = 0; index < enhanced.length; index += 1) enhanced[index] *= makeupGain;
      }
    }
  }
  restoreVoicedAirDetail(frame.spectrum, enhanced, speechProbability);
  updateSpeakerProfile(frame.spectrum, Number.isFinite(speechProbability) ? speechProbability : 0);
  const transient = transientDetector.process(
    frame.spectrum,
    Number.isFinite(speechProbability) ? speechProbability : 0,
  );
  for (let bin = 0; bin < FREQUENCY_BINS; bin += 1) {
    const gain = transient.gains[bin];
    const offset = bin * 2;
    enhanced[offset] *= gain;
    enhanced[offset + 1] *= gain;
  }
  modelState = new Float32Array(nextState);
  send(
    {
      type: "result",
      sequence: frame.sequence,
      spectrum: enhanced,
      speechProbability: Number.isFinite(speechProbability) ? speechProbability : 0,
    },
    [enhanced.buffer],
  );
}

async function pump(): Promise<void> {
  if (pumping || stopped) return;
  pumping = true;
  try {
    while (frameQueue.length > 0 && !stopped) {
      const frame = frameQueue.shift();
      if (frame) await infer(frame);
    }
  } catch (error) {
    frameQueue = [];
    send({
      type: "error",
      reason: error instanceof Error ? error.message : "ClearVoice V6 inference failed.",
    });
  } finally {
    pumping = false;
  }
}

function handlePortMessage(message: WorkerPortMessage): void {
  if (message.type === "reset") {
    resetState();
    return;
  }
  if (message.type === "shutdown") {
    stopped = true;
    frameQueue = [];
    void session?.release();
    session = null;
    modelPort?.close();
    modelPort = null;
    return;
  }
  // An inference slower than real time would otherwise create an ever-growing
  // delayed microphone. Fail open instead of silently accumulating latency.
  if (frameQueue.length >= 8) {
    frameQueue = [];
    send({ type: "error", reason: "ClearVoice V6 missed its real-time deadline." });
    return;
  }
  frameQueue.push(message);
  void pump();
}

async function initialize(message: WorkerConnectMessage): Promise<void> {
  modelPort = message.port;
  targetSpeaker = message.targetSpeaker === true;
  modelPort.onmessage = (event: MessageEvent<WorkerPortMessage>) => {
    handlePortMessage(event.data);
  };
  modelPort.start();
  try {
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmPaths = {
      mjs: wasmModulePath,
      wasm: wasmBinaryPath,
    };
    session = await ort.InferenceSession.create(message.modelUrl, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });
    send({ type: "ready" });
  } catch (error) {
    send({
      type: "error",
      reason: error instanceof Error ? error.message : "ClearVoice V6 model loading failed.",
    });
  }
}

workerScope.onmessage = (event) => {
  if (event.data?.type !== "connect" || modelPort) return;
  void initialize(event.data);
};
