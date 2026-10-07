import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => !element.hidden && element.offsetParent !== null,
  );
}

/**
 * Modal dialog behavior: traps Tab focus inside the dialog, closes on Escape,
 * and restores focus to the previously focused element when it unmounts.
 */
export function useDialogA11y<T extends HTMLElement>(onEscape: (() => void) | null, active = true): RefObject<T> {
  const ref = useRef<T>(null);
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;

  useEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (!root) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!root.contains(document.activeElement)) {
      const autofocus = root.querySelector<HTMLElement>("[autofocus], [data-autofocus]");
      (autofocus ?? focusableWithin(root)[0] ?? root).focus({ preventScroll: true });
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (!ref.current) return;
      if (event.key === "Escape" && escapeRef.current) {
        // Only the innermost open dialog handles Escape.
        const dialogs = document.querySelectorAll("[data-dc-dialog='open']");
        if (dialogs.length && dialogs[dialogs.length - 1] !== ref.current) return;
        event.preventDefault();
        event.stopPropagation();
        escapeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const dialogs = document.querySelectorAll("[data-dc-dialog='open']");
      if (dialogs.length && dialogs[dialogs.length - 1] !== ref.current) return;
      const items = focusableWithin(ref.current);
      if (!items.length) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !ref.current.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !ref.current.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true });
    };
  }, [active]);

  return ref;
}
