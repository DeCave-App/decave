const DEFAULT_RETRY_DELAYS_MS = [1_000, 5_000, 15_000, 60_000, 300_000] as const;

export type PushRevocationRetryLifecycle = {
  start: () => void;
  retryNow: () => void;
  setActive: (active: boolean) => void;
  stop: () => void;
};

type RetryOptions = {
  /** Drains persisted actions using their retained credentials, independent of the current account. */
  drain: () => Promise<boolean>;
  active?: boolean;
  delaysMs?: readonly number[];
  schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
};

/**
 * Retries a persisted push-revocation queue until it is empty. Foreground and
 * enqueue triggers can request an immediate pass while a current pass is in flight.
 */
export function createPushRevocationRetryLifecycle({
  drain,
  delaysMs = DEFAULT_RETRY_DELAYS_MS,
  schedule = setTimeout,
  cancel = clearTimeout,
  active = true,
}: RetryOptions): PushRevocationRetryLifecycle {
  const retryDelays = delaysMs.length ? delaysMs : DEFAULT_RETRY_DELAYS_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let retryIndex = 0;
  let inFlight = false;
  let retryPending = false;
  let isActive = active;
  let started = false;
  let stopped = false;

  const cancelScheduledRetry = () => {
    if (timer === null) return;
    cancel(timer);
    timer = null;
  };

  const scheduleRetry = () => {
    if (stopped || !isActive || !retryPending || timer !== null) return;
    const delay = retryDelays[Math.min(retryIndex, retryDelays.length - 1)];
    retryIndex += 1;
    timer = schedule(() => {
      timer = null;
      if (isActive) void attempt();
    }, delay);
  };

  const attempt = async (): Promise<void> => {
    if (stopped) return;
    if (inFlight) {
      retryPending = true;
      return;
    }

    cancelScheduledRetry();
    retryPending = false;
    inFlight = true;
    let drained = false;
    try {
      drained = await drain();
    } catch {
      // The existing queue remains durable; retry it after backoff or foreground.
    } finally {
      inFlight = false;
    }

    if (stopped) return;
    if (drained) {
      retryIndex = 0;
      if (retryPending && isActive) void attempt();
      return;
    }

    if (retryPending && isActive) {
      void attempt();
      return;
    }
    retryPending = true;
    scheduleRetry();
  };

  const retryNow = () => {
    if (stopped) return;
    retryPending = true;
    cancelScheduledRetry();
    if (inFlight || !started || !isActive) return;
    void attempt();
  };

  return {
    start() {
      if (started || stopped) return;
      started = true;
      // Always inspect the durable queue once at startup, even if the app is
      // not yet active. Any follow-up retries wait for foreground activity.
      retryPending = true;
      void attempt();
    },
    retryNow,
    setActive(active) {
      if (stopped || isActive === active) return;
      isActive = active;
      if (!isActive) {
        cancelScheduledRetry();
        return;
      }
      if (retryPending) retryNow();
    },
    stop() {
      stopped = true;
      retryPending = false;
      cancelScheduledRetry();
    },
  };
}
