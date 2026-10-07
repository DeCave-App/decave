// Realtime voice events: room state, peers joining and leaving, WebRTC signaling, moderation and the soundboard.

import type { Dispatch, SetStateAction, MutableRefObject } from "react";
import {
  shouldInterruptQuietPresence,
  type QuietPresenceSettings as QuietPresenceModel,
} from "../../session/quiet-presence.ts";
import type {
  Server,
  VoiceParticipant,
  PeerSession,
  RemoteScreen,
  AudioSettings,
  SinkableAudioElement,
  NotificationSettings,
  UiSoundEvent,
  VoiceJoinAttempt,
} from "../../app/types";
import { HTTP_URL } from "../../app/env";
import type { RealtimeFrame } from "../connection";

export type VoiceEventContext = {
  setSoundboardNotice: Dispatch<SetStateAction<string>>;
  quietPresence: QuietPresenceModel;
  setVoiceParticipants: Dispatch<SetStateAction<VoiceParticipant[]>>;
  setVoiceChannelId: Dispatch<SetStateAction<number | null>>;
  setVoiceStatus: Dispatch<SetStateAction<string>>;
  setVoiceError: Dispatch<SetStateAction<string>>;
  setIsServerMuted: Dispatch<SetStateAction<boolean>>;
  setIsServerDeafened: Dispatch<SetStateAction<boolean>>;
  setRemoteScreens: Dispatch<SetStateAction<Record<string, RemoteScreen>>>;
  setRemoteCameras: Dispatch<SetStateAction<Record<string, RemoteScreen>>>;
  voiceReconnectChannelRef: MutableRefObject<number | null>;
  voiceServerIdRef: MutableRefObject<number | null>;
  voiceJoinAttemptRef: MutableRefObject<VoiceJoinAttempt | null>;
  voiceJoinStartedAtRef: MutableRefObject<number | null>;
  activeServerRef: MutableRefObject<number>;
  serversRef: MutableRefObject<Server[]>;
  voiceChannelRef: MutableRefObject<number | null>;
  notificationSettingsRef: MutableRefObject<NotificationSettings>;
  audioSettingsRef: MutableRefObject<AudioSettings>;
  isServerMutedRef: MutableRefObject<boolean>;
  isServerDeafenedRef: MutableRefObject<boolean>;
  peerSessionsRef: MutableRefObject<Map<string, PeerSession>>;
  applyMicrophoneEnabledState: () => boolean;
  playUiSound: (event: UiSoundEvent, preview?: boolean, quietChecked?: boolean) => void;
  sendSocket: (payload: unknown) => boolean;
  setAudioSink: (element: SinkableAudioElement, outputDeviceId: string) => Promise<boolean>;
  upsertVoiceParticipant: (participant: VoiceParticipant) => void;
  closePeer: (connectionId: string) => void;
  ensurePeer: (participant: VoiceParticipant) => PeerSession;
  ensureVoicePeersFromState: (participants: VoiceParticipant[]) => void;
  handleRtcDescription: (
    participant: VoiceParticipant,
    description: RTCSessionDescriptionInit,
    auth?: unknown,
  ) => Promise<void>;
  handleRtcCandidate: (participant: VoiceParticipant, candidate: RTCIceCandidateInit) => Promise<void>;
  finishVoiceJoinAttempt: (channelId: number) => void;
  acceptsVoiceJoinAcknowledgement: (channelId: number) => boolean;
  cleanupVoiceLocal: (clearPresence: boolean, preserveMicrophone?: boolean, preserveRecoveryCounter?: boolean) => void;
  loadSoundboardSounds: () => Promise<void>;
};

