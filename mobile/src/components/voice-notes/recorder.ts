// Pure voice-note recorder core for the mobile app. expo-audio, the clock and
// file deletion are injected (see useVoiceRecorder.ts) so tests can drive it.

import { VOICE_NOTE_MAX_MS, VOICE_NOTE_MIN_MS, encodeWave, type VoiceNoteMeta } from "../../lib/voice-note.ts";

/** A finished recording: an AAC .m4a file on this phone. */
export type VoiceNoteDraft = { uri: string; mime: string; meta: VoiceNoteMeta };
export type VoiceRecorderState = "idle" | "recording" | "preview" | "error";
export type VoiceRecorderError = "permission" | "unsupported";

export type VoiceRecorderSnapshot = {
  state: VoiceRecorderState;
  error?: VoiceRecorderError;
  elapsedMs: number;
  liveLevels: number[];
  result: VoiceNoteDraft | null;
};

export type VoiceRecorderDeps = {
  /** Asks for the microphone; false when refused. */
  requestPermission: () => Promise<boolean>;
  /** Sets the audio mode, prepares and starts the native recorder. */
  begin: () => Promise<void>;
  /** Stops the native recorder and restores the audio mode; resolves the file uri. */
  end: () => Promise<string | null>;
  deleteFile: (uri: string) => void;
  /** Current input level 0..1. */
  level: () => number;
  now: () => number;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (id: unknown) => void;
  /** App state changes ("active" | "background" | ...); the app going to the background stops recording. */
  subscribeAppState?: (listener: (state: string) => void) => () => void;
};

export type VoiceRecordMode = "tap" | "hold";

export const VOICE_NOTE_MIME = "audio/mp4";
const SAMPLE_MS = 50;
const EMPTY: VoiceRecorderSnapshot = { state: "idle", elapsedMs: 0, liveLevels: [], result: null };

/** expo-audio metering is in dBFS (about -160..0); -60 dB and below counts as silence. */
export function meteringToLevel(db: number | undefined): number {
  if (typeof db !== "number" || !Number.isFinite(db)) return 0;
  return Math.min(1, Math.max(0, (db + 60) / 60));
}

export function createVoiceRecorderController(deps: VoiceRecorderDeps) {
  let snap: VoiceRecorderSnapshot = EMPTY;
  const listeners = new Set<() => void>();
  let generation = 0;
  let active: { startedAt: number; levels: number[]; timer: unknown; mode: VoiceRecordMode } | null = null;
  let stopping: Promise<VoiceNoteDraft | null> | null = null;

  const set = (next: VoiceRecorderSnapshot) => {
    snap = next;
    for (const listener of listeners) listener();
  };

  const endAndDelete = () => {
    void deps.end().then(
      (uri) => {
        if (uri) deps.deleteFile(uri);
      },
      () => undefined,
    );
  };

  function finish(keep: boolean, ms: number): Promise<VoiceNoteDraft | null> {
    const session = active;
    if (!session) return stopping ?? Promise.resolve(snap.result);
    active = null;
    deps.clearInterval(session.timer);
    stopping = deps
      .end()
      .catch(() => null)
      .then((uri) => {
        stopping = null;
        if (!keep || ms < VOICE_NOTE_MIN_MS || !uri) {
          if (uri) deps.deleteFile(uri);
          set(EMPTY);
          return null;
        }
        const draft: VoiceNoteDraft = { uri, mime: VOICE_NOTE_MIME, meta: { ms, wave: encodeWave(session.levels) } };
        set({ state: "preview", elapsedMs: ms, liveLevels: [], result: draft });
        return draft;
      });
    return stopping;
  }

  function tick() {
    const session = active;
    if (!session) return;
    const elapsed = Math.min(VOICE_NOTE_MAX_MS, deps.now() - session.startedAt);
    session.levels.push(deps.level());
    set({ ...snap, elapsedMs: elapsed, liveLevels: session.levels.slice(-96) });
    if (elapsed >= VOICE_NOTE_MAX_MS) void finish(true, VOICE_NOTE_MAX_MS);
  }

  async function start(mode: VoiceRecordMode = "tap"): Promise<void> {
    if (active || stopping || snap.state === "recording") return;
    const mine = ++generation;
    let allowed = false;
    try {
      allowed = await deps.requestPermission();
    } catch {
      allowed = false;
    }
    if (mine !== generation) return;
    if (!allowed) {
      set({ ...EMPTY, state: "error", error: "permission" });
      return;
    }
    try {
      await deps.begin();
    } catch {
      if (mine === generation) set({ ...EMPTY, state: "error", error: "unsupported" });
      endAndDelete();
      return;
    }
    if (mine !== generation) {
      endAndDelete(); // discarded while the recorder was starting
      return;
    }
    active = { startedAt: deps.now(), levels: [], timer: null, mode };
    active.timer = deps.setInterval(tick, SAMPLE_MS);
    set({ state: "recording", elapsedMs: 0, liveLevels: [], result: null });
  }

  async function discard(): Promise<void> {
    generation++;
    if (active) {
      await finish(false, 0);
      return;
    }
    if (stopping) await stopping.catch(() => null);
    const uri = snap.result?.uri;
    if (uri) deps.deleteFile(uri);
    set(EMPTY);
  }

  function stop(): Promise<VoiceNoteDraft | null> {
    if (!active) return stopping ?? Promise.resolve(snap.result);
    const elapsed = Math.min(VOICE_NOTE_MAX_MS, deps.now() - active.startedAt);
    return finish(elapsed >= VOICE_NOTE_MIN_MS, elapsed);
  }

  /**
   * The finger left the mic in hold mode: resolves the draft to send (also when the
   * note already stopped itself at 2:00), or null after discarding a start still pending.
   */
  function releaseHold(): Promise<VoiceNoteDraft | null> {
    if (active) return stop();
    if (stopping) return stopping;
    if (snap.state === "preview" && snap.result) return Promise.resolve(snap.result);
    return discard().then(() => null);
  }

  /** The app went to the background: a tap recording stops into its preview, a hold is thrown away. */
  function background() {
    if (active) {
      if (active.mode === "hold") void discard();
      else void stop();
      return;
    }
    if (!stopping && snap.state === "idle") generation++; // cancel a start waiting on permission
  }

  const unsubscribeAppState = deps.subscribeAppState?.((state) => {
    if (state === "background") background();
  });

  return {
    getSnapshot: () => snap,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    start,
    /** Stops; resolves the draft (also shown as the preview) or null when too short. */
    stop,
    releaseHold,
    background,
    /** The controller is going away: stop listening for the app going to the background. */
    dispose() {
      unsubscribeAppState?.();
    },
    /** Throws the recording (or the preview) away and deletes its file. */
    discard,
  };
}
