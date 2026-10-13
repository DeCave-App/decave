// The Settings window itself: the open tab and the search box. Every change
// saves at once, so there is no unsaved state to track.

import { useCallback, useRef, useState, type SetStateAction } from "react";
import type { SettingsTab } from "../types";
import { normalizeSettingsTab } from "../../features/settings/settingsMap";

export function useSettingsWindowState() {
  const [settingsSearch, setSettingsSearch] = useState("");
  const [settingsTab, setSettingsTabState] = useState<SettingsTab>("profile");
  /** True when something asked for a specific tab since Settings last opened. */
  const settingsTabRequestedRef = useRef(false);

  /** Accepts old tab ids too (saved workspace history, older entry points). */
  const setSettingsTab = useCallback((next: SetStateAction<SettingsTab> | string) => {
    settingsTabRequestedRef.current = true;
    setSettingsTabState((current) => normalizeSettingsTab(typeof next === "function" ? next(current) : next));
  }, []);

  return {
    settingsSearch,
    setSettingsSearch,
    settingsTab,
    setSettingsTab,
    settingsTabRequestedRef,
  };
}

export type SettingsWindowState = ReturnType<typeof useSettingsWindowState>;