/** Returns true when the frame was handled. */
export function handleVoiceEvent(data: RealtimeFrame, context: VoiceEventContext): boolean {
  const {
    setSoundboardNotice,
    quietPresence,
    setVoiceParticipants,
    setVoiceChannelId,
    setVoiceStatus,
    setVoiceError,
    setIsServerMuted,
    setIsServerDeafened,
    setRemoteScreens,
    setRemoteCameras,
    voiceReconnectChannelRef,
    voiceServerIdRef,
    voiceJoinAttemptRef,
    voiceJoinStartedAtRef,
    activeServerRef,
    serversRef,
    voiceChannelRef,
    notificationSettingsRef,
    audioSettingsRef,
    isServerMutedRef,
    isServerDeafenedRef,
    peerSessionsRef,
    applyMicrophoneEnabledState,
    playUiSound,
    sendSocket,
    setAudioSink,
    upsertVoiceParticipant,
    closePeer,
    ensurePeer,
    ensureVoicePeersFromState,
    handleRtcDescription,
    handleRtcCandidate,
    finishVoiceJoinAttempt,
    acceptsVoiceJoinAcknowledgement,
    cleanupVoiceLocal,
    loadSoundboardSounds,
  } = context;

  if (data.type === "VOICE_STATE") {
    const participants = Array.isArray(data.participants) ? (data.participants as VoiceParticipant[]) : [];
    setVoiceParticipants(participants);
    ensureVoicePeersFromState(participants);

    const sharingConnections = new Set(
      participants.filter((participant) => participant.screenSharing).map((participant) => participant.connectionId),
    );
    const cameraConnections = new Set(
      participants.filter((participant) => participant.cameraSharing).map((participant) => participant.connectionId),
    );
    setRemoteScreens((current) => {
      let changed = false;
      const next = { ...current };
      for (const connectionId of Object.keys(next))
        if (!sharingConnections.has(connectionId)) {
          delete next[connectionId];
          changed = true;
        }
      return changed ? next : current;
    });
    setRemoteCameras((current) => {
      let changed = false;
      const next = { ...current };
      for (const connectionId of Object.keys(next))
        if (!cameraConnections.has(connectionId)) {
          delete next[connectionId];
          changed = true;
        }
      return changed ? next : current;
    });
    return true;
  }

  if (data.type === "VOICE_JOINED") {
    const channelId = Number(data.channelId);
    if (!acceptsVoiceJoinAcknowledgement(channelId)) {
      // F6: the server joined us after the user cancelled/left. Undo it so
      // we don't leave a ghost participant, unless another join or a live
      // voice session now owns this connection.
      if (voiceJoinAttemptRef.current === null && voiceChannelRef.current === null) {
        sendSocket({ type: "VOICE_LEAVE" });
      }
      return true;
    }
    const legacyJoinStartedAt = voiceJoinStartedAtRef.current;
    if (legacyJoinStartedAt !== null) {
      voiceJoinStartedAtRef.current = null;
    }
    finishVoiceJoinAttempt(channelId);
    voiceReconnectChannelRef.current = null;
    voiceServerIdRef.current =
      serversRef.current.find((server) => server.channels.some((channel) => channel.id === channelId))?.id ??
      voiceServerIdRef.current;
    voiceChannelRef.current = channelId;
    setVoiceChannelId(channelId);
    setVoiceStatus("Connected");
    setVoiceError("");

    if (data.participant && typeof data.participant === "object") {
      upsertVoiceParticipant(data.participant as VoiceParticipant);
    }
    if (Array.isArray(data.peers)) {
      for (const peer of data.peers as VoiceParticipant[]) {
        upsertVoiceParticipant(peer);
        ensurePeer(peer);
      }
    }
    return true;
  }

  if (data.type === "VOICE_LEFT") {
    cleanupVoiceLocal(false);
    return true;
  }

  if (data.type === "VOICE_PEER_JOINED") {
    if (data.participant && typeof data.participant === "object") {
      const participant = data.participant as VoiceParticipant;
      upsertVoiceParticipant(participant);
      ensureVoicePeersFromState([participant]);
      if (notificationSettingsRef.current.voiceEvents && shouldInterruptQuietPresence(quietPresence, "ordinary-join"))
        playUiSound("voiceJoin");
    }
    return true;
  }

  if (data.type === "VOICE_PEER_LEFT") {
    const connectionId = typeof data.connectionId === "string" ? data.connectionId : "";
    if (connectionId) {
      closePeer(connectionId);
      setVoiceParticipants((current) => current.filter((item) => item.connectionId !== connectionId));
      if (notificationSettingsRef.current.voiceEvents && shouldInterruptQuietPresence(quietPresence, "ordinary-join"))
        playUiSound("voiceLeave");
    }
    return true;
  }

  if (data.type === "RTC_DESCRIPTION" && voiceChannelRef.current === null) return true;

  if (data.type === "RTC_DESCRIPTION") {
    if (data.from && typeof data.from === "object" && data.description && typeof data.description === "object") {
      void handleRtcDescription(
        data.from as VoiceParticipant,
        data.description as RTCSessionDescriptionInit,
        data.auth,
      );
    }
    return true;
  }

  if (data.type === "RTC_ICE_CANDIDATE" && voiceChannelRef.current === null) return true;

  if (data.type === "RTC_ICE_CANDIDATE") {
    if (data.from && typeof data.from === "object" && data.candidate && typeof data.candidate === "object") {
      void handleRtcCandidate(data.from as VoiceParticipant, data.candidate as RTCIceCandidateInit);
    }
    return true;
  }

  if (data.type === "VOICE_MODERATION_STATE") {
    const serverMuted = data.serverMuted === true;
    const serverDeafened = data.serverDeafened === true;
    isServerMutedRef.current = serverMuted;
    isServerDeafenedRef.current = serverDeafened;
    setIsServerMuted(serverMuted);
    setIsServerDeafened(serverDeafened);
    applyMicrophoneEnabledState();
    for (const session of peerSessionsRef.current.values()) session.resumeAudio();
    return true;
  }

  if (data.type === "VOICE_KICKED") {
    const message = typeof data.message === "string" ? data.message : "You were disconnected by a moderator.";
    cleanupVoiceLocal(false);
    setVoiceError(message);
    return true;
  }

  if (data.type === "SOUNDBOARD_REFRESH") {
    if (Number(data.hubId) === activeServerRef.current) void loadSoundboardSounds();
    return true;
  }

  if (data.type === "VOICE_SOUNDBOARD_PLAY") {
    const soundUrl = typeof data.url === "string" ? data.url : "";
    if (!soundUrl) return true;
    try {
      const audio = new Audio(new URL(soundUrl, HTTP_URL).toString());
      audio.volume = 0.82;
      void setAudioSink(audio as SinkableAudioElement, audioSettingsRef.current.outputDeviceId);
      void audio.play().catch(() => undefined);
      const playedBy = typeof data.username === "string" ? data.username : "Someone";
      const soundName = typeof data.name === "string" ? data.name : "a sound";
      setSoundboardNotice(`${playedBy} played ${soundName}.`);
    } catch {}
    return true;
  }

  if (data.type === "VOICE_ERROR") {
    if (voiceJoinAttemptRef.current) cleanupVoiceLocal(false);
    setVoiceError(typeof data.message === "string" ? data.message : "Voice connection error.");
    setVoiceStatus("Disconnected");
    return true;
  }

  return false;
}
