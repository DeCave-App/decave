// Game activity: a 1 s clock for elapsed play time, an automatic game scan every
// 15 s while signed in (cleared on sign-out), and stopping the Steam link poll on unmount.

import { type MutableRefObject, useEffect } from "react";
import type { AccountUser } from "../types";
import type { GameActivityState } from "../state/game-activity";
import type { ActivityActions } from "../actions/activity";

export type GameActivityTrackingDeps = {
  currentUser: AccountUser | null;
  gameActivity: GameActivityState;
  automaticActivityActiveRef: MutableRefObject<boolean>;
  lastPublishedActivityRef: MutableRefObject<string>;
  steamLinkPollTimerRef: MutableRefObject<number | null>;
  activityActions: ActivityActions;
};

export function useGameActivityTracking(deps: GameActivityTrackingDeps): void {
  const {
    currentUser,
    gameActivity,
    automaticActivityActiveRef,
    lastPublishedActivityRef,
    steamLinkPollTimerRef,
    activityActions,
  } = deps;

  useEffect(() => {
    const timer = window.setInterval(() => gameActivity.setActivityNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!currentUser) {
      gameActivity.setActivityState(null);
      gameActivity.setDetectedDesktopGame(null);
      automaticActivityActiveRef.current = false;
      lastPublishedActivityRef.current = "";
      return;
    }
    void activityActions.refreshActivityState().then(() => activityActions.runAutomaticActivityScan(true));
    const timer = window.setInterval(() => void activityActions.runAutomaticActivityScan(false), 15_000);
    return () => window.clearInterval(timer);
  }, [currentUser?.id]);

  useEffect(
    () => () => {
      if (steamLinkPollTimerRef.current !== null) {
        window.clearInterval(steamLinkPollTimerRef.current);
      }
    },
    [],
  );
}
