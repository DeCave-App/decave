// Tells each screen sharer whether we are watching their stream, so the
// sharer sends full quality only to viewers who are actually watching.
// For shares that come through the SFU, the same signal switches the pulled
// simulcast layer (full when watching, preview otherwise).

import { useEffect, useRef } from "react";
import type { RemoteScreen } from "../types";

export function useScreenWatchReporter(
  remoteScreens: Record<string, RemoteScreen>,
  watchedScreenConnections: Record<string, boolean>,
  sendSocket: (payload: unknown) => boolean,
  setSfuLayer?: (connectionId: string, watching: boolean) => void,
) {
  const reportedRef = useRef(new Map<string, boolean>());

  useEffect(() => {
    const reported = reportedRef.current;
    // Forget sharers that stopped, so a restarted share is reported again.
    for (const connectionId of [...reported.keys()]) {
      if (!remoteScreens[connectionId]) reported.delete(connectionId);
    }
    for (const connectionId of Object.keys(remoteScreens)) {
      const watching = watchedScreenConnections[connectionId] === true;
      if (reported.get(connectionId) === watching) continue;
      // SFU layer first (ignored for mesh sharers); the mesh report stays so a
      // sharer that falls back to mesh still knows whether we watch.
      setSfuLayer?.(connectionId, watching);
      if (sendSocket({ type: "RTC_SCREEN_WATCH", targetConnectionId: connectionId, watching })) {
        reported.set(connectionId, watching);
      }
    }
  }, [remoteScreens, watchedScreenConnections, sendSocket, setSfuLayer]);
}
