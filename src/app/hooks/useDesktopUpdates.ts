// Desktop app updates: the updater's status, checking for an update, restarting
// to install it, and the status text shown in Settings.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation(["chat"]);

  useEffect(() => {
    if (!hasDesktopActivityBridge()) return;
    let active = true;
    void getDesktopUpdateStatus()
      .then((state) => {
        if (active) setDesktopUpdateState(state);
      })
      .catch((error) => {
        if (!active) return;
        setDesktopUpdateNotice(error instanceof Error ? error.message : t("chat.actions.desktopUpdate.statusFailed"));
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
      const message = error instanceof Error ? error.message : t("chat.actions.desktopUpdate.checkFailed");
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
      if (!restarted) throw new Error(t("chat.actions.desktopUpdate.restartRefused"));
    } catch (error) {
      const message = error instanceof Error ? error.message : t("chat.actions.desktopUpdate.restartFailed");
      setDesktopUpdateNotice(message);
    } finally {
      setDesktopUpdateAction(null);
    }
  };

  const desktopInstalledVersion = hasDesktopActivityBridge()
    ? (desktopUpdateState?.currentVersion ?? t("chat.actions.desktopUpdate.versionLoading"))
    : t("chat.actions.desktopUpdate.webVersion");
  const installed = desktopInstalledVersion;
  const available = desktopUpdateState?.availableVersion ?? "";
  const desktopUpdateStatusCopy = !hasDesktopActivityBridge()
    ? t("chat.actions.desktopUpdate.webOnly")
    : !desktopUpdateState
      ? t("chat.actions.desktopUpdate.loading")
      : desktopUpdateState.status === "checking"
        ? t("chat.actions.desktopUpdate.checking", { installed })
        : desktopUpdateState.status === "downloading"
          ? desktopUpdateState.percent !== null
            ? t("chat.actions.desktopUpdate.downloadingPercent", {
                installed,
                available,
                percent: Math.round(desktopUpdateState.percent),
              })
            : t("chat.actions.desktopUpdate.downloading", { installed, available })
          : desktopUpdateState.status === "downloaded"
            ? t("chat.actions.desktopUpdate.downloaded", { installed, available })
            : desktopUpdateState.status === "up-to-date"
              ? t("chat.actions.desktopUpdate.upToDate", { installed })
              : desktopUpdateState.status === "error"
                ? t("chat.actions.desktopUpdate.failed", {
                    installed,
                    reason: desktopUpdateState.error || t("chat.actions.desktopUpdate.tryLater"),
                  })
                : desktopUpdateState.status === "disabled"
                  ? t("chat.actions.desktopUpdate.disabled", { installed })
                  : t("chat.actions.desktopUpdate.ready", { installed });

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
