// Desktop: watches for streaming/recording apps so Streamer mode can turn on automatically.

import { type Dispatch, type SetStateAction, useEffect } from "react";
import type { AccountUser } from "../types";
import type { PreferencesState } from "../state/preferences";

export type CaptureAppsWatchDeps = {
  currentUser: AccountUser | null;
  setCaptureApps: Dispatch<SetStateAction<string[]>>;
  preferences: PreferencesState;
};

export function useCaptureAppsWatch(deps: CaptureAppsWatchDeps): void {
  const { currentUser, setCaptureApps, preferences } = deps;
  const { privacySettings } = preferences;

  // Auto Streamer mode: ask the desktop app every 20 s which streaming apps
  // are running. Desktop builds without getCaptureApps simply never match.
  useEffect(() => {
    const bridge = typeof window === "undefined" ? undefined : window.decaveDesktop;
    if (!currentUser || !privacySettings.autoStreamerMode || typeof bridge?.getCaptureApps !== "function") {
      setCaptureApps((current) => (current.length ? [] : current));
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const result = await bridge.getCaptureApps!();
        if (cancelled) return;
        const next =
          result?.supported && Array.isArray(result.apps)
            ? result.apps.filter((app) => typeof app === "string").slice(0, 8)
            : [];
        setCaptureApps((current) => (current.join("|") === next.join("|") ? current : next));
      } catch {
        /* The next poll tries again. */
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 20_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [currentUser?.id, privacySettings.autoStreamerMode]);
}
