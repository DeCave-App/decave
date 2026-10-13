// Instant save for one setting: optimistic value, debounced write, undo of the
// last change, and revert + retry when the save fails. Pure (no React) so the
// behaviour is unit tested; useSettingField wraps it for components.

export type FieldStatus = "idle" | "saving" | "saved" | "error";

export type FieldSource = "set" | "undo" | "retry";

export type FieldControllerOptions<T> = {
  /** The value currently in effect (app state). */
  read(): T;
  /** Persists a value; rejects when it couldn't be saved. */
  write(next: T): Promise<void>;
  /** Shows a value in the app right away (preview), before it is saved. */
  apply?(next: T): void;
  /** Wait this long after the last change before writing (sliders). */
  debounceMs?: number;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => unknown;
  /** Called after each write settles. */
  onSettled?(result: "saved" | "error", source: FieldSource): void;
};

export type FieldController<T> = {
  readonly value: T;
  readonly status: FieldStatus;
  /** A change is waiting for its debounce or being written. */
  readonly busy: boolean;
  readonly canUndo: boolean;
  set(next: T): void;
  undo(): Promise<void>;
  retry(): Promise<void>;
  subscribe(fn: () => void): () => void;
};

export function createFieldController<T>(opts: FieldControllerOptions<T>): FieldController<T> {
  const schedule = opts.schedule ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const listeners = new Set<() => void>();
  let value = opts.read();
  let saved = value;
  let status: FieldStatus = "idle";
  let busy = false;
  let undoTo: { value: T } | null = null;
  let failed: { value: T; source: FieldSource } | null = null;
  // Every change bumps the generation; replies and timers from older ones are ignored.
  let generation = 0;

  const notify = () => listeners.forEach((fn) => fn());

  const show = (next: T) => {
    value = next;
    opts.apply?.(next);
  };

  const send = async (next: T, source: FieldSource, mine: number): Promise<void> => {
    try {
      await opts.write(next);
      if (mine !== generation) return;
      saved = next;
      failed = null;
      busy = false;
      status = "saved";
      notify();
      opts.onSettled?.("saved", source);
    } catch {
      if (mine !== generation) return;
      failed = { value: next, source };
      busy = false;
      status = "error";
      show(saved);
      notify();
      opts.onSettled?.("error", source);
    }
  };

  const start = (next: T, source: FieldSource, debounceMs: number): Promise<void> => {
    const mine = ++generation;
    show(next);
    busy = true;
    status = "saving";
    notify();
    if (debounceMs > 0) {
      return new Promise((resolve) => {
        schedule(() => {
          if (mine !== generation) return resolve();
          void send(next, source, mine).then(resolve);
        }, debounceMs);
      });
    }
    return send(next, source, mine);
  };

  return {
    get value() {
      return value;
    },
    get status() {
      return status;
    },
    get busy() {
      return busy;
    },
    get canUndo() {
      return undoTo !== null;
    },
    set(next) {
      if (!busy && status !== "error") {
        // Pick up changes made elsewhere (another device, another control) since the last save.
        value = opts.read();
        saved = value;
      }
      undoTo = { value };
      void start(next, "set", opts.debounceMs ?? 0);
    },
    undo() {
      if (!undoTo) return Promise.resolve();
      const target = undoTo.value;
      undoTo = null;
      return start(target, "undo", 0);
    },
    retry() {
      if (!failed) return Promise.resolve();
      return start(failed.value, failed.source, 0);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
