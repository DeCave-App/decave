// Game activity: what you're playing (detected or from Steam), the Steam link,
// and the busy/notice state of the Activity settings.

import { useState } from "react";
import type { ActivityState, SteamIntegrationState, DetectedDesktopGame } from "../types";

export function useGameActivityState() {
  const [activityState, setActivityState] = useState<ActivityState | null>(null);
  const [steamIntegration, setSteamIntegration] = useState<SteamIntegrationState>({
    linked: false,
    apiConfigured: false,
  });
  const [detectedDesktopGame, setDetectedDesktopGame] = useState<DetectedDesktopGame | null>(null);
  const [activityNotice, setActivityNotice] = useState("");
  const [activityBusy, setActivityBusy] = useState(false);
  const [activityNow, setActivityNow] = useState(() => Date.now());

  return {
    activityState,
    setActivityState,
    steamIntegration,
    setSteamIntegration,
    detectedDesktopGame,
    setDetectedDesktopGame,
    activityNotice,
    setActivityNotice,
    activityBusy,
    setActivityBusy,
    activityNow,
    setActivityNow,
  };
}

export type GameActivityState = ReturnType<typeof useGameActivityState>;
