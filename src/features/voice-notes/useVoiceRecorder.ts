import { useEffect, useMemo, useSyncExternalStore } from "react";
import { VOICE_NOTE_MAX_MS, VOICE_NOTE_MIN_MS, encodeWave, type VoiceNoteMeta } from "../../../shared/voice-note.ts";

export type VoiceNoteDraft = { blob: Blob; mime: string; meta: VoiceNoteMeta };
export type VoiceRecorderState = "idle" | "recording" | "preview" | "error";
export type VoiceRecorderError = "permission" | "no-device" | "unsupported";

export type VoiceRecorderSnapshot = {
  state: VoiceRecorderState;
  error?: VoiceRecorderError;
  elapsedMs: number;
  liveLevels: number[];
  result: VoiceNoteDraft | null;
};

export type VoiceRecorder = VoiceRecorderSnapshot & {
  start(): Promise<void>;
  stop(): void;
  discard(): void;
};

type RecorderLike = {
  state: string;
  ondataavailable: ((e: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
};

type AnalyserLike = { fftSize: number; getByteTimeDomainData(a: Uint8Array): void };
type SourceLike = { connect(n: unknown): void; disconnect(): void };
type AudioContextLike = {
  state?: string;
  resume?(): Promise<void>;
  createMediaStreamSource(s: MediaStream): SourceLike;
  createAnalyser(): AnalyserLike;
  close(): Promise<void>;
};

export type VoiceRecorderDeps = {
  getUserMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>;
  MediaRecorder?: {
    new (stream: MediaStream, opts: { mimeType: string; audioBitsPerSecond: number }): RecorderLike;
    isTypeSupported(mime: string): boolean;
  };
  AudioContext?: new () => AudioContextLike;
  now: () => number;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (id: unknown) => void;
};

type Session = {
  stream: MediaStream;
  recorder: RecorderLike;
  ctx: AudioContextLike | null;
  source: SourceLike | null;
  analyser: AnalyserLike | null;
  buf: Uint8Array;
  chunks: Blob[];
  startedAt: number;
  levels: number[];
  timer: unknown;
  mime: string;
  finishMs: number;
  keep: boolean;
  stopping: boolean;
};

// AAC in MP4 first: iPhones (AVPlayer) cannot play WebM. WebM/Opus is only the fallback.
export const MIME_PREFERENCE = ["audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/webm;codecs=opus"];
const SAMPLE_MS = 50;
const EMPTY: VoiceRecorderSnapshot = { state: "idle", elapsedMs: 0, liveLevels: [], result: null };

/** Pure recorder core: every browser API and the clock are injected so tests can drive it. */
export function createVoiceRecorderController(deps: VoiceRecorderDeps) {
  let snap: VoiceRecorderSnapshot = EMPTY;
  const listeners = new Set<() => void>();
  let session: Session | null = null;
  let starting = false;
  let generation = 0;

  const set = (next: VoiceRecorderSnapshot) => {
    snap = next;
    for (const l of listeners) l();
  };

  function release(s: Session) {
    deps.clearInterval(s.timer);
    try {
      s.source?.disconnect();
    } catch {
      /* already disconnected */
    }
    void s.ctx?.close().catch(() => {});
    // Only the tracks of the stream this recorder opened; a call's mic is never touched.
    for (const track of s.stream.getTracks()) track.stop();
  }

  function onStopped() {
    const s = session;
    if (!s) return;
    session = null;
    s.recorder.ondataavailable = null;
    s.recorder.onstop = null;
    s.recorder.onerror = null;
    release(s);
    if (!s.keep || s.finishMs < VOICE_NOTE_MIN_MS || s.chunks.length === 0) {
      set(EMPTY);
      return;
    }
    const blob = new Blob(s.chunks, { type: s.mime });
    set({
      state: "preview",
      elapsedMs: s.finishMs,
      liveLevels: [],
      result: { blob, mime: s.mime, meta: { ms: s.finishMs, wave: encodeWave(s.levels) } },
    });
  }

  function finish(keep: boolean, ms: number) {
    const s = session;
    if (!s) return;
    // A stop is already in flight (MediaRecorder finishes asynchronously): keep its outcome.
    if (s.stopping) {
      if (!keep) s.keep = false;
      return;
    }
    s.stopping = true;
    s.keep = keep;
    s.finishMs = ms;
    deps.clearInterval(s.timer);
    if (s.recorder.state !== "inactive") s.recorder.stop();
    else onStopped();
  }

  function tick() {
    const s = session;
    if (!s || snap.state !== "recording") return;
    const elapsed = Math.min(VOICE_NOTE_MAX_MS, deps.now() - s.startedAt);
    let level = 0;
    if (s.analyser) {
      s.analyser.getByteTimeDomainData(s.buf);
      let sum = 0;
      for (let i = 0; i < s.buf.length; i++) {
        const v = (s.buf[i] - 128) / 128;
        sum += v * v;
      }
      level = Math.min(1, Math.sqrt(sum / s.buf.length) * 3);
    }
    s.levels.push(level);
    set({ ...snap, elapsedMs: elapsed, liveLevels: s.levels.slice(-96) });
    if (elapsed >= VOICE_NOTE_MAX_MS) finish(true, VOICE_NOTE_MAX_MS);
  }

  async function start() {
    if (starting || snap.state === "recording") return;
    const MR = deps.MediaRecorder;
    const mime = MR ? MIME_PREFERENCE.find((m) => MR.isTypeSupported(m)) : undefined;
    if (!deps.getUserMedia || !MR || !mime) {
      set({ ...EMPTY, state: "error", error: "unsupported" });
      return;
    }
    starting = true;
    const myGeneration = ++generation;
    let stream: MediaStream;
    try {
      stream = await deps.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      if (myGeneration !== generation) return;
      starting = false;
      const name = (e as { name?: string } | null)?.name;
      const error: VoiceRecorderError =
        name === "NotFoundError" || name === "OverconstrainedError" || name === "NotReadableError"
          ? "no-device"
          : "permission";
      set({ ...EMPTY, state: "error", error });
      return;
    }
    if (myGeneration !== generation) {
      for (const t of stream.getTracks()) t.stop();
      return;
    }
    starting = false;
    let ctx: AudioContextLike | null = null;
    let source: SourceLike | null = null;
    let analyser: AnalyserLike | null = null;
    try {
      if (deps.AudioContext) {
        ctx = new deps.AudioContext();
        source = ctx.createMediaStreamSource(stream);
        analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);
        if (ctx.state === "suspended") void ctx.resume?.().catch(() => {});
      }
    } catch {
      analyser = null; // waveform is cosmetic; recording still works
      source = null;
      void ctx?.close().catch(() => {});
      ctx = null;
    }
    let recorder: RecorderLike;
    try {
      recorder = new MR(stream, { mimeType: mime, audioBitsPerSecond: 32000 });
    } catch {
      for (const t of stream.getTracks()) t.stop();
      void ctx?.close().catch(() => {});
      set({ ...EMPTY, state: "error", error: "unsupported" });
      return;
    }
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = onStopped;
    recorder.onerror = () => finish(false, 0);
    const s: Session = {
      stream,
      recorder,
      ctx,
      source,
      analyser,
      chunks,
      mime,
      buf: new Uint8Array(1024),
      startedAt: deps.now(),
      levels: [],
      timer: null,
      finishMs: 0,
      keep: false,
      stopping: false,
    };
    session = s;
    try {
      recorder.start();
    } catch {
      session = null;
      release(s);
      set({ ...EMPTY, state: "error", error: "unsupported" });
      return;
    }
    s.timer = deps.setInterval(tick, SAMPLE_MS);
    set({ state: "recording", elapsedMs: 0, liveLevels: [], result: null });
  }

  return {
    getSnapshot: () => snap,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    start,
    stop() {
      if (!session || session.stopping || snap.state !== "recording") return;
      const elapsed = Math.min(VOICE_NOTE_MAX_MS, deps.now() - session.startedAt);
      finish(elapsed >= VOICE_NOTE_MIN_MS, elapsed);
    },
    discard() {
      generation++; // cancels a start() still waiting on the permission prompt
      starting = false;
      if (session) finish(false, 0);
      else set(EMPTY);
    },
  };
}

function browserDeps(): VoiceRecorderDeps {
  const w = globalThis as unknown as {
    MediaRecorder?: VoiceRecorderDeps["MediaRecorder"];
    AudioContext?: VoiceRecorderDeps["AudioContext"];
    webkitAudioContext?: VoiceRecorderDeps["AudioContext"];
  };
  const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
  return {
    getUserMedia: md?.getUserMedia ? md.getUserMedia.bind(md) : undefined,
    MediaRecorder: w.MediaRecorder,
    AudioContext: w.AudioContext ?? w.webkitAudioContext,
    now: () => performance.now(),
    setInterval: (fn, ms) => window.setInterval(fn, ms),
    clearInterval: (id) => window.clearInterval(id as number),
  };
}

export function useVoiceRecorder(): VoiceRecorder {
  const controller = useMemo(() => createVoiceRecorderController(browserDeps()), []);
  const snap = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => () => controller.discard(), [controller]);
  return { ...snap, start: controller.start, stop: controller.stop, discard: controller.discard };
}
