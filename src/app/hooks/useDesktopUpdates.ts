// Desktop app updates: the updater's status, checking for an update, restarting
// to install it, and the status text shown in Settings.

import { useEffect, useState } from "react";
import type { DesktopUpdateState } from "../types";
import {
  checkDesktopForUpdates,
  getDesktopUpdateStatus,
  hasDesktopActivityBridge,
  restartDesktopToUpdate,
} from "../desktop";

export function useDesktopUpdates() {
  const [desktopUpdateState, setDesktopUpdateState] = useState<DesktopUpdateState | null>(null);
  const [desktopUpdateAction, setDesktopUpdateAction] = useState<"checking" | "restarting" | null>(null);
  const [desktopUpdateNotice, setDesktopUpdateNotice] = useState("");

  useEffect(() => {
    if (!hasDesktopActivityBridge()) return;
    let active = true;
    void getDesktopUpdateStatus()
      .then((state) => {
        if (active) setDesktopUpdateState(state);
      })
      .catch((error) => {
        if (!active) return;
        setDesktopUpdateNotice(error instanceof Error ? error.message : "Could not read the desktop update status.");
      });
    const unsubscribe = window.decaveDesktop?.onUpdateStatus?.((state) => {
      if (active) setDesktopUpdateState(state);
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  const handleCheckDesktopForUpdates = async () => {
    if (!hasDesktopActivityBridge() || desktopUpdateAction) return;
    setDesktopUpdateAction("checking");
    setDesktopUpdateNotice("");
    try {
      const state = await checkDesktopForUpdates();
      setDesktopUpdateState(state);
    } catch (error) {
      const message = error instanceof Error ? error.message : "DeCave could not check for updates. Try again later.";
      setDesktopUpdateNotice(message);
    } finally {
      setDesktopUpdateAction(null);
    }
  };

  const handleRestartDesktopToUpdate = async () => {
    if (desktopUpdateState?.status !== "downloaded" || desktopUpdateAction) return;
    setDesktopUpdateAction("restarting");
    setDesktopUpdateNotice("");
    try {
      const restarted = await restartDesktopToUpdate();
      if (!restarted) throw new Error("DeCave could not restart to apply the update. Save your work and try again.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "DeCave could not restart to apply the update. Try again later.";
      setDesktopUpdateNotice(message);
    } finally {
      setDesktopUpdateAction(null);
    }
  };

  const desktopInstalledVersion = hasDesktopActivityBridge()
    ? (desktopUpdateState?.currentVersion ?? "Loading…")
    : "Web (live)";
  const desktopUpdateStatusCopy = !hasDesktopActivityBridge()
    ? "Desktop updates are available in the DeCave Windows desktop app."
    : !desktopUpdateState
      ? "Installed version is loading from the desktop bridge."
      : desktopUpdateState.status === "checking"
        ? `Installed version ${desktopInstalledVersion} · Checking for updates…`
        : desktopUpdateState.status === "downloading"
          ? `Installed version ${desktopInstalledVersion} · Downloading update ${desktopUpdateState.availableVersion ?? ""}${desktopUpdateState.percent !== null ? ` · ${Math.round(desktopUpdateState.percent)}%` : ""}`
          : desktopUpdateState.status === "downloaded"
            ? `Installed version ${desktopInstalledVersion} · Update ${desktopUpdateState.availableVersion ?? ""} downloaded and ready. Restart to apply.`
            : desktopUpdateState.status === "up-to-date"
              ? `Installed version ${desktopInstalledVersion} · You're up to date.`
              : desktopUpdateState.status === "error"
                ? `Installed version ${desktopInstalledVersion} · Update check failed: ${desktopUpdateState.error || "Try again later."}`
                : desktopUpdateState.status === "disabled"
                  ? `Installed version ${desktopInstalledVersion} · Desktop updates are disabled in this build.`
                  : `Installed version ${desktopInstalledVersion} · Ready to check for updates.`;

  return {
    desktopUpdateState,
    desktopUpdateAction,
    desktopUpdateNotice,
    handleCheckDesktopForUpdates,
    handleRestartDesktopToUpdate,
    desktopInstalledVersion,
    desktopUpdateStatusCopy,
  };
}

export type DesktopUpdates = ReturnType<typeof useDesktopUpdates>;
