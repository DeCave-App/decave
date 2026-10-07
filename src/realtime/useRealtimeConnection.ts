// Opens the realtime connection while signed in and wires it to the app: IDENTIFY,
// voice media recovery on resume, session expiry, and the handlers from realtimeAppRef.

import { type Dispatch, type SetStateAction, type MutableRefObject, useEffect } from "react";
import type { AccountUser, PeerSession } from "../app/types";
import { HTTP_URL, WS_URL } from "../app/env";
import { hasDesktopActivityBridge } from "../app/desktop";
import { connectRealtime, type RealtimeSendWindow } from "./connection";
import { handleRealtimeEvent, type RealtimeAppHandlers } from "./events";

export type RealtimeConnectionDeps = {
  authToken: string;
  currentUser: AccountUser | null;
  setCurrentUser: Dispatch<SetStateAction<AccountUser | null>>;
  setAuthError: Dispatch<SetStateAction<string>>;
  setConnectionStatus: Dispatch<SetStateAction<string>>;
  socketRef: MutableRefObject<WebSocket | null>;
  reconnectNowRef: MutableRefObject<() => void>;
  realtimeReconnectEnabledRef: MutableRefObject<boolean>;
  reconnectAttemptRef: MutableRefObject<number>;
  activeServerRef: MutableRefObject<number>;
  activeChannelRef: MutableRefObject<number>;
  voiceChannelRef: MutableRefObject<number | null>;
  audioContextRef: MutableRefObject<AudioContext | null>;
  peerSessionsRef: MutableRefObject<Map<string, PeerSession>>;
  remoteAudioElementsRef: MutableRefObject<Map<string, HTMLAudioElement>>;
  remoteGainContextsRef: MutableRefObject<
    Map<
      string,
      {
        context: AudioContext;
        gain: GainNode;
        source: MediaStreamAudioSourceNode;
        trackId: string;
        destination: MediaStreamAudioDestinationNode;
      }
    >
  >;
  storeToken: (token: string) => void;
  fetchWsToken: () => Promise<string>;
  realtimeAppRef: MutableRefObject<RealtimeAppHandlers | null>;
};

export function useRealtimeConnection(deps: RealtimeConnectionDeps): void {
  const {
    authToken,
    currentUser,
    setCurrentUser,
    setAuthError,
    setConnectionStatus,
    socketRef,
    reconnectNowRef,
    realtimeReconnectEnabledRef,
    reconnectAttemptRef,
    activeServerRef,
    activeChannelRef,
    voiceChannelRef,
    audioContextRef,
    peerSessionsRef,
    remoteAudioElementsRef,
    remoteGainContextsRef,
    storeToken,
    fetchWsToken,
    realtimeAppRef,
  } = deps;

  useEffect(() => {
    if (!currentUser || !authToken) return;

    realtimeReconnectEnabledRef.current = true;

    const recoverVoiceMediaIfNeeded = () => {
      if (voiceChannelRef.current === null) return;
      if (audioContextRef.current?.state === "suspended") void audioContextRef.current.resume().catch(() => {});
      for (const session of peerSessionsRef.current.values()) {
        const audio = remoteAudioElementsRef.current.get(session.participant.connectionId);
        if (audio && !audio.muted) void audio.play().catch(() => {});
        const amplified = remoteGainContextsRef.current.get(session.participant.connectionId);
        if (amplified?.context.state === "suspended") void amplified.context.resume().catch(() => {});
        if (
          session.pc.connectionState === "disconnected" ||
          session.pc.connectionState === "failed" ||
          session.pc.iceConnectionState === "disconnected" ||
          session.pc.iceConnectionState === "failed"
        )
          session.recover("application resumed", true);
      }
    };

    const connection = connectRealtime({
      url: WS_URL,
      socketRef,
      reconnectAttemptRef,
      reconnectEnabledRef: realtimeReconnectEnabledRef,
      setStatus: setConnectionStatus,
      identify: () => ({
        type: "IDENTIFY",
        token: authToken,
        client: hasDesktopActivityBridge() ? "desktop" : "web", // DECAVE_PARITY_WEB_IDENTIFY_CLIENT
        serverId: activeServerRef.current,
        channelId: activeChannelRef.current,
      }),
      refreshToken: fetchWsToken,
      isSessionExpired: async () => {
        const meResponse = await fetch(`${HTTP_URL}/api/auth/me`, {
          credentials: "include",
          cache: "no-store",
        });
        return meResponse.status === 401;
      },
      onSessionExpired: () => {
        realtimeReconnectEnabledRef.current = false;
        storeToken("");
        setCurrentUser(null);
        setAuthError("Your session expired. Please sign in again.");
      },
      onTokenRefreshed: storeToken,
      onFrame: (data) => {
        window.dispatchEvent(new CustomEvent("decave-realtime-event", { detail: data })); // DECAVE_PARITY_WEB_EVENT
      },
      onAuthError: (data) => realtimeAppRef.current?.onAuthError(data),
      onIdentified: (data, socket) => realtimeAppRef.current?.onIdentified(data, socket),
      onEvent: (data) => {
        const app = realtimeAppRef.current;
        if (app) handleRealtimeEvent(data, app.events);
      },
      onClosed: () => realtimeAppRef.current?.onClosed(),
      onResume: recoverVoiceMediaIfNeeded,
    });
    reconnectNowRef.current = connection.reconnectNow;
    (window as RealtimeSendWindow).__decaveRealtimeSend = connection.send; // DECAVE_PARITY_WEB_SEND

    return () => {
      reconnectNowRef.current = () => {};
      connection.dispose();
    };
  }, [currentUser?.id, authToken]);
}
