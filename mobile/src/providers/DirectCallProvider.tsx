import { CallVerificationMark } from "@/src/providers/DmE2eeProvider";
import { callDescriptionAuth, checkCallDescription, clearCallVerdict } from "@/src/lib/e2ee/call-verification";
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Modal,
  PermissionsAndroid,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  MediaStream,
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  RTCView,
  mediaDevices,
} from "react-native-webrtc";
import { apiJson } from "@/src/lib/api";
import { hasRelayIceServer, isRelayIceCandidate, RELAY_UNAVAILABLE_MESSAGE } from "@/src/lib/rtc-relay";
import { useRealtime } from "@/src/providers/RealtimeProvider";
import { useSession } from "@/src/providers/SessionProvider";
import { colors } from "@/src/theme";
import type { RealtimeEvent, VoiceParticipant } from "@/src/types";

type CallPhase = "idle" | "ringing" | "incoming" | "connecting" | "connected";

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


type DirectCallContextValue = {
  phase: CallPhase;
  video: boolean;
  peer: VoiceParticipant | null;
  error: string;
  startCall: (targetUserId: string, video: boolean, username?: string) => Promise<boolean>;
  acceptCall: () => Promise<void>;
  declineCall: () => void;
  endCall: () => void;
};

const DirectCallContext = createContext<DirectCallContextValue | null>(null);

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function provisionalPeer(userId: string, username: string): VoiceParticipant {
  return {
    connectionId: "",
    userId,
    username: username || "Friend",
    avatarUrl: null,
    channelId: 0,
    role: null,
    muted: false,
    selfMuted: false,
    deafened: false,
    selfDeafened: false,
    serverMuted: false,
    serverDeafened: false,
    screenSharing: false,
    cameraSharing: false,
  };
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}
export function DirectCallProvider({ children }: PropsWithChildren) {
  const { token, user } = useSession();
  const { connectionState, send, subscribe } = useRealtime();
  const [phase, setPhase] = useState<CallPhase>("idle");
  const [video, setVideo] = useState(false);
  const [peer, setPeer] = useState<VoiceParticipant | null>(null);
  const [error, setError] = useState("");
  const [muted, setMuted] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [volume, setVolume] = useState(100);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  const phaseRef = useRef<CallPhase>("idle");
  const videoRef = useRef(false);
  const peerRef = useRef<VoiceParticipant | null>(null);
  const outgoingRef = useRef(false);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const pendingCandidatesRef = useRef<CandidatePayload[]>([]);
  const iceServersRef = useRef<IceServer[]>([]);
  const connectedAtRef = useRef<number | null>(null);


  const setCallPhase = (next: CallPhase) => {
    phaseRef.current = next;
    setPhase(next);
  };

  const setCallVideo = (next: boolean) => {
    videoRef.current = next;
    setVideo(next);
  };

  const setCallPeer = (next: VoiceParticipant | null) => {
    peerRef.current = next;
    setPeer(next);
  };

  const stopLocalMedia = () => {
    for (const track of localStreamRef.current?.getTracks() ?? []) {
      try {
        track.stop();
      } catch {}
    }
    localStreamRef.current = null;
    setLocalStream(null);
  };

  const closePeer = () => {
    const pc = pcRef.current;
    pcRef.current = null;
    if (pc) {
      try {
        pc.onicecandidate = null;
        pc.ontrack = null;
        pc.onconnectionstatechange = null;
        pc.close();
      } catch {}
    }
    pendingCandidatesRef.current = [];
    remoteStreamRef.current = null;
    setRemoteStream(null);
  };

  const resetLocal = (keepError = false, keepPeer = false) => {
    clearCallVerdict();
    closePeer();
    stopLocalMedia();
    outgoingRef.current = false;
    iceServersRef.current = [];
    if (!keepPeer) setCallPeer(null);
    setCallVideo(false);
    setCallPhase("idle");
    setMuted(false);
    setCameraEnabled(true);
    connectedAtRef.current = null;
    setDurationSeconds(0);
    setVolumeOpen(false);
    setMinimized(false);
    if (!keepError) setError("");
  };

  const failCall = (cause: unknown, fallback: string) => {
    const message = errorMessage(cause, fallback);
    console.warn(message, cause);
    if (phaseRef.current !== "idle") send({ type: "DM_CALL_END" });
    setError(message);
    resetLocal(true, true);
  };

  const requestMediaPermissions = async (withVideo: boolean): Promise<boolean> => {
    if (Platform.OS !== "android") return true;

    const mic = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      {
        title: "DeCave microphone access",
        message: "DeCave needs your microphone for direct calls.",
        buttonPositive: "Allow",
        buttonNegative: "Not now",
      },
    );
    if (mic !== PermissionsAndroid.RESULTS.GRANTED) return false;

    if (withVideo) {
      const camera = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.CAMERA,
        {
          title: "DeCave camera access",
          message: "DeCave needs your camera for video calls.",
          buttonPositive: "Allow",
          buttonNegative: "Not now",
        },
      );
      if (camera !== PermissionsAndroid.RESULTS.GRANTED) return false;
    }

    return true;
  };

  const ensureLocalMedia = async (withVideo: boolean): Promise<MediaStream | null> => {
    if (localStreamRef.current) return localStreamRef.current;

    const permitted = await requestMediaPermissions(withVideo);
    if (!permitted) {
      setError(withVideo ? "Microphone and camera permission are required." : "Microphone permission is required.");
      return null;
    }

    try {
      const stream = await mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        } as any,
        video: withVideo
          ? ({ facingMode: "user", width: 1280, height: 720, frameRate: 30 } as any)
          : false,
      });
      localStreamRef.current = stream;
      setLocalStream(stream);
      setMuted(false);
      setCameraEnabled(true);
      return stream;
    } catch (cause) {
      console.warn("Could not open direct-call media.", cause);
      setError("DeCave could not open your microphone or camera.");
      return null;
    }
  };

  // Calls are relay-only. Without a TURN server no connection can ever form,
  // so fail before ringing instead of falling back to STUN/peer-to-peer.
  const loadIceServers = async () => {
    let iceServers: IceServer[] = [];
    try {
      const data = await apiJson<{ iceServers?: IceServer[] }>("/api/rtc/ice-servers", {}, token);
      if (Array.isArray(data.iceServers)) iceServers = data.iceServers;
    } catch (cause) {
      console.warn("Could not load call ICE servers.", cause);
    }
    if (!hasRelayIceServer(iceServers)) {
      iceServersRef.current = [];
      throw new Error(RELAY_UNAVAILABLE_MESSAGE);
    }
    iceServersRef.current = iceServers;
  };

  const sendDescription = (targetConnectionId: string, description: any): boolean => {
    if (!description) return false;
    return send({
      type: "RTC_DESCRIPTION",
      targetConnectionId,
      description: { type: description.type, sdp: description.sdp },
      // Signed with the account key so the friend can check the DTLS fingerprints are ours.
      ...callDescriptionAuth(peerRef.current?.userId, description.sdp),
    });
  };

  const publishRemoteTrack = (track: any) => {
    const existing = remoteStreamRef.current?.getTracks() ?? [];
    const trackId = typeof track?.id === "string" ? track.id : "";
    if (trackId && existing.some((item: any) => item?.id === trackId)) return;
    const next = new MediaStream([...existing, track]);
    remoteStreamRef.current = next;
    setRemoteStream(next);
    // A remote track arrives with the answer, before any media can flow, so
    // "connected" (and the call timer) waits for onconnectionstatechange.
  };

  const ensurePeer = (participant: VoiceParticipant): RTCPeerConnection => {
    if (pcRef.current) return pcRef.current;
    // Relay-only: peers never exchange host/srflx candidates, so neither side
    // learns the other's IP address.
    const pc = new RTCPeerConnection({
      iceServers: iceServersRef.current as any,
      iceTransportPolicy: "relay",
      iceCandidatePoolSize: 2,
      bundlePolicy: "max-bundle",
    } as any);
    pcRef.current = pc;

    pc.onicecandidate = (event: any) => {
      if (!event.candidate || !isRelayIceCandidate(event.candidate)) return;
      send({
        type: "RTC_ICE_CANDIDATE",
        targetConnectionId: participant.connectionId,
        candidate: event.candidate.toJSON ? event.candidate.toJSON() : event.candidate,
      });
    };

    pc.ontrack = (event: any) => {
      if (event.track) publishRemoteTrack(event.track);
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        if (connectedAtRef.current === null) connectedAtRef.current = Date.now();
        setCallPhase("connected");
        setError("");
      } else if (pc.connectionState === "failed") {
        failCall(new Error("The direct call connection failed."), "The direct call connection failed.");
      }
    };

    const stream = localStreamRef.current;
    for (const track of stream?.getTracks() ?? []) pc.addTrack(track, stream!);
    return pc;
  };

  const flushCandidates = async () => {
    const pc = pcRef.current;
    if (!pc?.remoteDescription) return;
    const pending = pendingCandidatesRef.current.splice(0);
    for (const candidate of pending) {
      await pc.addIceCandidate(new RTCIceCandidate(candidate as any)).catch(() => {});
    }
  };

  const handleDescription = async (
    participant: VoiceParticipant,
    description: DescriptionPayload,
    auth?: unknown,
  ) => {
    if (phaseRef.current === "idle") return;
    const currentPeer = peerRef.current;
    if (currentPeer?.userId && participant.userId !== currentPeer.userId) return;
    // Direct calls are strict: with a friend who has a key, the connection must be
    // signed by it, or it could be the server in the middle. Candidates wait for the
    // remote description, so checking first keeps their order.
    const verdict = await checkCallDescription(
      { connectionId: "direct-call", userId: currentPeer?.userId || participant.userId },
      description,
      auth,
      true,
    );
    if (verdict === "rejected") {
      throw new Error(
        "This call couldn't be verified as end-to-end encrypted, so it wasn't connected. Both of you need an up-to-date DeCave that can read encrypted messages.",
      );
    }
    const media = await ensureLocalMedia(videoRef.current);
    if (!media) throw new Error("Microphone permission is required.");
    const pc = ensurePeer(participant);
    await pc.setRemoteDescription(new RTCSessionDescription(description as any));
    await flushCandidates();
    if (description.type === "offer") {
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      if (!sendDescription(participant.connectionId, pc.localDescription)) {
        throw new Error("Realtime disconnected while answering the call.");
      }
    }
  };

  const createOffer = async (participant: VoiceParticipant) => {
    const pc = ensurePeer(participant);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    if (!sendDescription(participant.connectionId, pc.localDescription)) {
      throw new Error("Realtime disconnected while starting the call.");
    }
  };

  const handleCandidate = async (candidate: CandidatePayload) => {
    const pc = pcRef.current;
    if (!pc?.remoteDescription) {
      if (pendingCandidatesRef.current.length >= 128) pendingCandidatesRef.current.shift();
      pendingCandidatesRef.current.push(candidate);
      return;
    }
    await pc.addIceCandidate(new RTCIceCandidate(candidate as any));
  };

  const startCall = async (
    targetUserId: string,
    withVideo: boolean,
    username = "Friend",
  ): Promise<boolean> => {
    if (!targetUserId || phaseRef.current !== "idle") return false;
    if (connectionState !== "connected") {
      setError("DeCave realtime is still connecting.");
      return false;
    }
    if (!token || !user?.id) {
      setError("Sign in again before starting a call.");
      return false;
    }

    setError("");
    setCallPeer(provisionalPeer(targetUserId, username));
    try {
      await loadIceServers();
      const media = await ensureLocalMedia(withVideo);
      if (!media) {
        resetLocal(true, true);
        return false;
      }
      outgoingRef.current = true;
      setCallVideo(withVideo);
      setCallPhase("ringing");
      if (!send({ type: "DM_CALL_START", targetUserId, video: withVideo })) {
        throw new Error("Realtime disconnected before the call could start.");
      }
      return true;
    } catch (cause) {
      setError(errorMessage(cause, "The call could not start."));
      resetLocal(true, true);
      return false;
    }
  };

  const acceptCall = async () => {
    if (phaseRef.current !== "incoming") return;
    setError("");
    try {
      await loadIceServers();
      const media = await ensureLocalMedia(videoRef.current);
      if (!media) {
        send({ type: "DM_CALL_DECLINE" });
        resetLocal(true, true);
        return;
      }
      setCallPhase("connecting");
      if (!send({ type: "DM_CALL_ACCEPT" })) {
        throw new Error("Realtime disconnected before the call could be accepted.");
      }
    } catch (cause) {
      failCall(cause, "The call could not be accepted.");
    }
  };

  const declineCall = () => {
    if (phaseRef.current === "incoming") send({ type: "DM_CALL_DECLINE" });
    else if (phaseRef.current !== "idle") send({ type: "DM_CALL_END" });
    resetLocal();
  };

  const endCall = () => {
    if (phaseRef.current !== "idle") send({ type: "DM_CALL_END" });
    resetLocal();
  };

  const toggleMute = () => {
    const next = !muted;
    for (const track of localStreamRef.current?.getAudioTracks() ?? []) {
      track.enabled = !next;
    }
    setMuted(next);
  };

  const toggleCamera = () => {
    const next = !cameraEnabled;
    for (const track of localStreamRef.current?.getVideoTracks() ?? []) {
      track.enabled = next;
    }
    setCameraEnabled(next);
  };

  const upgradeToVideo = async () => {
    if (phaseRef.current !== "connected") return;
    const existingTrack = localStreamRef.current?.getVideoTracks()[0];
    if (existingTrack) {
      existingTrack.enabled = true;
      setCameraEnabled(true);
      setCallVideo(true);
      return;
    }

    const permitted = await requestMediaPermissions(true);
    if (!permitted) {
      setError("Camera permission is required to switch to video.");
      return;
    }

    let cameraStream: MediaStream | null = null;
    try {
      const participant = peerRef.current;
      const pc = pcRef.current;
      const local = localStreamRef.current;
      if (!participant || !pc || !local) throw new Error("The call is not connected yet.");
      cameraStream = await mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: "user", width: 1280, height: 720, frameRate: 30 } as any,
      });
      const track = cameraStream.getVideoTracks()[0];
      if (!track) throw new Error("No camera track is available.");
      local.addTrack(track);
      pc.addTrack(track, local);
      const refreshed = new MediaStream(local.getTracks());
      localStreamRef.current = refreshed;
      setLocalStream(refreshed);
      cameraStream = null;
      setCallVideo(true);
      setCameraEnabled(true);
      send({ type: "DM_CALL_UPGRADE_VIDEO" });
      await createOffer(participant);
    } catch (cause) {
      for (const track of cameraStream?.getTracks() ?? []) {
        try { track.stop(); } catch {}
      }
      setError(errorMessage(cause, "DeCave could not open your camera."));
    }
  };

  const toggleOrStartCamera = async () => {
    if (!localStreamRef.current?.getVideoTracks().length) {
      await upgradeToVideo();
      return;
    }
    toggleCamera();
  };

  const changeVolume = (next: number) => {
    const value = Math.max(0, Math.min(100, next));
    setVolume(value);
    for (const track of remoteStreamRef.current?.getAudioTracks() ?? []) {
      track._setVolume(value / 100);
    }
  };

  const onRealtimeEvent = (event: RealtimeEvent) => {
    const type = event?.type;
    if (!type) return;

    if (type === "ACCESS_REVOKED" && phaseRef.current !== "idle") {
      setError("Your access changed, so this call was ended.");
      resetLocal(true);
      return;
    }

    if (type === "DM_CALL_RINGING") {
      outgoingRef.current = true;
      setCallVideo(event.video === true);
      if (event.peer && typeof event.peer === "object") setCallPeer(event.peer as VoiceParticipant);
      setCallPhase("ringing");
      return;
    }

    if (type === "DM_CALL_INCOMING") {
      if (phaseRef.current !== "idle") return;
      outgoingRef.current = false;
      setError("");
      setCallVideo(event.video === true);
      if (event.caller && typeof event.caller === "object") setCallPeer(event.caller as VoiceParticipant);
      setCallPhase("incoming");
      return;
    }

    if (type === "DM_CALL_ACCEPTED") {
      const acceptedPeer = event.peer && typeof event.peer === "object"
        ? (event.peer as VoiceParticipant)
        : peerRef.current;
      if (!acceptedPeer) return;
      const withVideo = event.video === true || videoRef.current;
      setCallPeer(acceptedPeer);
      setCallVideo(withVideo);
      connectedAtRef.current = Date.now();
      setDurationSeconds(0);
      setCallPhase("connecting");
      void (async () => {
        const media = await ensureLocalMedia(withVideo);
        if (!media) throw new Error("Microphone permission is required.");
        ensurePeer(acceptedPeer);
        if (outgoingRef.current) await createOffer(acceptedPeer);
      })().catch((cause) => failCall(cause, "Call negotiation failed."));
      return;
    }

    if (type === "RTC_DESCRIPTION" && phaseRef.current !== "idle") {
      const from = event.from as VoiceParticipant | undefined;
      const description = event.description as DescriptionPayload | undefined;
      if (!from?.connectionId || !description?.type || !description.sdp) return;
      void handleDescription(from, description, event.auth).catch((cause) => failCall(cause, "Call negotiation failed."));
      return;
    }

    if (type === "RTC_ICE_CANDIDATE" && phaseRef.current !== "idle") {
      const candidate = event.candidate as CandidatePayload | undefined;
      if (!candidate?.candidate || !isRelayIceCandidate(candidate)) return;
      void handleCandidate(candidate).catch(() => {});
      return;
    }

    if (type === "DM_CALL_VIDEO_UPGRADED" && phaseRef.current !== "idle") {
      setCallVideo(true);
      if (!localStreamRef.current?.getVideoTracks().length) setCameraEnabled(false);
      return;
    }

    if (type === "DM_CALL_ERROR") {
      if (event.peer && typeof event.peer === "object") setCallPeer(event.peer as VoiceParticipant);
      setError(typeof event.message === "string" ? event.message : "Direct call failed.");
      resetLocal(true, true);
      return;
    }

    // Already ended here (a failed call, such as one refused for failing its
    // encryption check): the server's confirmation must not wipe the explanation.
    if ((type === "DM_CALL_ENDED" || type === "DM_CALL_DECLINED") && phaseRef.current !== "idle") {
      resetLocal();
    }
  };

  const handlerRef = useRef(onRealtimeEvent);
  handlerRef.current = onRealtimeEvent;

  useEffect(
    () =>
      subscribe((event) => {
        handlerRef.current(event);
      }),
    [subscribe],
  );

  useEffect(() => {
    if (connectionState !== "offline" || phaseRef.current === "idle") return;
    setError("The call ended because realtime went offline.");
    resetLocal(true);
  }, [connectionState]);

  useEffect(() => {
    if (phaseRef.current !== "idle") resetLocal();
  }, [user?.id, token]);

  useEffect(() => {
    for (const track of remoteStreamRef.current?.getAudioTracks() ?? []) {
      track._setVolume(volume / 100);
    }
  }, [remoteStream, volume]);

  useEffect(() => {
    if (phase !== "connected" && phase !== "connecting") return;
    if (connectedAtRef.current === null) connectedAtRef.current = Date.now();
    const update = () =>
      setDurationSeconds(
        Math.max(0, Math.floor((Date.now() - connectedAtRef.current!) / 1000)),
      );
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [phase]);

  useEffect(
    () => () => {
      closePeer();
      stopLocalMedia();
    },
    [],
  );

  const value = useMemo<DirectCallContextValue>(
    () => ({ phase, video, peer, error, startCall, acceptCall, declineCall, endCall }),
    [phase, video, peer, error, connectionState, token],
  );

  const peerName = peer?.username || "Friend";
  const visible = phase !== "idle" || !!error;
  const live = phase === "connected" || phase === "connecting";

  return (
    <DirectCallContext.Provider value={value}>
      {children}
      {minimized && visible && <Pressable accessibilityRole="button" style={styles.minimized} onPress={() => setMinimized(false)}><View style={styles.minimizedIcon}><Ionicons name={video ? "videocam" : "call"} size={20} color="#fff" /></View><View style={{ flex: 1 }}><Text style={styles.minimizedName} numberOfLines={1}>{peerName}</Text><Text style={styles.minimizedStatus}>{live ? formatDuration(durationSeconds) : phase === "incoming" ? "Incoming call" : phase === "ringing" ? "Ringing…" : error || "Call"} · Tap to resume</Text></View><View style={styles.liveDot} /></Pressable>}
      <Modal visible={visible && !minimized} transparent animationType="fade" onRequestClose={() => setMinimized(true)}>
        <Pressable style={styles.overlay} onPress={() => setMinimized(true)}>
          <Pressable style={styles.card} onPress={() => {}}>
            {live && <Pressable accessibilityRole="button" style={styles.minimizeButton} onPress={() => setMinimized(true)} accessibilityLabel="Minimize call"><Ionicons name="remove" size={22} color={colors.muted} /></Pressable>}
            <View style={styles.kickerRow}>
              <Ionicons name={video ? "videocam" : "call"} size={15} color={colors.cyan} />
              <Text maxFontSizeMultiplier={1.3} style={styles.kicker}>{video ? "VIDEO CALL" : "VOICE CALL"}</Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center" }}>
              <Text style={styles.name}>{peerName}</Text>
              {live && <CallVerificationMark connectionId="direct-call" />}
            </View>
            <Text style={styles.status}>
              {phase === "incoming"
                ? "Incoming call"
                : phase === "ringing"
                  ? "Ringing…"
                  : phase === "connecting"
                    ? `Connecting… · ${formatDuration(durationSeconds)}`
                    : phase === "connected"
                      ? `Connected · ${formatDuration(durationSeconds)}`
                      : error || "Call ended"}
            </Text>

            {video && phase !== "incoming" && (
              <View style={styles.videoStage}>
                {remoteStream ? (
                  <RTCView
                    streamURL={remoteStream.toURL()}
                    style={styles.remoteVideo}
                    objectFit="cover"
                  />
                ) : (
                  <View style={styles.videoPlaceholder}>
                    <Ionicons name="videocam-outline" size={34} color={colors.muted} />
                    <Text style={styles.videoPlaceholderText}>Waiting for video…</Text>
                  </View>
                )}
                {localStream && localStream.getVideoTracks().length > 0 && (
                  <RTCView
                    streamURL={localStream.toURL()}
                    style={styles.localVideo}
                    objectFit="cover"
                    mirror
                  />
                )}
              </View>
            )}

            {!!error && phase !== "idle" && <Text style={styles.error}>{error}</Text>}

            {phase === "incoming" ? (
              <View style={styles.actions}>
                <Pressable accessibilityRole="button" accessibilityLabel="Decline call" style={[styles.roundButton, styles.decline]} onPress={declineCall}>
                  <Ionicons name="call" size={23} color="#fff" style={{ transform: [{ rotate: "135deg" }] }} />
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Accept call" style={[styles.roundButton, styles.accept]} onPress={() => void acceptCall()}>
                  <Ionicons name={video ? "videocam" : "call"} size={23} color="#fff" />
                </Pressable>
              </View>
            ) : phase === "connected" || phase === "connecting" ? (
              <View style={styles.actions}>
                <Pressable accessibilityRole="button" accessibilityLabel={muted ? "Unmute" : "Mute"} style={[styles.roundButton, muted && styles.activeControl]} onPress={toggleMute}>
                  <Ionicons name={muted ? "mic-off" : "mic"} size={22} color={colors.text} />
                </Pressable>
                <View style={{ position: "relative" }}><Pressable accessibilityRole="button" style={styles.roundButton} onPress={() => setVolumeOpen((value) => !value)} accessibilityLabel="Adjust call volume"><Ionicons name={volume === 0 ? "volume-mute" : "volume-high"} size={22} color={colors.text} /></Pressable>{volumeOpen && <View style={styles.volumePopup}><Pressable accessibilityRole="button" style={styles.volumeButton} onPress={() => changeVolume(volume - 10)}><Text style={styles.volumeButtonText}>−</Text></Pressable><Text style={styles.volumeValue}>{volume}%</Text><Pressable accessibilityRole="button" style={styles.volumeButton} onPress={() => changeVolume(volume + 10)}><Text style={styles.volumeButtonText}>+</Text></Pressable></View>}</View>
                {phase === "connected" && !video && (
                  <Pressable accessibilityRole="button" accessibilityLabel="Switch to video" style={styles.roundButton} onPress={() => void upgradeToVideo()}>
                    <Ionicons name="videocam" size={22} color={colors.text} />
                  </Pressable>
                )}
                {video && (
                  <Pressable accessibilityRole="button" accessibilityLabel="Toggle camera" style={[styles.roundButton, !cameraEnabled && styles.activeControl]} onPress={() => void toggleOrStartCamera()}>
                    <Ionicons name={localStreamRef.current?.getVideoTracks().length && cameraEnabled ? "videocam" : "videocam-off"} size={22} color={colors.text} />
                  </Pressable>
                )}
                <Pressable accessibilityRole="button" accessibilityLabel="End call" style={[styles.roundButton, styles.decline]} onPress={endCall}>
                  <Ionicons name="call" size={23} color="#fff" style={{ transform: [{ rotate: "135deg" }] }} />
                </Pressable>
              </View>
            ) : (
              <Pressable accessibilityRole="button" style={styles.cancelButton} onPress={endCall}>
                <Text style={styles.cancelText}>{error ? "Close" : "Cancel call"}</Text>
              </Pressable>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </DirectCallContext.Provider>
  );
}

export function useDirectCall(): DirectCallContextValue {
  const value = useContext(DirectCallContext);
  if (!value) throw new Error("useDirectCall must be used inside DirectCallProvider");
  return value;
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    backgroundColor: "rgba(3,7,15,.84)",
  },
  card: {
    width: "100%",
    maxWidth: 430,
    padding: 20,
    borderRadius: 24,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  minimizeButton: { position: "absolute", right: 13, top: 11, width: 36, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.panel2, zIndex: 2 },
  minimized: { position: "absolute", width: 280, right: 14, bottom: 24, zIndex: 999, minHeight: 66, flexDirection: "row", alignItems: "center", gap: 11, padding: 10, borderRadius: 18, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.borderStrong },
  minimizedIcon: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: colors.violet }, minimizedName: { color: colors.text, fontSize: 12, fontWeight: "900" }, minimizedStatus: { color: colors.muted, fontSize: 13, marginTop: 3 }, liveDot: { width: 9, height: 9, borderRadius: 99, backgroundColor: colors.green },
  kickerRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  kicker: { color: colors.cyan, fontSize: 12, fontWeight: "900", letterSpacing: 1.6 },
  name: { color: colors.text, fontSize: 24, fontWeight: "900", marginTop: 12 },
  status: { color: colors.muted, fontSize: 13, marginTop: 4 },
  videoStage: {
    width: "100%",
    aspectRatio: 9 / 14,
    maxHeight: 430,
    marginTop: 18,
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  remoteVideo: { width: "100%", height: "100%" },
  videoPlaceholder: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  videoPlaceholderText: { color: colors.muted, fontSize: 12 },
  volumePopup: { position: "absolute", width: 148, left: -45, bottom: 67, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 9, borderRadius: 14, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.borderStrong },
  volumeButton: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border },
  volumeButtonText: { color: colors.text, fontSize: 18, fontWeight: "800" },
  volumeValue: { width: 42, textAlign: "center", color: colors.text, fontSize: 12, fontWeight: "900" },
  localVideo: {
    position: "absolute",
    right: 10,
    bottom: 10,
    width: 104,
    height: 144,
    borderRadius: 12,
    overflow: "hidden",
  },
  error: { color: colors.red, fontSize: 12, marginTop: 12, textAlign: "center" },
  actions: { flexDirection: "row", alignItems: "center", gap: 16, marginTop: 20 },
  roundButton: {
    width: 58,
    height: 58,
    borderRadius: 99,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.panel2,
  },
  accept: { backgroundColor: "#24b56b" },
  decline: { backgroundColor: colors.red },
  activeControl: { backgroundColor: "rgba(255,92,104,.55)" },
  cancelButton: {
    marginTop: 20,
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelText: { color: colors.text, fontSize: 12, fontWeight: "800" },});

