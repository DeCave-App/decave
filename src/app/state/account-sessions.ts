// Signed-in devices and the security verification link shown in
// Account settings.

import { useState } from "react";
import type { DeviceSession } from "../types";

export function useAccountSessionsState() {
  const [securityVerificationUrl, setSecurityVerificationUrl] = useState("");
  const [deviceSessions, setDeviceSessions] = useState<DeviceSession[]>([]);
  const [sessionBusyId, setSessionBusyId] = useState("");

  return {
    securityVerificationUrl,
    setSecurityVerificationUrl,
    deviceSessions,
    setDeviceSessions,
    sessionBusyId,
    setSessionBusyId,
  };
}

export type AccountSessionsState = ReturnType<typeof useAccountSessionsState>;
