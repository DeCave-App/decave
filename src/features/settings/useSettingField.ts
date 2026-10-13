// One hook for every Settings control: shows the change at once, saves it
// (sliders after a short pause), offers Undo in a toast, and puts the old
// value back with "Couldn't save · Retry" when saving fails.

import { useEffect, useReducer, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { createFieldController, type FieldController, type FieldStatus } from "./fieldController";
import { useSettingsToast } from "./SettingsToast";
import { useSettingsPersist, type SettingsPart } from "./persist";

export type SettingFieldOptions<T> = {
  /** Slider-style controls: wait this long after the last change before saving. */
  debounceMs?: number;
  /** Shows the value in the app immediately (before it is saved). */
  apply?: (next: T) => void;
  /** No "Saved" toast (for controls that save as you type, or have their own feedback). */
  quiet?: boolean;
};

export type SettingField<T> = {
  value: T;
  set(next: T): void;
  status: FieldStatus;
  retry(): void;
};

export const SLIDER_DEBOUNCE_MS = 400;

export function useSettingField<T>(
  key: string,
  read: () => T,
  write: (next: T) => Promise<void>,
  opts: SettingFieldOptions<T> = {},
): SettingField<T> {
  const toast = useSettingsToast();
  const latest = useRef({ read, write, opts, toast });
  latest.current = { read, write, opts, toast };
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  const [state] = useState(() => {
    const holder: { key: string; controller: FieldController<T> | null } = { key, controller: null };
    return holder;
  });
  if (!state.controller || state.key !== key) {
    state.key = key;
    const controller: FieldController<T> = createFieldController<T>({
      read: () => latest.current.read(),
      write: (next) => latest.current.write(next),
      apply: (next) => latest.current.opts.apply?.(next),
      debounceMs: opts.debounceMs,
      onSettled(result, source) {
        const { toast: api, opts: current } = latest.current;
        if (result !== "saved" || current.quiet) return;
        if (source === "undo") api.show("settings.toast.undone");
        else api.show("settings.toast.saved", () => void controller.undo());
      },
    });
    state.controller = controller;
  }
  const controller = state.controller;

  useEffect(() => controller.subscribe(rerender), [controller]);

  return {
    value: controller.busy ? controller.value : read(),
    set: (next) => controller.set(next),
    status: controller.status,
    retry: () => void controller.retry(),
  };
}

/**
 * The usual case: a value held in app state. Changing it updates the state at
 * once (apply) and then saves the named parts (profile, account, device, desktop).
 */
export function useStateField<T>(
  key: string,
  value: T,
  apply: (next: T) => void,
  parts: readonly SettingsPart[],
  opts: Omit<SettingFieldOptions<T>, "apply"> = {},
): SettingField<T> {
  const persist = useSettingsPersist();
  return useSettingField(
    key,
    () => value,
    () => persist(parts),
    { ...opts, apply },
  );
}

/**
 * A text box bound to a setting: typing edits a draft, blur or Enter saves it
 * (Shift+Enter adds a line in a text area). Escape puts the saved text back.
 */
export function useTextDraft(field: SettingField<string>) {
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? field.value;
  const commit = () => {
    if (draft === null) return;
    if (draft !== field.value) field.set(draft);
    setDraft(null);
  };
  return {
    value,
    field,
    inputProps: {
      value,
      onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(event.target.value),
      onBlur: commit,
      onKeyDown: (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        if (event.key === "Escape" && draft !== null) {
          event.stopPropagation();
          setDraft(null);
          return;
        }
        if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
        event.preventDefault();
        commit();
      },
    },
  };
}

export type TextDraft = ReturnType<typeof useTextDraft>;

/** A promise that resolves after React has committed the next render. */
export function useNextCommit(): () => Promise<void> {
  const waiting = useRef<(() => void)[]>([]);
  const mounted = useRef(true);
  const [, bump] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    const ready = waiting.current.splice(0);
    ready.forEach((resolve) => resolve());
  });
  // Settings closed with a save still waiting (a slider's pause): save with the last committed values.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      waiting.current.splice(0).forEach((resolve) => resolve());
    };
  }, []);
  return () =>
    new Promise<void>((resolve) => {
      if (!mounted.current) return resolve();
      waiting.current.push(resolve);
      bump();
    });
}
