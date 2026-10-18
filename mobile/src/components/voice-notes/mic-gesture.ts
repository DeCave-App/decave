// The composer mic button: a quick tap starts tap mode (recording bar with stop),
// pressing and holding records until release, which sends. Sliding left more than
// 80 px while holding cancels. Pure so the thresholds can be tested.

export const HOLD_CANCEL_DISTANCE_PX = 80;
export const HOLD_DELAY_MS = 250;

export type MicGestureDeps = {
  onTap: () => void;
  onHoldStart: () => void;
  onHoldRelease: () => void;
  onHoldCancel: () => void;
  /** Called once the finger has slid far enough left to cancel. */
  onCancelArmed?: (armed: boolean) => void;
  /** Horizontal travel while holding (negative = left), for the slide hint. */
  onSlide?: (dx: number) => void;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
};

export function holdShouldCancel(dx: number): boolean {
  return dx < -HOLD_CANCEL_DISTANCE_PX;
}

export function createMicGesture(deps: MicGestureDeps) {
  let phase: "idle" | "pressing" | "holding" | "done" = "idle";
  let startX = 0;
  let timer: unknown = null;

  const clear = () => {
    if (timer !== null) deps.clearTimeout(timer);
    timer = null;
  };

  return {
    press(x: number) {
      clear();
      phase = "pressing";
      startX = x;
      timer = deps.setTimeout(() => {
        timer = null;
        if (phase !== "pressing") return;
        phase = "holding";
        deps.onHoldStart();
      }, HOLD_DELAY_MS);
    },
    move(x: number) {
      if (phase !== "holding") return;
      const dx = x - startX;
      deps.onSlide?.(dx);
      if (holdShouldCancel(dx)) {
        phase = "done";
        deps.onCancelArmed?.(true);
        deps.onHoldCancel();
      }
    },
    release() {
      clear();
      const was = phase;
      phase = "idle";
      if (was === "pressing") deps.onTap();
      else if (was === "holding") deps.onHoldRelease();
    },
    /** The system took the touch (scroll, alert): never send by accident. */
    terminate() {
      clear();
      const was = phase;
      phase = "idle";
      if (was === "holding") deps.onHoldCancel();
    },
  };
}
