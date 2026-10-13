// Your setup for the open Settings window: gathers the checkup state from the
// app (two-factor status, encryption, push to talk, notifications, mic test,
// desktop update, avatar) and keeps the items live as settings change.

import { useEffect, useReducer, useState } from "react";
import { HTTP_URL } from "../../../app/env";
import { authorizedFetch } from "../../../app/http";
import { hasDesktopActivityBridge } from "../../../app/desktop";
import type { AccountUser, AudioSettings, NotificationSettings } from "../../../app/types";
import type { DesktopUpdates } from "../../../app/hooks/useDesktopUpdates";
import { useDmE2ee } from "../../../e2ee/dm-e2ee-client";
import {
  checkupItems,
  micTestedOnThisDevice,
  notificationPermission,
  type CheckupItem,
  type CheckupState,
} from "./checks";
import { useCheckupDismissed } from "./dismissed";

/** Last known two-factor status, so reopening Settings can decide at once. */
let knownTwoFactor: boolean | null = null;

type Sources = {
  currentUser: AccountUser;
  audioSettings: AudioSettings;
  notificationSettings: NotificationSettings;
  desktopUpdates: DesktopUpdates;
};

export function useCheckup({ currentUser, audioSettings, notificationSettings, desktopUpdates }: Sources) {
  const e2ee = useDmE2ee();
  const dismissed = useCheckupDismissed();
  const [twoFactorOn, setTwoFactorOn] = useState<boolean | null>(knownTwoFactor);
  // Permission and the mic-test mark live outside React; re-read them on demand.
  const [, refresh] = useReducer((count: number) => count + 1, 0);

  const reportTwoFactor = (enabled: boolean) => {
    knownTwoFactor = enabled;
    setTwoFactorOn(enabled);
  };

  useEffect(() => {
    let cancelled = false;
    void authorizedFetch(`${HTTP_URL}/api/account/mfa`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { enabled?: boolean } | null) => {
        if (!cancelled && data && typeof data.enabled === "boolean") reportTwoFactor(data.enabled);
      })
      .catch(() => undefined);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, [currentUser.id]);

  const state: CheckupState = {
    // Unknown until checked: don't nag.
    twoFactorOn: twoFactorOn !== false,
    e2eeAvailable: e2ee.available && (e2ee.status === "ready" || e2ee.status === "locked"),
    recoveryBackupSaved: !e2ee.pendingRecoveryCode,
    pttMode: audioSettings.pushToTalk,
    pttKey: audioSettings.pushToTalkKey || null,
    notificationsOn: notificationSettings.desktop,
    notificationPermission: notificationPermission(),
    micTestedOnDevice: micTestedOnThisDevice(),
    desktopUpdateReady: desktopUpdates.desktopUpdateState?.status === "downloaded",
    hasAvatar: Boolean(currentUser.avatarUrl),
    isDesktop: hasDesktopActivityBridge(),
  };
  const items: CheckupItem[] = checkupItems(state, dismissed);
  return { items, dismissed, reportTwoFactor, refresh };
}
