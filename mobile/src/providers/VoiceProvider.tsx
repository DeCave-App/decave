import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from "expo-audio";
import { primePermission } from "@/src/lib/permission-primer";
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { PermissionsAndroid, Platform } from "react-native";
import {
  MediaStream,
  type MediaStreamTrack,
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  mediaDevices,
} from "react-native-webrtc";
import { apiJson } from "@/src/lib/api";
import { useRealtime } from "@/src/providers/RealtimeProvider";
import { useSession } from "@/src/providers/SessionProvider";
import { useVoiceSettings } from "@/src/providers/VoiceSettingsProvider";
import type { RealtimeEvent, VoiceParticipant } from "@/src/types";
import { requestIosBroadcast } from "@/src/components/IosBroadcastPicker";
import { ScreenBroadcast } from "../../modules/decave-screen-broadcast";
import { hasUsableRelayIceServers } from "../../../shared/rtc-relay";

type VoiceStatus = "disconnected" | "joining" | "connected";
export type VoiceCaptureStatus =
  | "inactive"
  | "applying"
  | "applied"
  | "replaced"
  | "unsupported";
export type VoiceRecoveryState = "idle" | "reconnecting" | "failed";
type IceServer = { urls: string | string[]; username?: string; credential?: string };

type DescriptionPayload = {
  type: "offer" | "answer";
  sdp: string;
};

type CandidatePayload = {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
};

type PeerSession = {
  pc: RTCPeerConnection;
  participant: VoiceParticipant;
  polite: boolean;
  signalingQueue: Promise<void>;
  makingOffer: boolean;
  ignoreOffer: boolean;
  isSettingRemoteAnswerPending: boolean;
  remoteDescriptionPending: boolean;
  remoteAudioTracks: MediaStreamTrack[];
  pendingCandidates: CandidatePayload[];
  localTrackSetup: Promise<void>;
  attachedAudioReceiverIds: Set<string>;
  attachedVideoReceiverIds: Set<string>;
  recoveryAttempts: number;
  recoveryTimer: ReturnType<typeof setTimeout> | null;
};

export type RemoteVoiceVideo = {
  connectionId: string;
  userId: string;
  username: string;
  stream: MediaStream;
};

type VoiceModerationAction = "mute" | "unmute" | "deafen" | "undeafen" | "kick";

type VoiceContextValue = {
  voiceChannelId: number | null;
  voiceOwnerGeneration: number | null;
  sessionGeneration: number;
  participants: VoiceParticipant[];
  voiceStatus: VoiceStatus;
  voiceError: string;
  captureStatus: VoiceCaptureStatus;
  captureStatusMessage: string;
  recoveryState: VoiceRecoveryState;
  recoveryAttempt: number;
  retryVoice: () => void;
  speakingUserIds: string[];
  speakingAvailable: boolean;
  muted: boolean;
  deafened: boolean;
  serverMuted: boolean;
  serverDeafened: boolean;
  screenSharing: boolean;
  cameraSharing: boolean;
  screenShareError: string;
  remoteVideos: Record<string, RemoteVoiceVideo>;
  locallyMutedUserIds: string[];
  /** Per-user playback volume on this device, 0–2 (1 = normal). */
  userVolumes: Record<string, number>;
  /** Median round-trip time to peers in ms, or null when unknown. */
  pingMs: number | null;
  setUserVolume: (userId: string, volume: number) => void;
  joinVoice: (channelId: number) => Promise<boolean>;
  leaveVoice: () => void;
  toggleMute: () => void;
  toggleDeafen: () => void;
  startCamera: () => Promise<boolean>;
  stopCamera: () => void;
  startScreenShare: () => Promise<boolean>;
  stopScreenShare: () => void;
  toggleLocalUserMute: (userId: string) => void;
  moderateParticipant: (targetConnectionId: string, action: VoiceModerationAction) => void;
};

const VoiceContext = createContext<VoiceContextValue | null>(null);
const MAX_PEER_RECOVERY_ATTEMPTS = 3;
const PEER_RECOVERY_DELAYS_MS = [250, 750, 1_500] as const;
const VOICE_RECOVERY_DELAYS_MS = [500, 1_500, 3_000] as const;

const fallbackIceServers: IceServer[] = [];

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

type CaptureSettings = {
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
};

type CaptureTrack = MediaStreamTrack & {
  applyConstraints?: (constraints?: MediaTrackConstraints) => Promise<void>;
  getSettings?: () => Record<string, unknown>;
};

function captureConstraints(settings: CaptureSettings): MediaTrackConstraints {
  return {
    echoCancellation: settings.echoCancellation,
    noiseSuppression: settings.noiseSuppression,
    autoGainControl: settings.autoGainControl,
  } as MediaTrackConstraints;
}

function captureReport(track: MediaStreamTrack, requested: CaptureSettings): string {
  const actual = (track as CaptureTrack).getSettings?.() as Record<string, unknown> | undefined;
  if (!actual || typeof actual !== "object") {
    return "Microphone processing was requested; this device does not report per-setting capability.";
  }

  const unavailable = (Object.keys(requested) as Array<keyof CaptureSettings>).filter(
    (key) => typeof actual[key] === "boolean" && actual[key] !== requested[key],
  );
  if (unavailable.length > 0) {
    return `Microphone active; unsupported processing: ${unavailable
      .map((key) => key === "echoCancellation" ? "echo cancellation" : key === "noiseSuppression" ? "noise suppression" : "automatic gain")
      .join(", ")}.`;
  }
  return "Microphone processing is active on this device.";
}

