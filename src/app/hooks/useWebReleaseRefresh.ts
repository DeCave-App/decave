// Web only: when someone returns to a tab or Home Screen web app that has been
// in the background, load the newest release if one went live meanwhile.
// The desktop app has its own updater, so it is left alone.

import { useEffect, useRef } from "react";
import { hasDesktopActivityBridge } from "../desktop";
import { entryScriptFromHtml, runningEntryScript, shouldReloadForRelease } from "../web-release";

export function useWebReleaseRefresh(busy: boolean) {
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    if (hasDesktopActivityBridge()) return;
    const running = runningEntryScript(document);
    if (!running) return; // dev server
    let hiddenAt = document.visibilityState === "hidden" ? Date.now() : 0;
    let checking = false;
    const onVisibility = async () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      const hiddenForMs = hiddenAt ? Date.now() - hiddenAt : 0;
      hiddenAt = 0;
      if (checking || hiddenForMs <= 0) return;
      checking = true;
      try {
        const response = await fetch("/", { cache: "no-store", credentials: "same-origin" });
        const latest = response.ok ? entryScriptFromHtml(await response.text()) : null;
        if (shouldReloadForRelease({ running, latest, hiddenForMs, busy: busyRef.current })) window.location.reload();
      } catch {
        // Offline or the server is busy: try again next time.
      } finally {
        checking = false;
      }
    };
    const listener = () => void onVisibility();
    document.addEventListener("visibilitychange", listener);
    return () => document.removeEventListener("visibilitychange", listener);
  }, []);
}
