// Single-playback queue, played-threshold tracking and speed cycling for voice notes.

export const VOICE_SPEED_KEY = "decave.voiceNote.speed";
const SPEEDS = [1, 1.5, 2] as const;

export type PlaybackHandlers = {
  onTime: (seconds: number) => void;
  onPlaying: () => void;
  onPaused: () => void;
  onEnded: () => void;
  /** The element rejected play() or failed to decode. */
  onError: () => void;
};

/** The one element the queue drives; HTMLAudioElement satisfies it. */
export type SharedAudio = {
  src: string;
  currentTime: number;
  playbackRate: number;
  paused: boolean;
  play(): Promise<void> | void;
  pause(): void;
  removeAttribute?(name: string): void;
  addEventListener(type: string, fn: () => void): void;
};

/** A tiny silent WAV: playing it inside the user's tap unlocks the element on iOS/Safari. */
export const SILENT_CLIP = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";

const isAbort = (error: unknown) => (error as { name?: unknown } | null)?.name === "AbortError";

/**
 * One shared audio element for every voice note. Reusing the element that the first user
 * gesture unlocked lets iOS/Safari auto-advance to the next note without another tap.
 */
export function createPlaybackQueue(createEl: () => SharedAudio = () => new Audio()) {
  let el: SharedAudio | null = null;
  let currentId: string | null = null;
  let currentSrc: string | null = null;
  let handlers: PlaybackHandlers | null = null;
  let primed = false;
  const subscribers = new Map<string, () => void>();

  function element(): SharedAudio {
    if (el) return el;
    const created = createEl();
    el = created;
    created.addEventListener("timeupdate", () => handlers?.onTime(created.currentTime));
    created.addEventListener("play", () => handlers?.onPlaying());
    created.addEventListener("pause", () => handlers?.onPaused());
    created.addEventListener("error", () => reset(true));
    created.addEventListener("ended", () => handlers?.onEnded());
    return created;
  }

  function reset(notify: boolean) {
    const h = handlers;
    currentId = null;
    currentSrc = null;
    handlers = null;
    if (notify) h?.onError();
  }

  /**
   * Call synchronously at the top of a tap handler, before any await: creates the
   * shared element and unlocks it (play then pause of a silent clip) while the
   * gesture still counts, so iOS lets the real play() that follows a fetch through.
   */
  function prime() {
    if (primed) return;
    const audio = element();
    primed = true;
    if (currentId) return; // already playing something: it is unlocked
    try {
      audio.src = SILENT_CLIP;
      const result = audio.play();
      audio.pause();
      if (result && typeof result.catch === "function") {
        result.catch((error: unknown) => {
          if (!isAbort(error)) primed = false; // refused: try again on the next tap
        });
      }
    } catch {
      primed = false;
    }
  }

  /** Starts (or resumes) note `id`. Resolves false when the platform refused to play. */
  async function play(id: string, src: string, startAt: number, rate: number, h: PlaybackHandlers): Promise<boolean> {
    const audio = element();
    if (currentId && currentId !== id) {
      const prev = handlers;
      audio.pause();
      prev?.onPaused();
    }
    handlers = h;
    if (currentId !== id || currentSrc !== src) {
      audio.src = src;
      audio.currentTime = startAt;
    }
    currentId = id;
    currentSrc = src;
    audio.playbackRate = rate;
    try {
      await audio.play();
      return true;
    } catch (error) {
      // AbortError: a quick pause (or another note) interrupted the start; not a failure.
      if (isAbort(error)) return false;
      if (currentId === id) reset(true);
      return false;
    }
  }

  function pause(id: string) {
    if (currentId === id) el?.pause();
  }

  function seek(id: string, seconds: number) {
    if (currentId === id && el) el.currentTime = seconds;
  }

  function setRate(id: string, rate: number) {
    if (currentId === id && el) el.playbackRate = rate;
  }

  /** The bubble is going away: stop its audio if it is the one playing. */
  function release(id: string) {
    if (currentId !== id) return;
    el?.pause();
    reset(false);
  }

  /** Bubbles register so the queue can ask them to start when it is their turn. */
  function subscribe(id: string, start: () => void) {
    subscribers.set(id, start);
    return () => {
      if (subscribers.get(id) === start) subscribers.delete(id);
    };
  }

  function onEnded(id: string, nextUnplayed: () => string | null) {
    if (currentId === id) reset(false);
    const next = nextUnplayed();
    if (next && next !== id) subscribers.get(next)?.();
  }

  return { prime, play, pause, seek, setRate, release, subscribe, onEnded, current: () => currentId };
}

export const voicePlayback = createPlaybackQueue();

/**
 * Calls onPlayed once: after more than half of the note was actually listened to
 * (continuous position updates, so seeking past 50% does not count), or on end.
 */
export function createPlayedTracker(onPlayed: () => void) {
  let fired = false;
  let last: number | null = null;
  let listened = 0;
  const fire = () => {
    if (fired) return;
    fired = true;
    onPlayed();
  };
  return {
    update(position: number, duration: number) {
      if (last !== null) {
        const delta = position - last;
        if (delta > 0 && delta <= 1.5) listened += delta;
      }
      last = position;
      if (duration > 0 && listened / duration > 0.5) fire();
    },
    /** Playback paused or the position jumped: do not count the gap. */
    break() {
      last = null;
    },
    end: fire,
  };
}

export function nextSpeed(current: number): number {
  const i = SPEEDS.findIndex((s) => s === current);
  return SPEEDS[(i + 1) % SPEEDS.length];
}

export function readSpeed(): number {
  try {
    const v = Number(localStorage.getItem(VOICE_SPEED_KEY));
    return SPEEDS.some((s) => s === v) ? v : 1;
  } catch {
    return 1;
  }
}

export function writeSpeed(speed: number) {
  try {
    localStorage.setItem(VOICE_SPEED_KEY, String(speed));
  } catch {
    /* storage unavailable */
  }
}