export function VoiceProvider({ children }: PropsWithChildren) {
  const { token, user } = useSession();
  const sessionIdentity = `${user?.id ?? ""}:${token ?? ""}`;
  const sessionScopeRef = useRef({ identity: sessionIdentity, generation: 0 });
  if (sessionScopeRef.current.identity !== sessionIdentity) {
    sessionScopeRef.current = { identity: sessionIdentity, generation: sessionScopeRef.current.generation + 1 };
  }
  const sessionGeneration = sessionScopeRef.current.generation;
  const { settings: voiceSettings } = useVoiceSettings();
  const {
    connectionState,
    connectionId,
    send,
    subscribe,
  } = useRealtime();

  const [voiceChannelId, setVoiceChannelId] = useState<number | null>(null);
  const [voiceOwnerGeneration, setVoiceOwnerGeneration] = useState<number | null>(null);
  const [participants, setParticipants] = useState<VoiceParticipant[]>([]);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>("disconnected");
  const [voiceError, setVoiceError] = useState("");
  const [captureStatus, setCaptureStatus] = useState<VoiceCaptureStatus>("inactive");
  const [captureStatusMessage, setCaptureStatusMessage] = useState("");
  const [recoveryState, setRecoveryState] = useState<VoiceRecoveryState>("idle");
  const [recoveryAttempt, setRecoveryAttempt] = useState(0);
  const [speakingUserIds, setSpeakingUserIds] = useState<string[]>([]);
  const [speakingAvailable, setSpeakingAvailable] = useState(false);
  const [muted, setMuted] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [serverMuted, setServerMuted] = useState(false);
  const [serverDeafened, setServerDeafened] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [cameraSharing, setCameraSharing] = useState(false);
  const [screenShareError, setScreenShareError] = useState("");
  const [remoteVideos, setRemoteVideos] = useState<Record<string, RemoteVoiceVideo>>({});
  const [locallyMutedUserIds, setLocallyMutedUserIds] = useState<string[]>([]);
  const [pingMs, setPingMs] = useState<number | null>(null);
  const [userVolumes, setUserVolumes] = useState<Record<string, number>>({});
  const userVolumesRef = useRef<Record<string, number>>({});

  const voiceChannelRef = useRef<number | null>(null);
  const pendingVoiceChannelRef = useRef<number | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localCameraStreamRef = useRef<MediaStream | null>(null);
  const localScreenStreamRef = useRef<MediaStream | null>(null);
  const peerSessionsRef = useRef<Map<string, PeerSession>>(new Map());
  const iceServersRef = useRef<IceServer[]>(fallbackIceServers);
  const mutedRef = useRef(false);
  const deafenedRef = useRef(false);
  const serverMutedRef = useRef(false);
  const serverDeafenedRef = useRef(false);
  const locallyMutedUserIdsRef = useRef<Set<string>>(new Set());
  const voiceSettingsRef = useRef(voiceSettings);
  const participantsRef = useRef<VoiceParticipant[]>([]);
  const joinTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceOperationGenerationRef = useRef(0);
  const realtimeConnectionStateRef = useRef(connectionState);
  const voiceRecoveryRef = useRef<{
    channelId: number;
    attempts: number;
    generation: number;
    timer: ReturnType<typeof setTimeout> | null;
  } | null>(null);
  const captureOperationRef = useRef(0);
  const realtimeEventHandlerRef = useRef<(event: RealtimeEvent) => void>(() => {});


  useEffect(() => {
    voiceSettingsRef.current = voiceSettings;
  }, [voiceSettings]);

  const clearJoinTimeout = () => {
    if (joinTimeoutRef.current) {
      clearTimeout(joinTimeoutRef.current);
      joinTimeoutRef.current = null;
    }
  };

  const clearVoiceRecovery = () => {
    const recovery = voiceRecoveryRef.current;
    if (recovery?.timer) clearTimeout(recovery.timer);
    voiceRecoveryRef.current = null;
    setRecoveryState("idle");
    setRecoveryAttempt(0);
  };

  const setLocalTrackEnabled = () => {
    const enabled = !(mutedRef.current || serverMutedRef.current);
    for (const track of localStreamRef.current?.getAudioTracks() ?? []) {
      track.enabled = enabled;
    }
  };

  const setSessionRemoteAudioEnabled = (session: PeerSession) => {
    const enabled =
      !(deafenedRef.current || serverDeafenedRef.current) &&
      !locallyMutedUserIdsRef.current.has(session.participant.userId);
    const volume = userVolumesRef.current[session.participant.userId] ?? 1;
    for (const track of session.remoteAudioTracks) {
      track.enabled = enabled;
      try {
        (track as unknown as { _setVolume?: (value: number) => void })._setVolume?.(volume);
      } catch (error) {
        console.warn("[voice] could not set participant volume", error);
      }
    }
  };

  const setRemoteTrackEnabled = () => {
    for (const session of peerSessionsRef.current.values()) {
      setSessionRemoteAudioEnabled(session);
    }
  };

  const closePeer = (peerConnectionId: string) => {
    const session = peerSessionsRef.current.get(peerConnectionId);
    if (!session) return;
    if (session.recoveryTimer) clearTimeout(session.recoveryTimer);
    session.recoveryTimer = null;
    try {
      session.pc.onicecandidate = null;
      session.pc.ontrack = null;
      session.pc.onconnectionstatechange = null;
      session.pc.onnegotiationneeded = null;
      session.pc.close();
    } catch {}
    peerSessionsRef.current.delete(peerConnectionId);
    setRemoteVideos((current) => {
      if (!current[peerConnectionId]) return current;
      const next = { ...current };
      delete next[peerConnectionId];
      return next;
    });
  };

  const closeAllPeers = () => {
    for (const peerConnectionId of [...peerSessionsRef.current.keys()]) {
      closePeer(peerConnectionId);
    }
  };

  const stopMicrophone = () => {
    for (const track of localStreamRef.current?.getTracks() ?? []) {
      track.stop();
    }
    localStreamRef.current = null;
  };


  const stopCamera = () => {
    const stream = localCameraStreamRef.current;
    if (!stream) {
      setCameraSharing(false);
      return;
    }

    localCameraStreamRef.current = null;
    const trackIds = new Set(stream.getTracks().map((track) => track.id));

    for (const session of peerSessionsRef.current.values()) {
      for (const sender of session.pc.getSenders()) {
        if (sender.track && trackIds.has(sender.track.id)) {
          try {
            session.pc.removeTrack(sender);
          } catch {}
          
        }
      }
    }

    for (const track of stream.getTracks()) {
      try {
        track.stop();
      } catch {}
    }

    setCameraSharing(false);
    if (voiceChannelRef.current !== null) {
      {
        send({ type: "VOICE_CAMERA_STATE", cameraSharing: false });
      }
    }
  };

  const stopScreenShare = () => {
    const stream = localScreenStreamRef.current;
    if (!stream) {
      setScreenSharing(false);
      return;
    }

    localScreenStreamRef.current = null;
    const trackIds = new Set(stream.getTracks().map((track) => track.id));

    for (const session of peerSessionsRef.current.values()) {
      for (const sender of session.pc.getSenders()) {
        if (sender.track && trackIds.has(sender.track.id)) {
          try {
            session.pc.removeTrack(sender);
          } catch {}
          
        }
      }
    }

    for (const track of stream.getTracks()) {
      try {
        track.stop();
      } catch {}
    }

    setScreenSharing(false);
    setScreenShareError("");
    if (voiceChannelRef.current !== null) {
      {
        send({ type: "VOICE_SCREEN_STATE", screenSharing: false });
      }
    }
  };

  const resetVoiceLocal = (keepError = false, preserveRecovery = false) => {
    voiceOperationGenerationRef.current += 1;
    captureOperationRef.current += 1;
    if (!preserveRecovery) clearVoiceRecovery();
    else if (voiceRecoveryRef.current) voiceRecoveryRef.current.generation = voiceOperationGenerationRef.current;
    clearJoinTimeout();
    
    
    stopCamera();
    stopScreenShare();
    closeAllPeers();
    stopMicrophone();
    iceServersRef.current = fallbackIceServers;
    voiceChannelRef.current = null;
    pendingVoiceChannelRef.current = null;
    participantsRef.current = [];
    setVoiceChannelId(null);
    setVoiceOwnerGeneration(null);
    setParticipants([]);
    setRemoteVideos({});
    setVoiceStatus("disconnected");
    setCaptureStatus("inactive");
    setCaptureStatusMessage("");
    setSpeakingUserIds([]);
    setSpeakingAvailable(false);
    mutedRef.current = false;
    deafenedRef.current = false;
    serverMutedRef.current = false;
    serverDeafenedRef.current = false;
    locallyMutedUserIdsRef.current = new Set();
    setLocallyMutedUserIds([]);
    setMuted(false);
    setDeafened(false);
    setServerMuted(false);
    setServerDeafened(false);
    setCameraSharing(false);
    setScreenSharing(false);
    setScreenShareError("");
    if (!keepError) setVoiceError("");
  };

  const failVoice = (cause: unknown, fallback: string) => {
    const message = errorMessage(cause, fallback);
    console.warn(message, cause);
    if (voiceChannelRef.current !== null) {
      send({ type: "VOICE_LEAVE" });
    }
    setVoiceError(message);
    resetVoiceLocal(true);
  };

  const upsertParticipant = (participant: VoiceParticipant) => {
    const session = peerSessionsRef.current.get(participant.connectionId);
    if (session) {
      session.participant = participant;
      setSessionRemoteAudioEnabled(session);
    }

    setParticipants((current) => {
      const index = current.findIndex(
        (item) => item.connectionId === participant.connectionId,
      );
      const next = index < 0 ? [...current, participant] : [...current];
      if (index >= 0) next[index] = participant;
      participantsRef.current = next;
      return next;
    });
  };

  const addLocalTracksToPeer = async (session: PeerSession): Promise<void> => {
    const existingTrackIds = new Set(
      session.pc
        .getSenders()
        .map((sender) => sender.track?.id)
        .filter((id): id is string => Boolean(id)),
    );

    const audioStream = localStreamRef.current;
    if (audioStream) {
      for (const track of audioStream.getAudioTracks()) {
        if (!existingTrackIds.has(track.id)) {
          session.pc.addTrack(track, audioStream);
          existingTrackIds.add(track.id);
        }
      }
    }

    const cameraStream = localCameraStreamRef.current;
    if (cameraStream) {
      for (const track of cameraStream.getVideoTracks()) {
        if (!existingTrackIds.has(track.id)) {
          session.pc.addTrack(track, cameraStream);
          existingTrackIds.add(track.id);
        }
      }
    }

    const screenStream = localScreenStreamRef.current;
    if (screenStream) {
      for (const track of screenStream.getVideoTracks()) {
        if (!existingTrackIds.has(track.id)) {
          session.pc.addTrack(track, screenStream);
          existingTrackIds.add(track.id);
        }
      }
    }
  };

  const queueLocalTracksToPeer = (session: PeerSession): Promise<void> => {
    session.localTrackSetup = session.localTrackSetup.then(() => addLocalTracksToPeer(session));
    return session.localTrackSetup;
  };

  const enqueuePeerSignaling = (
    session: PeerSession,
    operation: () => Promise<void>,
  ): Promise<void> => {
    const next = session.signalingQueue.then(operation, operation);
    session.signalingQueue = next.then(() => undefined, () => undefined);
    return next;
  };

  const sendDescription = (
    targetConnectionId: string,
    description: RTCSessionDescription | null,
  ): boolean => {
    if (!description) return false;
    
    return send({
      type: "RTC_DESCRIPTION",
      targetConnectionId,
      description: {
        type: description.type,
        sdp: description.sdp,
      },
    });
  };

  const publishRemoteVideo = (session: PeerSession, track: MediaStreamTrack) => {
    const videoStream = new MediaStream();
    videoStream.addTrack(track);
    setRemoteVideos((current) => ({
      ...current,
      [session.participant.connectionId]: {
        connectionId: session.participant.connectionId,
        userId: session.participant.userId,
        username: session.participant.username,
        stream: videoStream,
      },
    }));

    const videoTrack = track as MediaStreamTrack & { onended?: (() => void) | null };
    videoTrack.onended = () => {
      setRemoteVideos((current) => {
        if (!current[session.participant.connectionId]) return current;
        const next = { ...current };
        delete next[session.participant.connectionId];
        return next;
      });
    };
  };

  const flushPendingCandidates = async (session: PeerSession) => {
    if (!session.pc.remoteDescription) return;
    const pending = [...session.pendingCandidates];
    session.pendingCandidates = [];

    for (const candidate of pending) {
      try {
        await session.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        if (!session.ignoreOffer) {
          
          console.warn("Could not apply queued voice ICE candidate.", error);
        }
      }
    }
  };

  const ensurePeer = (participant: VoiceParticipant): PeerSession => {
    const existing = peerSessionsRef.current.get(participant.connectionId);
    if (existing) {
      existing.participant = participant;
      void queueLocalTracksToPeer(existing).catch((cause) => {
        console.warn("Could not add local voice tracks.", cause);
      });
      setSessionRemoteAudioEnabled(existing);
      return existing;
    }

    if (!hasUsableRelayIceServers(iceServersRef.current)) {
      setVoiceError("Voice is temporarily unavailable. We couldn't reach the secure voice relay. Please try again in a few minutes.");
      throw new Error("Voice is temporarily unavailable. We couldn't reach the secure voice relay. Please try again in a few minutes.");
    }

    

    const pc = new RTCPeerConnection({
      ...({}),
      iceServers: iceServersRef.current,
      iceTransportPolicy: "relay",
      iceCandidatePoolSize: 2,
      bundlePolicy: "max-bundle",
    });

    const selfId = connectionId ?? "";
    const session: PeerSession = {
      pc,
      participant,
      polite: selfId > participant.connectionId,
      signalingQueue: Promise.resolve(),
      makingOffer: false,
      ignoreOffer: false,
      isSettingRemoteAnswerPending: false,
      remoteDescriptionPending: false,
      remoteAudioTracks: [],
      pendingCandidates: [],
      localTrackSetup: Promise.resolve(),
      attachedAudioReceiverIds: new Set(),
      attachedVideoReceiverIds: new Set(),
      recoveryAttempts: 0,
      recoveryTimer: null,
    };

    peerSessionsRef.current.set(participant.connectionId, session);

    pc.onicecandidate = (event: { candidate: RTCIceCandidate | null }) => {
      if (!event.candidate) return;
      {
        send({
          type: "RTC_ICE_CANDIDATE",
          targetConnectionId: participant.connectionId,
          candidate: event.candidate.toJSON(),
        });
      }
    };

    pc.ontrack = (event: any) => {
      

      if (event.track.kind === "audio") {
        if (!session.remoteAudioTracks.some((track) => track.id === event.track.id)) {
          session.remoteAudioTracks.push(event.track);
        }
        setSessionRemoteAudioEnabled(session);
        return;
      }

      if (event.track.kind === "video") publishRemoteVideo(session, event.track);
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        session.recoveryAttempts = 0;
        setRecoveryState("idle");
        setRecoveryAttempt(0);
        return;
      }
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
        schedulePeerRecovery(session);
      } else if (pc.connectionState === "closed") {
        closePeer(participant.connectionId);
      }
    };

    (pc as any).oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "failed" || pc.iceConnectionState === "disconnected") {
        schedulePeerRecovery(session);
      }
    };

    pc.onnegotiationneeded = () => {
      void enqueuePeerSignaling(session, async () => {
        try {
          session.makingOffer = true;
          await queueLocalTracksToPeer(session);
          if (pc.signalingState !== "stable") return;
          await pc.setLocalDescription();
          if (!sendDescription(participant.connectionId, pc.localDescription)) {
            throw new Error("Realtime is not connected.");
          }
        } catch (cause) {
          {
            console.warn("Voice WebRTC negotiation failed.", cause);
          }
        } finally {
          session.makingOffer = false;
        }
      });
    };

    void queueLocalTracksToPeer(session).catch((cause) => {
      console.warn("Could not add local voice tracks.", cause);
    });
    return session;
  };

  const schedulePeerRecovery = (session: PeerSession) => {
    if (
      session.recoveryTimer ||
      !peerSessionsRef.current.has(session.participant.connectionId) ||
      voiceChannelRef.current === null
    ) return;

    const attempt = session.recoveryAttempts;
    if (attempt >= MAX_PEER_RECOVERY_ATTEMPTS) {
      closePeer(session.participant.connectionId);
      setVoiceError("A participant's voice connection could not recover. Leave and rejoin to try again.");
      
      return;
    }

    const operationGeneration = voiceOperationGenerationRef.current;
    const delay = PEER_RECOVERY_DELAYS_MS[attempt] ?? PEER_RECOVERY_DELAYS_MS.at(-1)!;
    session.recoveryAttempts += 1;
    setRecoveryState("reconnecting");
    setRecoveryAttempt(session.recoveryAttempts);
    setVoiceError(`Voice connection interrupted. Reconnecting (attempt ${session.recoveryAttempts}/${MAX_PEER_RECOVERY_ATTEMPTS})…`);

    session.recoveryTimer = setTimeout(() => {
      session.recoveryTimer = null;
      if (
        operationGeneration !== voiceOperationGenerationRef.current ||
        voiceChannelRef.current === null ||
        !peerSessionsRef.current.has(session.participant.connectionId)
      ) return;

      void enqueuePeerSignaling(session, async () => {
        const pc = session.pc as any;
        if (pc.connectionState === "closed") return;
        await queueLocalTracksToPeer(session);
        if (typeof pc.restartIce === "function") {
          pc.restartIce();
          await pc.setLocalDescription();
        } else if (typeof pc.createOffer === "function") {
          const offer = await pc.createOffer({ iceRestart: true });
          await pc.setLocalDescription(offer);
        } else {
          throw new Error("This mobile WebRTC runtime cannot restart ICE.");
        }
        if (!sendDescription(session.participant.connectionId, pc.localDescription)) {
          throw new Error("Realtime is not connected while recovering voice.");
        }
      }).catch(() => {
        if (operationGeneration === voiceOperationGenerationRef.current) {
          schedulePeerRecovery(session);
        }
      });
    }, delay);
  };

  const handleDescription = async (
    participant: VoiceParticipant,
    description: DescriptionPayload,
  ) => {
    
    
    const session = ensurePeer(participant);
    await enqueuePeerSignaling(session, async () => {
      const { pc } = session;

      try {
        // Local track installation can itself trigger negotiationneeded. Keep
        // it inside the same per-peer operation so SDP cannot overlap it.
        await queueLocalTracksToPeer(session);
        const readyForOffer =
          !session.makingOffer &&
          (pc.signalingState === "stable" || session.isSettingRemoteAnswerPending);
        const offerCollision = description.type === "offer" && !readyForOffer;

        session.ignoreOffer = !session.polite && offerCollision;
        if (session.ignoreOffer) return;

        session.isSettingRemoteAnswerPending = description.type === "answer";
        session.remoteDescriptionPending = true;
        await pc.setRemoteDescription(new RTCSessionDescription(description));
        session.remoteDescriptionPending = false;
        
        session.isSettingRemoteAnswerPending = false;
        
        await flushPendingCandidates(session);

        if (description.type === "offer") {
          await pc.setLocalDescription();
          
          
          if (!sendDescription(participant.connectionId, pc.localDescription)) {
            throw new Error("Realtime is not connected.");
          }
        }
      } catch (cause) {
        session.remoteDescriptionPending = false;
        session.isSettingRemoteAnswerPending = false;
        {
          console.warn("Could not apply voice session description.", cause);
        }
      }
    });
  };

  const handleCandidate = async (
    participant: VoiceParticipant,
    candidate: CandidatePayload,
  ) => {
    
    
    const session = ensurePeer(participant);
    await enqueuePeerSignaling(session, async () => {
      if (!session.pc.remoteDescription || session.remoteDescriptionPending) {
        if (session.pendingCandidates.length >= 128) session.pendingCandidates.shift();
        session.pendingCandidates.push(candidate);
        return;
      }

      try {
        await session.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (cause) {
        if (!session.ignoreOffer) {
          {
            console.warn("Could not apply voice ICE candidate.", cause);
          }
        }
      }
    });
  };

  const requestMicrophone = async (): Promise<boolean> => {
    if (Platform.OS === "ios") {
      // Explain before the one-time iOS prompt; once decided, let WebRTC handle it.
      const current = await getRecordingPermissionsAsync().catch(() => null);
      if (current?.status !== "undetermined") return true;
      const go = await primePermission(
        "Talk in voice rooms",
        "DeCave uses your microphone only while you're in a voice room or call. You can mute any time.",
        "Continue",
      );
      if (!go) return false;
      const result = await requestRecordingPermissionsAsync().catch(() => null);
      return result?.granted ?? true;
    }
    if (Platform.OS !== "android") return true;

    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      {
        title: "DeCave microphone access",
        message: "DeCave needs your microphone so you can talk in voice rooms.",
        buttonPositive: "Allow",
        buttonNegative: "Not now",
      },
    );

    return result === PermissionsAndroid.RESULTS.GRANTED;
  };

  const replaceMicrophoneTrack = async (
    settings: CaptureSettings,
    operation: number,
  ): Promise<boolean> => {
    const previousStream = localStreamRef.current;
    const previousTrack = previousStream?.getAudioTracks()[0];
    if (!previousStream || !previousTrack) return false;

    const replacement = await mediaDevices.getUserMedia({
      audio: captureConstraints(settings) as any,
      video: false,
    });
    const replacementTrack = replacement.getAudioTracks()[0];
    if (!replacementTrack) {
      for (const track of replacement.getTracks()) track.stop();
      throw new Error("The microphone replacement did not create an audio track.");
    }
    if (operation !== captureOperationRef.current) {
      for (const track of replacement.getTracks()) track.stop();
      return false;
    }

    const replaced: Array<{ sender: any; oldTrack: MediaStreamTrack }> = [];
    try {
      for (const session of peerSessionsRef.current.values()) {
        for (const sender of session.pc.getSenders()) {
          if (sender.track?.id !== previousTrack.id || typeof sender.replaceTrack !== "function") continue;
          await sender.replaceTrack(replacementTrack);
          replaced.push({ sender, oldTrack: previousTrack });
        }
      }
    } catch (cause) {
      for (const item of replaced.reverse()) {
        try { await item.sender.replaceTrack(item.oldTrack); } catch {}
      }
      for (const track of replacement.getTracks()) track.stop();
      throw cause;
    }

    localStreamRef.current = replacement;
    for (const track of previousStream.getTracks()) {
      try { track.stop(); } catch {}
    }
    setLocalTrackEnabled();
    const report = captureReport(replacementTrack, settings);
    setCaptureStatus(report.includes("unsupported processing") ? "unsupported" : "replaced");
    setCaptureStatusMessage(report);
    return true;
  };

  const applyActiveVoiceSettings = async (settings: CaptureSettings) => {
    const stream = localStreamRef.current;
    const track = stream?.getAudioTracks()[0] as CaptureTrack | undefined;
    if (!stream || !track) return;

    const operation = ++captureOperationRef.current;
    setCaptureStatus("applying");
    setCaptureStatusMessage("Applying microphone processing to the active call…");

    if (typeof track.applyConstraints === "function") {
      try {
        await track.applyConstraints(captureConstraints(settings));
        if (operation !== captureOperationRef.current) return;
        setLocalTrackEnabled();
        const report = captureReport(track, settings);
        setCaptureStatus(report.includes("unsupported processing") ? "unsupported" : "applied");
        setCaptureStatusMessage(report);
        return;
      } catch (cause) {
        console.warn("Active microphone constraints were rejected; replacing the track.", cause);
      }
    }

    try {
      const replaced = await replaceMicrophoneTrack(settings, operation);
      if (!replaced && operation === captureOperationRef.current) {
        setCaptureStatus("unsupported");
        setCaptureStatusMessage("This mobile WebRTC runtime cannot change microphone processing during a call. Leave and rejoin to apply it.");
      }
    } catch (cause) {
      if (operation !== captureOperationRef.current) return;
      console.warn("Could not replace the active microphone track.", cause);
      setCaptureStatus("unsupported");
      setCaptureStatusMessage("Microphone processing could not be changed during this call. Leave and rejoin to apply it.");
      setVoiceError("Microphone settings could not be applied. Leave and rejoin to try again.");
    }
  };

  const ensureMicrophone = async (expectedGeneration?: number): Promise<boolean> => {
    if (
      expectedGeneration !== undefined &&
      expectedGeneration !== voiceOperationGenerationRef.current
    ) return false;
    if (localStreamRef.current) {
      setLocalTrackEnabled();
      return true;
    }

    const allowed = await requestMicrophone();
    if (!allowed) {
      setVoiceError("Microphone permission is required to join a voice room.");
      return false;
    }

    try {
      const capture = voiceSettingsRef.current;
      const stream = await mediaDevices.getUserMedia({
        audio: captureConstraints(capture) as any,
        video: false,
      });
      if (
        expectedGeneration !== undefined &&
        expectedGeneration !== voiceOperationGenerationRef.current
      ) {
        for (const track of stream.getTracks()) track.stop();
        return false;
      }
      localStreamRef.current = stream;
      const track = stream.getAudioTracks()[0];
      if (!track) {
        for (const current of stream.getTracks()) current.stop();
        throw new Error("The microphone did not create an audio track.");
      }
      const report = captureReport(track, capture);
      setCaptureStatus(report.includes("unsupported processing") ? "unsupported" : "applied");
      setCaptureStatusMessage(report);
      setLocalTrackEnabled();
      return true;
    } catch (error) {
      console.warn("Could not open microphone.", error);
      setVoiceError("DeCave could not open your microphone.");
      return false;
    }
  };

  const loadIceServers = async () => {
    if (!token) return;
    try {
      const data = await apiJson<{ iceServers?: IceServer[] }>(
        "/api/rtc/ice-servers",
        {},
        token,
      );
      if (hasUsableRelayIceServers(data.iceServers)) {
        iceServersRef.current = data.iceServers ?? [];
      } else {
        iceServersRef.current = [];
        throw new Error("Voice is temporarily unavailable. We couldn't reach the secure voice relay. Please try again in a few minutes.");
      }
    } catch {
      iceServersRef.current = [];
      throw new Error("Voice is temporarily unavailable. We couldn't reach the secure voice relay. Please try again in a few minutes.");
    }
  };

  const joinVoice = async (channelId: number): Promise<boolean> => {
    if (!Number.isSafeInteger(channelId) || channelId <= 0) return false;

    if (connectionState !== "connected" || !connectionId) {
      setVoiceError("DeCave realtime is still connecting. Try again in a moment.");
      return false;
    }

    if (voiceChannelRef.current === channelId && voiceStatus === "connected") return true;
    if (voiceChannelRef.current !== null && voiceChannelRef.current !== channelId) {
      {
        send({ type: "VOICE_LEAVE" });
      }
      resetVoiceLocal();
    }

    const operationGeneration = ++voiceOperationGenerationRef.current;
    pendingVoiceChannelRef.current = channelId;
    setVoiceError("");
    setVoiceStatus("joining");
    setRecoveryState("idle");
    setRecoveryAttempt(0);

    if (!(await ensureMicrophone(operationGeneration))) {
      if (operationGeneration !== voiceOperationGenerationRef.current) return false;
      if (preserveVoiceRecoveryAfterJoinFailure(channelId, "Microphone could not be reopened while recovering voice.")) return false;
      setVoiceStatus("disconnected");
      return false;
    }
    if (operationGeneration !== voiceOperationGenerationRef.current) return false;

    try {
      {
        await loadIceServers();
        if (!send({ type: "VOICE_JOIN", channelId })) {
          throw new Error("Could not send the voice join request.");
        }
      }
    } catch (cause) {
      if (operationGeneration !== voiceOperationGenerationRef.current) return false;
      const message = errorMessage(cause, "Could not join voice.");
      if (preserveVoiceRecoveryAfterJoinFailure(channelId, message)) return false;
      resetVoiceLocal(true);
      setVoiceError(message);
      return false;
    }

    clearJoinTimeout();
    joinTimeoutRef.current = setTimeout(() => {
      if (
        operationGeneration !== voiceOperationGenerationRef.current ||
        voiceChannelRef.current === channelId
      ) return;
      if (voiceRecoveryRef.current?.channelId === channelId) {
        preserveVoiceRecoveryAfterJoinFailure(
          channelId,
          "Voice recovery timed out. Trying again while realtime remains connected…",
        );
        return;
      }
      failVoice(
        new Error("Voice-room join acknowledgement timed out."),
        "Voice join timed out. Realtime is connected, but the room did not confirm the join. Tap Retry.",
      );
    }, 10000);

    return true;
  };

  const beginVoiceRecovery = () => {
    const channelId = voiceChannelRef.current ?? pendingVoiceChannelRef.current;
    if (!channelId || voiceRecoveryRef.current) return;

    voiceOperationGenerationRef.current += 1;
    clearJoinTimeout();
    stopCamera();
    stopScreenShare();
    closeAllPeers();
    voiceChannelRef.current = null;
    pendingVoiceChannelRef.current = channelId;
    setVoiceChannelId(null);
    setParticipants([]);
    participantsRef.current = [];
    setRemoteVideos({});
    setVoiceStatus("joining");
    setVoiceError("Voice realtime disconnected. Reconnecting to the room…");
    setRecoveryState("reconnecting");
    setRecoveryAttempt(0);
    voiceRecoveryRef.current = {
      channelId,
      attempts: 0,
      generation: voiceOperationGenerationRef.current,
      timer: null,
    };
  };

  const scheduleVoiceRecovery = () => {
    const recovery = voiceRecoveryRef.current;
    if (!recovery || recovery.timer || realtimeConnectionStateRef.current !== "connected") return;

    if (recovery.attempts >= VOICE_RECOVERY_DELAYS_MS.length) {
      setRecoveryState("failed");
      setVoiceStatus("disconnected");
      setVoiceError("Voice could not recover after three attempts. Tap Retry to rejoin this room.");
      return;
    }

    const delay = VOICE_RECOVERY_DELAYS_MS[recovery.attempts];
    recovery.attempts += 1;
    const attempt = recovery.attempts;
    setRecoveryAttempt(attempt);
    setRecoveryState("reconnecting");
    setVoiceError(`Reconnecting to voice (attempt ${attempt}/${VOICE_RECOVERY_DELAYS_MS.length})…`);
    recovery.timer = setTimeout(() => {
      recovery.timer = null;
      if (
        voiceRecoveryRef.current !== recovery ||
        recovery.generation !== voiceOperationGenerationRef.current ||
        realtimeConnectionStateRef.current !== "connected"
      ) return;
      void joinVoice(recovery.channelId).then((started) => {
        if (!started && voiceRecoveryRef.current === recovery) scheduleVoiceRecovery();
      });
    }, delay);
  };

  const preserveVoiceRecoveryAfterJoinFailure = (channelId: number, message: string) => {
    const recovery = voiceRecoveryRef.current;
    if (!recovery || recovery.channelId !== channelId) return false;
    resetVoiceLocal(true, true);
    setVoiceStatus("disconnected");
    setVoiceError(message);
    scheduleVoiceRecovery();
    return true;
  };

  const retryVoice = () => {
    const channelId = voiceRecoveryRef.current?.channelId ?? pendingVoiceChannelRef.current;
    if (!channelId || realtimeConnectionStateRef.current !== "connected") return;
    clearVoiceRecovery();
    pendingVoiceChannelRef.current = null;
    void joinVoice(channelId);
  };

  const leaveVoice = () => {
    if (voiceChannelRef.current !== null) {
        send({ type: "VOICE_LEAVE" });
    }
    resetVoiceLocal();
  };

  const toggleMute = () => {
    if (voiceChannelRef.current === null) return;
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    setLocalTrackEnabled();
    send({ type: "VOICE_MUTE", muted: next });
  };

  const toggleDeafen = () => {
    if (voiceChannelRef.current === null) return;
    const next = !deafenedRef.current;
    deafenedRef.current = next;
    setDeafened(next);
    setRemoteTrackEnabled();
    send({ type: "VOICE_DEAFEN", deafened: next });
  };

  const toggleLocalUserMute = (userId: string) => {
    if (!userId || userId === user?.id) return;
    const next = new Set(locallyMutedUserIdsRef.current);
    if (next.has(userId)) next.delete(userId);
    else next.add(userId);
    locallyMutedUserIdsRef.current = next;
    setLocallyMutedUserIds([...next]);
    setRemoteTrackEnabled();
  };

  const setUserVolume = (userId: string, volume: number) => {
    if (!userId || userId === user?.id) return;
    const clamped = Math.max(0, Math.min(2, volume));
    userVolumesRef.current = { ...userVolumesRef.current, [userId]: clamped };
    setUserVolumes(userVolumesRef.current);
    for (const session of peerSessionsRef.current.values()) {
      if (session.participant.userId === userId) setSessionRemoteAudioEnabled(session);
    }
  };

  const moderateParticipant = (
    targetConnectionId: string,
    action: VoiceModerationAction,
  ) => {
    if (voiceChannelRef.current === null || !targetConnectionId) return;
    send({ type: "VOICE_MODERATE", targetConnectionId, action });
  };

  const requestCamera = async (): Promise<boolean> => {
    if (Platform.OS !== "android") return true;
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.CAMERA,
      {
        title: "DeCave camera access",
        message: "DeCave needs camera access when you turn on video in a Voice Room.",
        buttonPositive: "Allow",
        buttonNegative: "Not now",
      },
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  };

  const startCamera = async (): Promise<boolean> => {
    if (voiceChannelRef.current === null) {
      setVoiceError("Join a Voice Room before turning on your camera.");
      return false;
    }
    if (localCameraStreamRef.current) return true;

    if (localScreenStreamRef.current) stopScreenShare();
    const allowed = await requestCamera();
    if (!allowed) {
      setVoiceError("Camera permission is required to turn on video.");
      return false;
    }

    let camera: MediaStream;
    try {
      camera = await mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: "user" } as any,
      });
    } catch (cause) {
      console.warn("Could not open camera for Hub voice.", cause);
      setVoiceError(errorMessage(cause, "DeCave could not open your camera."));
      return false;
    }

    const videoTrack = camera.getVideoTracks()[0];
    if (!videoTrack) {
      for (const track of camera.getTracks()) track.stop();
      setVoiceError("No camera video track was created.");
      return false;
    }

    try {
      if (!send({ type: "VOICE_CAMERA_STATE", cameraSharing: true })) {
        throw new Error("Realtime disconnected before camera state was published.");
      }

      localCameraStreamRef.current = camera;
      setCameraSharing(true);
      setVoiceError("");
      for (const session of peerSessionsRef.current.values()) {
        await queueLocalTracksToPeer(session);
      }

      const cameraTrack = videoTrack as MediaStreamTrack & { onended?: (() => void) | null };
      cameraTrack.onended = () => stopCamera();
      return true;
    } catch (cause) {
      for (const track of camera.getTracks()) { try { track.stop(); } catch {} }
      localCameraStreamRef.current = null;
      setCameraSharing(false);
      {
        setVoiceError(errorMessage(cause, "Could not start camera."));
      }
      return false;
    }
  };

  const startScreenShare = async (): Promise<boolean> => {
    if (voiceChannelRef.current === null) {
      setScreenShareError("Join a Voice Room before sharing your screen.");
      return false;
    }
    if (localScreenStreamRef.current) return true;
    if (localCameraStreamRef.current) stopCamera();

    setScreenShareError("");
    const quality = voiceSettingsRef.current.screenShareQuality;
    const resolutionScale = quality === "dataSaver" ? 0.5 : quality === "full" ? 1 : 0.75;
    const constraints = Platform.OS === "android"
      ? { video: true, android: { resolutionScale } }
      : { video: true };

    if (Platform.OS === "ios") {
      // iOS shares the whole screen through the ReplayKit broadcast extension.
      // Wait until the person starts it in the system sheet; getDisplayMedia
      // then opens the socket the extension streams its frames into.
      const started = await requestIosBroadcast();
      if (!started) return false;
      if (voiceChannelRef.current === null || localScreenStreamRef.current) return false;
    }

    let screen: MediaStream;
    try {
      // Android MediaProjection consent remains an explicit user action here.
      screen = (await (mediaDevices as any).getDisplayMedia(constraints)) as MediaStream;
    } catch (cause) {
      console.warn("Could not start mobile screen sharing.", cause);
      setScreenShareError(errorMessage(cause, "Could not start screen sharing."));
      return false;
    }

    const videoTrack = screen.getVideoTracks()[0];
    if (!videoTrack) {
      for (const track of screen.getTracks()) track.stop();
      setScreenShareError("No screen video track was created.");
      return false;
    }

    try {
      {
        send({ type: "VOICE_SCREEN_STATE", screenSharing: true });
      }

      localScreenStreamRef.current = screen;
      setScreenSharing(true);
      for (const session of peerSessionsRef.current.values()) {
        await queueLocalTracksToPeer(session);
      }

      const screenTrack = videoTrack as MediaStreamTrack & { onended?: (() => void) | null };
      screenTrack.onended = () => stopScreenShare();
      return true;
    } catch (cause) {
      for (const track of screen.getTracks()) { try { track.stop(); } catch {} }
      localScreenStreamRef.current = null;
      setScreenSharing(false);
      {
        setScreenShareError(errorMessage(cause, "Could not start screen sharing."));
      }
      return false;
    }
  };

  realtimeEventHandlerRef.current = (event: RealtimeEvent) => {
    const type = event?.type;
    if (!type) return;

    if (type === "ACCESS_REVOKED") {
      const activeChannel = voiceChannelRef.current ?? pendingVoiceChannelRef.current;
      if (activeChannel === null) return;
      if (voiceChannelRef.current !== null) {
        send({ type: "VOICE_LEAVE" });
      }
      setVoiceError("Your access changed, so voice was ended. Join a room you can access to continue.");
      resetVoiceLocal(true);
      return;
    }

    if (type === "CHANNEL_DELETED") {
      const deletedChannelId = Number(event.channelId);
      const activeChannel = voiceChannelRef.current ?? pendingVoiceChannelRef.current;
      if (!activeChannel || deletedChannelId !== activeChannel) return;
      if (voiceChannelRef.current !== null) {
        send({ type: "VOICE_LEAVE" });
      }
      setVoiceError("This voice room was deleted. Return to the Hub to choose another room.");
      resetVoiceLocal(true);
      return;
    }

    if (type === "VOICE_STATE") {
      const next = Array.isArray(event.participants)
        ? (event.participants as VoiceParticipant[])
        : [];
      
      participantsRef.current = next;
      setParticipants(next);

      const nextByConnection = new Map(next.map((participant) => [participant.connectionId, participant]));
      for (const session of peerSessionsRef.current.values()) {
        const participant = nextByConnection.get(session.participant.connectionId);
        if (participant) {
          session.participant = participant;
          setSessionRemoteAudioEnabled(session);
        }
      }

      setRemoteVideos((current) => {
        let changed = false;
        const filtered: Record<string, RemoteVoiceVideo> = {};
        for (const [id, video] of Object.entries(current)) {
          const participant = nextByConnection.get(id);
          if (participant && (participant.screenSharing || participant.cameraSharing)) filtered[id] = video;
          else changed = true;
        }
        return changed ? filtered : current;
      });
      return;
    }

    

    

    

    

    

    

    

    

    

    if (type === "VOICE_JOINED") {
      
      clearJoinTimeout();
      const channelId = Number(event.channelId);
      if (!channelId) return;

      voiceChannelRef.current = channelId;
      pendingVoiceChannelRef.current = null;
      if (voiceRecoveryRef.current?.channelId === channelId) clearVoiceRecovery();
      setVoiceChannelId(channelId);
      setVoiceOwnerGeneration(sessionGeneration);
      setVoiceStatus("connected");
      setVoiceError("");

      const startMuted = voiceSettingsRef.current.joinMuted;
      mutedRef.current = startMuted;
      deafenedRef.current = false;
      serverMutedRef.current = false;
      serverDeafenedRef.current = false;
      setMuted(startMuted);
      setDeafened(false);
      setServerMuted(false);
      setServerDeafened(false);
      setLocalTrackEnabled();
      setRemoteTrackEnabled();
      if (startMuted) send({ type: "VOICE_MUTE", muted: true });

      if (event.participant && typeof event.participant === "object") upsertParticipant(event.participant as VoiceParticipant);
      if (Array.isArray(event.peers)) {
        for (const peer of event.peers as VoiceParticipant[]) {
          if (!peer?.connectionId) continue;
          upsertParticipant(peer);
          ensurePeer(peer);
        }
      }
      return;
    }

    if (type === "VOICE_LEFT") {
      resetVoiceLocal();
      return;
    }

    if (type === "VOICE_PEER_JOINED" && event.participant && typeof event.participant === "object") {
      upsertParticipant(event.participant as VoiceParticipant);
      return;
    }

    if (type === "VOICE_PEER_LEFT") {
      const peerConnectionId = typeof event.connectionId === "string" ? event.connectionId : "";
      if (!peerConnectionId) return;
      closePeer(peerConnectionId);
      setParticipants((current) => {
        const next = current.filter((participant) => participant.connectionId !== peerConnectionId);
        participantsRef.current = next;
        return next;
      });
      return;
    }

    // DECAVE_DIRECT_CALL_RTC_GUARD
    if (type === "RTC_DESCRIPTION" && (voiceChannelRef.current === null)) return;
    if (
      type === "RTC_DESCRIPTION" &&
      event.from && typeof event.from === "object" &&
      event.description && typeof event.description === "object"
    ) {
      const description = event.description as { type?: unknown; sdp?: unknown };
      const validType = description.type === "offer" || description.type === "answer" || description.type === "pranswer" || description.type === "rollback";
      if (!validType || typeof description.sdp !== "string") {
        console.warn("Ignored malformed voice session description.");
        return;
      }
      void handleDescription(event.from as VoiceParticipant, {
        type: description.type as DescriptionPayload["type"],
        sdp: description.sdp,
      });
      return;
    }

    if (type === "RTC_ICE_CANDIDATE" && (voiceChannelRef.current === null)) return;
    if (
      type === "RTC_ICE_CANDIDATE" &&
      event.from && typeof event.from === "object" &&
      event.candidate && typeof event.candidate === "object"
    ) {
      void handleCandidate(event.from as VoiceParticipant, event.candidate as CandidatePayload);
      return;
    }

    if (type === "VOICE_MODERATION_STATE") {
      const nextServerMuted = event.serverMuted === true;
      const nextServerDeafened = event.serverDeafened === true;
      serverMutedRef.current = nextServerMuted;
      serverDeafenedRef.current = nextServerDeafened;
      setServerMuted(nextServerMuted);
      setServerDeafened(nextServerDeafened);
      setLocalTrackEnabled();
      setRemoteTrackEnabled();
      return;
    }

    if (type === "VOICE_ERROR") {
      clearJoinTimeout();
      const message = typeof event.message === "string" ? event.message : "Voice connection error.";
      setVoiceError(message);
      if (voiceChannelRef.current === null) {
        stopMicrophone();
        setVoiceStatus("disconnected");
      } else {
        {
          send({ type: "VOICE_LEAVE" });
        }
        resetVoiceLocal(true);
      }
    }
  };

  

  useEffect(
    () =>
      subscribe((event) => {
        realtimeEventHandlerRef.current(event);
      }),
    [subscribe],
  );

  useEffect(() => {
    if (voiceChannelId === null) {
      setSpeakingUserIds([]);
      setSpeakingAvailable(false);
      return;
    }

    let cancelled = false;
    const generation = voiceOperationGenerationRef.current;
    const sample = async () => {
      const next = new Set<string>();
      const rtts: number[] = [];
      let supported = false;
      for (const session of peerSessionsRef.current.values()) {
        const getStats = (session.pc as any).getStats;
        if (typeof getStats !== "function") continue;
        try {
          const report = await getStats.call(session.pc);
          const values: any[] = report instanceof Map
            ? [...report.values()]
            : typeof report?.forEach === "function"
              ? (() => { const items: any[] = []; report.forEach((value: any) => items.push(value)); return items; })()
              : [];
          for (const stat of values) {
            if (stat?.type === "candidate-pair" && (stat.nominated || stat.state === "succeeded") && typeof stat.currentRoundTripTime === "number") {
              rtts.push(stat.currentRoundTripTime * 1000);
            }
            if (
              stat?.type === "inbound-rtp" &&
              (stat.kind === "audio" || stat.mediaType === "audio") &&
              typeof stat.audioLevel === "number"
            ) {
              supported = true;
              if (stat.audioLevel >= 0.04) next.add(session.participant.userId);
            }
          }
        } catch {
          // A stats sample is optional; keep the last call state usable.
        }
      }
      if (!cancelled && generation === voiceOperationGenerationRef.current && voiceChannelRef.current === voiceChannelId) {
        setSpeakingAvailable(supported);
        // Sampled 4x a second; only re-render the tree when the speaker set changes.
        setSpeakingUserIds((current) =>
          current.length === next.size && current.every((id) => next.has(id)) ? current : [...next],
        );
        if (rtts.length) {
          rtts.sort((x, y) => x - y);
          setPingMs(Math.round(rtts[Math.floor(rtts.length / 2)]));
        } else setPingMs(null);
      }
      if (!cancelled) setTimeout(() => void sample(), 250);
    };
    void sample();
    return () => { cancelled = true; };
  }, [voiceChannelId]);

  useEffect(() => {
    voiceSettingsRef.current = voiceSettings;
    if (voiceChannelRef.current !== null && localStreamRef.current) {
      void applyActiveVoiceSettings(voiceSettings);
    }
  }, [voiceSettings]);

  // Stopping the broadcast from Control Center ends the iOS screen share.
  const stopScreenShareRef = useRef(stopScreenShare);
  stopScreenShareRef.current = stopScreenShare;
  useEffect(() => {
    const sub = ScreenBroadcast.onStopped(() => {
      if (localScreenStreamRef.current) stopScreenShareRef.current();
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    realtimeConnectionStateRef.current = connectionState;
    if (connectionState === "offline") {
      beginVoiceRecovery();
      return;
    }
    if (connectionState === "connected") scheduleVoiceRecovery();
  }, [connectionState]);

  useEffect(() => {
    if (voiceChannelRef.current !== null || voiceStatus === "joining") resetVoiceLocal();
  }, [user?.id, token]);

  useEffect(
    () => () => {
      clearJoinTimeout();
      
      
      stopCamera();
      stopScreenShare();
      closeAllPeers();
      stopMicrophone();
    },
    [],
  );

  const value = useMemo<VoiceContextValue>(
    () => ({
      voiceChannelId,
      voiceOwnerGeneration,
      sessionGeneration,
      participants,
      voiceStatus,
      voiceError,
      captureStatus,
      captureStatusMessage,
      recoveryState,
      recoveryAttempt,
      retryVoice,
      speakingUserIds,
      speakingAvailable,
      muted,
      deafened,
      serverMuted,
      serverDeafened,
      screenSharing,
      cameraSharing,
      screenShareError,
      remoteVideos,
      locallyMutedUserIds,
      userVolumes,
      setUserVolume,
      pingMs,
      joinVoice,
      leaveVoice,
      toggleMute,
      toggleDeafen,
      startCamera,
      stopCamera,
      startScreenShare,
      stopScreenShare,
      toggleLocalUserMute,
      moderateParticipant,
    }),
    [
      voiceChannelId,
      voiceOwnerGeneration,
      sessionGeneration,
      participants,
      voiceStatus,
      voiceError,
      captureStatus,
      captureStatusMessage,
      recoveryState,
      recoveryAttempt,
      retryVoice,
      speakingUserIds,
      speakingAvailable,
      muted,
      deafened,
      serverMuted,
      serverDeafened,
      screenSharing,
      cameraSharing,
      screenShareError,
      remoteVideos,
      locallyMutedUserIds,
      userVolumes,
      pingMs,
    ],
  );

  return (
    <VoiceContext.Provider value={value}>
      {children}
    </VoiceContext.Provider>
  );
}

export function useVoice(): VoiceContextValue {
  const value = useContext(VoiceContext);
  if (!value) throw new Error("useVoice must be used inside VoiceProvider");
  return value;
}
