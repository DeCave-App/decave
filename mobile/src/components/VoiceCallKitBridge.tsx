import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import type CallKeep from "react-native-callkeep";
import { RTCAudioSession } from "react-native-webrtc";
import { AudioRouting } from "../../modules/decave-audio-route";
import { roomNameFor } from "@/src/lib/last-voice-room";
import { useVoice } from "@/src/providers/VoiceProvider";

function newCallId(): string {
  // CallKit needs a UUID per call.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const value = (Math.random() * 16) | 0;
    return (char === "x" ? value : (value & 0x3) | 0x8).toString(16);
  });
}

// iOS only. On Android with the New Architecture, merely touching the native
// module throws (RNCallKeep exports overloaded displayIncomingCall methods),
// which crashed the app at launch, so the module is never loaded there.
const RNCallKeep: typeof CallKeep =
  Platform.OS === "ios" ? require("react-native-callkeep").default : (null as unknown as typeof CallKeep);

let setupDone: Promise<boolean> | null = null;

function ensureSetup(): Promise<boolean> {
  setupDone ??= RNCallKeep.setup({
    ios: { appName: "DeCave", supportsVideo: false, maximumCallGroups: "1", maximumCallsPerCallGroup: "1", includesCallsInRecents: false },
    android: { alertTitle: "", alertDescription: "", cancelButton: "", okButton: "", additionalPermissions: [] },
  }).catch((error) => {
    console.warn("[callkit] setup failed", error);
    setupDone = null;
    return false;
  });
  return setupDone;
}

/**
 * Reports voice rooms to CallKit on iOS, so a live room shows on the lock
 * screen and in the Dynamic Island, keeps audio priority in the background,
 * and can be muted or left from system UI.
 */
export function VoiceCallKitBridge() {
  const { voiceChannelId, voiceStatus, muted, toggleMute, leaveVoice } = useVoice();
  const callIdRef = useRef<string | null>(null);
  const connectedReportedRef = useRef(false);
  const callChannelRef = useRef<number | null>(null);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const actionsRef = useRef({ toggleMute, leaveVoice });
  actionsRef.current = { toggleMute, leaveVoice };

  const active = voiceChannelId != null && voiceStatus !== "disconnected";

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    const subs = [
      RNCallKeep.addEventListener("endCall", ({ callUUID }) => {
        if (callUUID !== callIdRef.current) return;
        callIdRef.current = null;
        actionsRef.current.leaveVoice();
      }),
      RNCallKeep.addEventListener("didPerformSetMutedCallAction", ({ muted: systemMuted, callUUID }) => {
        if (callUUID === callIdRef.current && systemMuted !== mutedRef.current) actionsRef.current.toggleMute();
      }),
      RNCallKeep.addEventListener("didActivateAudioSession", () => {
        RTCAudioSession.audioSessionDidActivate();
        // CallKit activation resets any output override; keep the speaker choice.
        void AudioRouting.reapply().catch(() => {});
      }),
      RNCallKeep.addEventListener("didDeactivateAudioSession", () => RTCAudioSession.audioSessionDidDeactivate()),
    ];
    return () => subs.forEach((sub) => sub.remove());
  }, []);

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    if (active && !callIdRef.current) {
      const id = newCallId();
      callIdRef.current = id;
      connectedReportedRef.current = false;
      void (async () => {
        if (!(await ensureSetup()) || callIdRef.current !== id) return;
        const name = await roomNameFor(voiceChannelId);
        RNCallKeep.startCall(id, name, `DeCave · ${name}`, "generic", false);
      })();
    } else if (active && callIdRef.current && callChannelRef.current !== voiceChannelId) {
      // Switched rooms without leaving: keep the call, rename it.
      const id = callIdRef.current;
      void roomNameFor(voiceChannelId).then((name) => {
        if (callIdRef.current === id) RNCallKeep.updateDisplay(id, name, `DeCave · ${name}`);
      });
    } else if (!active && callIdRef.current) {
      RNCallKeep.endCall(callIdRef.current);
      callIdRef.current = null;
    }
    callChannelRef.current = active ? voiceChannelId : null;
  }, [active, voiceChannelId]);

  useEffect(() => {
    const id = callIdRef.current;
    if (Platform.OS !== "ios" || !id || voiceStatus !== "connected" || connectedReportedRef.current) return;
    connectedReportedRef.current = true;
    RNCallKeep.reportConnectedOutgoingCallWithUUID(id);
  }, [voiceStatus]);

  useEffect(() => {
    const id = callIdRef.current;
    if (Platform.OS === "ios" && id) RNCallKeep.setMutedCall(id, muted);
  }, [muted]);

  return null;
}
