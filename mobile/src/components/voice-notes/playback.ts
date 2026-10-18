// Single-playback queue, played-threshold tracking and speed cycling for voice
// notes on the phone. The native player (expo-audio) is injected; see
// expo-player.ts. Pure so tests can drive it.

export const VOICE_SPEEDS = [1, 1.5, 2] as const;

export type PlaybackHandlers = {
  onTime: (seconds: number) => void;
  onPlaying: () => void;
  onPaused: () => void;
  onEnded: () => void;
  /** The player could not load or play the file. */
  onError: () => void;
};

export type PlayerStatus = {
  currentTime: number;
  playing: boolean;
  didJustFinish: boolean;
  /** The loaded file is ready to seek. */
  loaded?: boolean;
  error?: boolean;
};

/** The one native player every voice note shares. */
export type SharedPlayer = {
  load(uri: string): void;
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  setRate(rate: number): void;
  onStatus(listener: (status: PlayerStatus) => void): void;
};

export function createPlaybackQueue(
  createPlayer: () => SharedPlayer,
  subscribeAppState?: (listener: (state: string) => void) => () => void,
) {
  let player: SharedPlayer | null = null;
  let currentId: string | null = null;
  let currentUri: string | null = null;
  let handlers: PlaybackHandlers | null = null;
  let wasPlaying = false;
  /** A seek asked for before the new file finished loading; applied once it has. */
  let pendingSeek: number | null = null;
  let loaded = false;
  const subscribers = new Map<string, () => void>();

  function shared(): SharedPlayer {
    if (player) return player;
    const created = createPlayer();
    player = created;
    created.onStatus((status) => {
      if (status.loaded && !loaded) {
        loaded = true;
        if (pendingSeek !== null) {
          created.seek(pendingSeek);
          pendingSeek = null;
        }
      }
      const h = handlers;
      if (!h) return;
      if (status.error) {
        reset();
        h.onError();
        return;
      }
      h.onTime(status.currentTime);
      if (status.didJustFinish) {
        wasPlaying = false;
        h.onEnded();
        return;
      }
      if (status.playing !== wasPlaying) {
        wasPlaying = status.playing;
        if (status.playing) h.onPlaying();
        else h.onPaused();
      }
    });
    return created;
  }

  function reset() {
    currentId = null;
    currentUri = null;
    handlers = null;
    wasPlaying = false;
  }

  /** Starts (or resumes) note `id`. Resolves false when the player refused. */
  async function play(id: string, uri: string, startAt: number, rate: number, h: PlaybackHandlers): Promise<boolean> {
    const p = shared();
    if (currentId && currentId !== id) {
      const previous = handlers;
      p.pause();
      wasPlaying = false;
      previous?.onPaused();
    }
    handlers = h;
    try {
      if (currentId !== id || currentUri !== uri) {
        loaded = false;
        pendingSeek = startAt > 0 ? startAt : null;
        p.load(uri);
      }
      currentId = id;
      currentUri = uri;
      p.setRate(rate);
      p.play();
      return true;
    } catch {
      reset();
      h.onError();
      return false;
    }
  }

  const unsubscribeAppState = subscribeAppState?.((state) => {
    if (state === "background" && currentId) player?.pause();
  });

  return {
    play,
    /** Stop listening for the app going to the background (tests, hot reload). */
    dispose() {
      unsubscribeAppState?.();
    },
    pause(id: string) {
      if (currentId === id) player?.pause();
    },
    seek(id: string, seconds: number) {
      if (currentId !== id) return;
      if (loaded) player?.seek(seconds);
      else pendingSeek = seconds;
    },
    setRate(id: string, rate: number) {
      if (currentId === id) player?.setRate(rate);
    },
    /** The bubble is going away: stop its audio if it is the one playing. */
    release(id: string) {
      if (currentId !== id) return;
      player?.pause();
      reset();
    },
    subscribe(id: string, start: () => void) {
      subscribers.set(id, start);
      return () => {
        if (subscribers.get(id) === start) subscribers.delete(id);
      };
    },
    /** A note ended: start the next unplayed note in the same conversation, if any. */
    onEnded(id: string, nextUnplayed: () => string | null) {
      if (currentId === id) reset();
      const next = nextUnplayed();
      if (next && next !== id) subscribers.get(next)?.();
    },
    current: () => currentId,
  };
}

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
  const i = VOICE_SPEEDS.findIndex((s) => s === current);
  return VOICE_SPEEDS[(i + 1) % VOICE_SPEEDS.length];
}

export function isVoiceSpeed(value: unknown): value is number {
  return VOICE_SPEEDS.some((s) => s === value);
}

/** Bubbles in render order register here so the queue can find the next unplayed note. */
export function createConversationOrder() {
  const rows = new Map<string, Map<string, { order: number; unplayed: boolean }>>();
  return {
    set(conversationId: string, messageId: string, order: number, unplayed: boolean) {
      let conv = rows.get(conversationId);
      if (!conv) rows.set(conversationId, (conv = new Map()));
      conv.set(messageId, { order, unplayed });
    },
    remove(conversationId: string, messageId: string) {
      rows.get(conversationId)?.delete(messageId);
    },
    nextUnplayed(conversationId: string, messageId: string): string | null {
      const conv = rows.get(conversationId);
      const self = conv?.get(messageId);
      if (!conv || !self) return null;
      let best: { id: string; order: number } | null = null;
      for (const [id, row] of conv) {
        if (!row.unplayed || row.order <= self.order) continue;
        if (!best || row.order < best.order) best = { id, order: row.order };
      }
      return best?.id ?? null;
    },
  };
}
