// Global keyboard shortcuts: Ctrl/Cmd+K opens the command palette and
// Ctrl/Cmd+Shift+I opens the inbox.

import { type Dispatch, type SetStateAction, useEffect } from "react";

export type GlobalShortcutsDeps = {
  setShowCommandPalette: Dispatch<SetStateAction<boolean>>;
  setCommandPaletteQuery: Dispatch<SetStateAction<string>>;
  setCommandPaletteIndex: Dispatch<SetStateAction<number>>;
  setShowInbox: Dispatch<SetStateAction<boolean>>;
};

export function useGlobalShortcuts(deps: GlobalShortcutsDeps): void {
  const { setShowCommandPalette, setCommandPaletteQuery, setCommandPaletteIndex, setShowInbox } = deps;

  useEffect(() => {
    const onGlobalShortcut = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandPaletteQuery("");
        setShowCommandPalette(true);
        setCommandPaletteIndex(0);
        setShowInbox(false);
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "i") {
        event.preventDefault();
        setShowInbox(true);
        setShowCommandPalette(false);
      }
    };
    window.addEventListener("keydown", onGlobalShortcut, true);
    return () => window.removeEventListener("keydown", onGlobalShortcut, true);
  }, []);
}
