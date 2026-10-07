import { useEffect, useRef, useState, type ChangeEvent, type MouseEvent as ReactMouseEvent } from "react";
import { CallVerificationMark } from "../e2ee/DmEncryptionUi";
import { callDescriptionAuth, checkCallDescription, clearCallVerdict } from "../e2ee/call-verification";
import { DESKTOP_VOICE_JOIN_TIMEOUT_MS } from "../voice/desktop-voice-reliability";
import {
  applyVoiceCodecPreferences,
  applyVoiceSenderParameters,
  VOICE_OPUS_BITRATE,
  withVoiceOpusBitrate,
} from "../voice/voice-transport";
import { hasRelayIceServer, isRelayIceCandidate, RELAY_UNAVAILABLE_MESSAGE } from "../voice/relay-policy";
import { Icon } from "./Icon";
import "./DirectCallOverlay.css";
import type { RealtimeFrame, RealtimeSendWindow } from "../realtime/connection";

type Phase = "idle" | "ringing" | "incoming" | "connecting" | "connected";
type Peer = { connectionId: string; userId?: string; username?: string };
type IceServer = { urls: string | string[]; username?: string; credential?: string };
type DirectCallMicrophoneLease = {
  stream: MediaStream;
  subscribe: (listener: (stream: MediaStream) => Promise<void> | void) => () => void;
  release: () => void;
};
type DirectCallOverlayProps = {
  loadIceServers: () => Promise<IceServer[]>;
  acquireMicrophone: () => Promise<DirectCallMicrophoneLease>;
  onOverlayChange?: (open: boolean) => void;
};

function send(payload: Record<string, unknown>) {
  return (window as RealtimeSendWindow).__decaveRealtimeSend?.(payload) === true;
}

function formatDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function CallIcon({ name }: { name: "mic" | "micOff" | "volume" | "video" | "videoOff" | "phone" | "end" }) {
  if (name === "mic" || name === "micOff")
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v4M8.5 21h7" />
        {name === "micOff" && <path d="M4 4l16 16" />}
      </svg>
    );
  if (name === "volume")
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 9h4l5-4v14l-5-4H4V9Z" />
        <path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" />
      </svg>
    );
  if (name === "video" || name === "videoOff")
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="6" width="13" height="12" rx="2" />
        <path d="m16 10 5-3v10l-5-3v-4Z" />
        {name === "videoOff" && <path d="M3 3l18 18" />}
      </svg>
    );
  return (
    <svg className={name === "end" ? "end-icon" : ""} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6.6 3.2 9 2.7a1.4 1.4 0 0 1 1.6.9l1.2 2.9a1.4 1.4 0 0 1-.4 1.6L9.8 9.6a13.4 13.4 0 0 0 4.6 4.6l1.5-1.6a1.4 1.4 0 0 1 1.6-.4l2.9 1.2a1.4 1.4 0 0 1 .9 1.6l-.5 2.4a2.9 2.9 0 0 1-2.8 2.2C10.5 19.6 4.4 13.5 4.4 6A2.9 2.9 0 0 1 6.6 3.2Z" />
    </svg>
  );
}

export function DirectCallOverlay({ loadIceServers, acquireMicrophone, onOverlayChange }: DirectCallOverlayProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [video, setVideo] = useState(false);
  const [peer, setPeer] = useState<Peer | null>(null);
  const [error, setError] = useState("");
  const [muted, setMuted] = useState(false);
  const [camera, setCamera] = useState(true);
  const [volume, setVolume] = useState(100);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const phaseRef = useRef<Phase>("idle");
  const videoRef = useRef(false);
  const peerRef = useRef<Peer | null>(null);
  const outgoingRef = useRef(false);
  const localStreamRef = useRef<MediaStream | null>(null);
  const ownedAudioTrackRef = useRef<MediaStreamTrack | null>(null);
  const microphoneLeaseRef = useRef<DirectCallMicrophoneLease | null>(null);
  const unsubscribeMicrophoneRef = useRef<(() => void) | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const iceRef = useRef<IceServer[]>([]);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const remoteDescriptionPendingRef = useRef(false);
  const connectedAtRef = useRef<number | null>(null);
  const callTimeoutRef = useRef<number | null>(null);

  const setCallPhase = (value: Phase) => {
    phaseRef.current = value;
    setPhase(value);
  };
  const setCallVideo = (value: boolean) => {
    videoRef.current = value;
    setVideo(value);
  };
  const setCallPeer = (value: Peer | null) => {
    peerRef.current = value;
    setPeer(value);
  };

  const clearCallTimeout = () => {
    if (callTimeoutRef.current !== null) {
      window.clearTimeout(callTimeoutRef.current);
      callTimeoutRef.current = null;
    }
  };

  const armCallTimeout = () => {
    clearCallTimeout();
    callTimeoutRef.current = window.setTimeout(() => {
      callTimeoutRef.current = null;
      if (phaseRef.current !== "ringing" && phaseRef.current !== "connecting") return;
      send({ type: "DM_CALL_END" });
      reset(true);
      setError("The call could not connect in time. Check your connection and try again.");
    }, DESKTOP_VOICE_JOIN_TIMEOUT_MS);
  };

  const stopMedia = () => {
    for (const track of localStreamRef.current?.getTracks() ?? []) {
      // Direct calls use a clone of App's processed track, so stopping it or
      // muting it cannot change the Hub voice sender's microphone state.
      if (track.kind !== "audio" || track === ownedAudioTrackRef.current) track.stop();
    }
    ownedAudioTrackRef.current = null;
    unsubscribeMicrophoneRef.current?.();
    unsubscribeMicrophoneRef.current = null;
    microphoneLeaseRef.current?.release();
    microphoneLeaseRef.current = null;
    localStreamRef.current = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
  };

  const closePc = () => {
    if (pcRef.current) {
      pcRef.current.onicecandidate = null;
      pcRef.current.ontrack = null;
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.close();
    }
    pcRef.current = null;
    pendingIceRef.current = [];
    remoteDescriptionPendingRef.current = false;
    setRemoteStream(null);
  };

  const reset = (keepError = false, keepPeer = false) => {
    clearCallVerdict();
    clearCallTimeout();
    closePc();
    stopMedia();
    outgoingRef.current = false;
    if (!keepPeer) setCallPeer(null);
    setCallVideo(false);
    setCallPhase("idle");
    setMuted(false);
    setCamera(true);
    connectedAtRef.current = null;
    setDurationSeconds(0);
    setMinimized(false);
    setVolumeOpen(false);
    if (!keepError) setError("");
  };

  const loadIce = async (): Promise<boolean> => {
    try {
      const iceServers = await loadIceServers();
      if (!Array.isArray(iceServers) || iceServers.length === 0)
        throw new Error("No approved ICE configuration is available.");
      // Calls are relay-only: without a TURN server no connection can ever
      // form, so refuse up front instead of ringing into a call that hangs.
      if (!hasRelayIceServer(iceServers)) throw new Error(RELAY_UNAVAILABLE_MESSAGE);
      iceRef.current = iceServers;
      return true;
    } catch (cause) {
      iceRef.current = [];
      setError(cause instanceof Error ? cause.message : "Calls are unavailable.");
      return false;
    }
  };

  const ensureMedia = async (withVideo: boolean) => {
    if (localStreamRef.current) return localStreamRef.current;
    let microphoneLease: DirectCallMicrophoneLease | null = null;
    let cameraStream: MediaStream | null = null;
    try {
      microphoneLease = await acquireMicrophone();
      const microphoneStream = microphoneLease.stream;
      const sharedAudioTrack = microphoneStream.getAudioTracks()[0];
      if (!sharedAudioTrack) throw new Error("The processed microphone stream has no audio track.");
      const directAudioTrack =
        typeof sharedAudioTrack.clone === "function" ? sharedAudioTrack.clone() : sharedAudioTrack;
      ownedAudioTrackRef.current = directAudioTrack === sharedAudioTrack ? null : directAudioTrack;
      const stream = new MediaStream([directAudioTrack]);
      if (withVideo) {
        cameraStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 }, facingMode: "user" },
        });
        const cameraTrack = cameraStream.getVideoTracks()[0];
        if (!cameraTrack) throw new Error("No camera video track available.");
        stream.addTrack(cameraTrack);
      }
      localStreamRef.current = stream;
      microphoneLeaseRef.current = microphoneLease;
      unsubscribeMicrophoneRef.current = microphoneLease.subscribe(async (nextStream) => {
        const sharedNextAudioTrack = nextStream.getAudioTracks()[0];
        const local = localStreamRef.current;
        if (!sharedNextAudioTrack || !local) return;
        const nextAudioTrack =
          typeof sharedNextAudioTrack.clone === "function" ? sharedNextAudioTrack.clone() : sharedNextAudioTrack;
        const previousAudioTrack = local.getAudioTracks()[0];
        if (previousAudioTrack?.id === nextAudioTrack.id) return;
        const sender = pcRef.current?.getSenders().find((item) => item.track?.kind === "audio");
        try {
          // Await the peer connection update before changing the local stream. A rejected
          // replacement must reach the shared microphone lease so it can roll back the
          // candidate graph instead of leaving a half-swapped direct call.
          if (sender) await sender.replaceTrack(nextAudioTrack);
        } catch (cause) {
          if (nextAudioTrack !== sharedNextAudioTrack) nextAudioTrack.stop();
          throw cause instanceof Error ? cause : new Error("The direct-call microphone sender rejected the new track.");
        }
        if (previousAudioTrack) local.removeTrack(previousAudioTrack);
        if (previousAudioTrack === ownedAudioTrackRef.current) previousAudioTrack.stop();
        local.addTrack(nextAudioTrack);
        ownedAudioTrackRef.current = nextAudioTrack === sharedNextAudioTrack ? null : nextAudioTrack;
        if (sender) {
          console.info("[DeCave direct] microphone sender updated", {
            processedTrackId: nextAudioTrack.id,
            senderTrackId: sender.track?.id ?? null,
            senderUsesProcessedTrack: sender.track?.id === nextAudioTrack.id,
          });
        }
      });
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        void localVideoRef.current.play().catch(() => {});
      }
      return stream;
    } catch (cause) {
      for (const track of cameraStream?.getTracks() ?? []) track.stop();
      if (ownedAudioTrackRef.current) ownedAudioTrackRef.current.stop();
      ownedAudioTrackRef.current = null;
      if (microphoneLease) microphoneLease.release();
      console.error("Direct call media error", cause);
      setError(withVideo ? "Microphone/camera permission is required." : "Microphone permission is required.");
      return null;
    }
  };

  const ensurePc = (participant: Peer) => {
    if (pcRef.current) return pcRef.current;
    // Relay-only: peers never exchange host/srflx candidates, so neither side
    // learns the other's IP address.
    const pc = new RTCPeerConnection({ iceServers: iceRef.current, iceTransportPolicy: "relay" });
    pcRef.current = pc;
    for (const track of localStreamRef.current?.getTracks() ?? []) {
      const sender = pc.addTrack(track, localStreamRef.current!);
      if (track.kind === "audio") {
        // Same voice tuning as channels: RED preferred, priority, one listener.
        applyVoiceCodecPreferences(
          pc.getTransceivers().find((transceiver) => transceiver.sender === sender),
          RTCRtpReceiver.getCapabilities?.("audio"),
        );
        void applyVoiceSenderParameters(sender, 1);
        console.info("[DeCave direct] microphone sender bound", {
          processedTrackId: track.id,
          senderTrackId: sender.track?.id ?? null,
          senderUsesProcessedTrack: sender.track?.id === track.id,
        });
      }
    }
    pc.onicecandidate = (event) => {
      if (!event.candidate || !isRelayIceCandidate(event.candidate)) return;
      send({
        type: "RTC_ICE_CANDIDATE",
        targetConnectionId: participant.connectionId,
        candidate: event.candidate.toJSON(),
      });
    };
    pc.ontrack = (event) => {
      const signaledStream = event.streams[0];
      setRemoteStream((current) => {
        if (signaledStream) return signaledStream;
        const combined = current ? new MediaStream(current.getTracks()) : new MediaStream();
        if (!combined.getTracks().some((track) => track.id === event.track.id)) combined.addTrack(event.track);
        return combined;
      });
      // A remote track arrives with the answer, before any media can flow, so
      // "connected" (and the call timer) waits for the connection state below.
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        if (connectedAtRef.current === null) connectedAtRef.current = Date.now();
        clearCallTimeout();
        setCallPhase("connected");
        setError("");
      } else if (pc.connectionState === "failed") {
        setError("The direct call connection failed.");
      }
    };
    return pc;
  };

  const flushIce = async () => {
    const pc = pcRef.current;
    if (!pc?.remoteDescription) return;
    for (const candidate of pendingIceRef.current.splice(0)) await pc.addIceCandidate(candidate).catch(() => {});
  };

  const sendLocalDescription = (participant: Peer, pc: RTCPeerConnection) => {
    if (!pc.localDescription) return false;
    return send({
      type: "RTC_DESCRIPTION",
      targetConnectionId: participant.connectionId,
      description: { type: pc.localDescription.type, sdp: pc.localDescription.sdp },
      ...callDescriptionAuth(participant.userId, pc.localDescription.sdp),
    });
  };

  const start = async (targetUserId: string, username: string, withVideo: boolean) => {
    if (!targetUserId || phaseRef.current !== "idle") return;
    setError("");
    try {
      if (!(await loadIce())) return;
      if (!(await ensureMedia(withVideo))) return;
      setCallPeer({ connectionId: "", userId: targetUserId, username: username || "Friend" });
      outgoingRef.current = true;
      setCallVideo(withVideo);
      setCallPhase("ringing");
      armCallTimeout();
      if (!send({ type: "DM_CALL_START", targetUserId, video: withVideo }))
        throw new Error("Realtime is not connected.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The call could not start.");
      reset(true, true);
    }
  };

  const accept = async () => {
    if (phaseRef.current !== "incoming") return;
    setError("");
    try {
      if (!(await loadIce())) return;
      if (!(await ensureMedia(videoRef.current))) return;
      setCallPhase("connecting");
      armCallTimeout();
      send({ type: "DM_CALL_ACCEPT" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The call could not be accepted.");
      send({ type: "DM_CALL_DECLINE" });
      reset(true, true);
    }
  };

  const decline = () => {
    if (phaseRef.current === "incoming") send({ type: "DM_CALL_DECLINE" });
    else send({ type: "DM_CALL_END" });
    reset();
  };
  const end = () => {
    if (phaseRef.current !== "idle") send({ type: "DM_CALL_END" });
    reset();
  };

  const upgradeToVideo = async () => {
    if (phaseRef.current !== "connected") return;
    const existingTrack = localStreamRef.current?.getVideoTracks()[0];
    if (existingTrack) {
      existingTrack.enabled = true;
      setCamera(true);
      setCallVideo(true);
      return;
    }

    try {
      const cameraStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 }, facingMode: "user" },
      });
      const track = cameraStream.getVideoTracks()[0];
      const local = localStreamRef.current;
      const peerConnection = pcRef.current;
      const participant = peerRef.current;
      if (!track || !local || !peerConnection || !participant) {
        for (const item of cameraStream.getTracks()) item.stop();
        return;
      }
      local.addTrack(track);
      peerConnection.addTrack(track, local);
      setCamera(true);
      setCallVideo(true);
      send({ type: "DM_CALL_UPGRADE_VIDEO" });
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      sendLocalDescription(participant, peerConnection);
    } catch (cause) {
      console.error("Direct call camera upgrade failed", cause);
      setError("Camera permission is required to switch to video.");
    }
  };

  const toggleCamera = async () => {
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (!track) {
      await upgradeToVideo();
      return;
    }
    const next = !camera;
    track.enabled = next;
    setCamera(next);
  };

  const toggleMicrophone = () => {
    const next = !muted;
    const track = localStreamRef.current?.getAudioTracks()[0];
    const sharedTrack = microphoneLeaseRef.current?.stream.getAudioTracks()[0];
    if (track && track === sharedTrack) {
      // Older runtimes without MediaStreamTrack.clone() still keep Hub voice
      // independent by removing the direct-call sender track while muted.
      const sender = pcRef.current?.getSenders().find((item) => item.track?.kind === "audio");
      if (sender) {
        void sender.replaceTrack(next ? null : track).catch(() => {
          setMuted(!next);
          setError("The direct-call microphone could not be muted separately from Hub voice.");
        });
      } else {
        setError("The direct-call microphone could not be muted separately from Hub voice.");
        return;
      }
    } else if (track) {
      track.enabled = !next;
    }
    setMuted(next);
  };

  useEffect(() => {
    const startListener = (raw: Event) => {
      const detail = (raw as CustomEvent<{ targetUserId?: string; username?: string; video?: boolean }>).detail;
      if (detail?.targetUserId) void start(detail.targetUserId, detail.username || "Friend", detail.video === true);
    };
    const realtimeListener = (raw: Event) => {
      const data = (raw as CustomEvent<RealtimeFrame>).detail;
      if (!data?.type) return;

      if (data.type === "DM_CALL_RINGING") {
        outgoingRef.current = true;
        setCallVideo(data.video === true);
        if (data.peer) setCallPeer(data.peer);
        setCallPhase("ringing");
        armCallTimeout();
        return;
      }
      if (data.type === "DM_CALL_INCOMING") {
        if (phaseRef.current !== "idle") return;
        outgoingRef.current = false;
        setError("");
        setCallVideo(data.video === true);
        if (data.caller) setCallPeer(data.caller);
        setCallPhase("incoming");
        return;
      }
      if (data.type === "DM_CALL_ACCEPTED") {
        const accepted = (data.peer as Peer | undefined) ?? peerRef.current;
        if (!accepted) return;
        setCallPeer(accepted);
        setCallVideo(data.video === true || videoRef.current);
        connectedAtRef.current = Date.now();
        setDurationSeconds(0);
        setCallPhase("connecting");
        armCallTimeout();
        void (async () => {
          if (!(await ensureMedia(data.video === true || videoRef.current))) return;
          const pc = ensurePc(accepted);
          if (outgoingRef.current) {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            sendLocalDescription(accepted, pc);
          }
        })();
        return;
      }
      if (
        data.type === "RTC_DESCRIPTION" &&
        phaseRef.current !== "idle" &&
        data.from?.connectionId &&
        data.description?.type &&
        data.description?.sdp
      ) {
        void (async () => {
          if (!(await ensureMedia(videoRef.current))) return;
          const participant = data.from as Peer;
          // Direct calls are strict: with a friend who has a key, the connection must be
          // signed by it, or it could be the server in the middle.
          // Remembered under one key: there is one direct call at a time.
          const verdict = await checkCallDescription(
            { connectionId: "direct-call", userId: participant.userId },
            data.description as RTCSessionDescriptionInit,
            data.auth,
            true,
          );
          if (verdict === "rejected") {
            send({ type: "DM_CALL_END" });
            setError(
              "This call couldn't be verified as end-to-end encrypted, so it wasn't connected. Both of you need an up-to-date DeCave that can read encrypted messages.",
            );
            reset(true, true);
            return;
          }
          const pc = ensurePc(participant);
          remoteDescriptionPendingRef.current = true;
          await pc.setRemoteDescription(
            withVoiceOpusBitrate(data.description as RTCSessionDescriptionInit, VOICE_OPUS_BITRATE),
          );
          remoteDescriptionPendingRef.current = false;
          await flushIce();
          if (data.description.type === "offer") {
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            sendLocalDescription(participant, pc);
          }
        })().catch(() => {
          remoteDescriptionPendingRef.current = false;
          setError("Direct-call negotiation failed.");
        });
        return;
      }
      if (data.type === "RTC_ICE_CANDIDATE" && phaseRef.current !== "idle" && data.candidate) {
        if (!isRelayIceCandidate(data.candidate)) return;
        const pc = pcRef.current;
        if (!pc?.remoteDescription || remoteDescriptionPendingRef.current) {
          if (pendingIceRef.current.length >= 128) pendingIceRef.current.shift();
          pendingIceRef.current.push(data.candidate);
        } else void pc.addIceCandidate(data.candidate).catch(() => {});
        return;
      }
      if (data.type === "DM_CALL_VIDEO_UPGRADED") {
        setCallVideo(true);
        return;
      }
      if (data.type === "DM_CALL_ERROR") {
        if (data.peer) setCallPeer(data.peer as Peer);
        setError(typeof data.message === "string" ? data.message : "Direct call failed.");
        reset(true, true);
        return;
      }
      // Already ended here (for example a call refused for failing its encryption
      // check): the server's confirmation must not wipe the explanation.
      if (data.type === "DM_CALL_ENDED" && phaseRef.current !== "idle") reset();
    };
    window.addEventListener("decave-direct-call-start", startListener as EventListener);
    window.addEventListener("decave-realtime-event", realtimeListener as EventListener);
    return () => {
      window.removeEventListener("decave-direct-call-start", startListener as EventListener);
      window.removeEventListener("decave-realtime-event", realtimeListener as EventListener);
    };
  }, []);

  useEffect(() => {
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
      if (localStreamRef.current) void localVideoRef.current.play().catch(() => {});
    }
  }, [phase, video, camera]);

  useEffect(() => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream;
      if (remoteStream) void remoteVideoRef.current.play().catch(() => {});
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = remoteStream;
      if (remoteStream) void remoteAudioRef.current.play().catch(() => {});
    }
    if (remoteVideoRef.current) remoteVideoRef.current.volume = volume / 100;
    if (remoteAudioRef.current) remoteAudioRef.current.volume = volume / 100;
  }, [remoteStream, volume, video]);

  useEffect(() => {
    if (phase !== "connected" && phase !== "connecting") return;
    if (connectedAtRef.current === null) connectedAtRef.current = Date.now();
    const update = () => setDurationSeconds(Math.max(0, Math.floor((Date.now() - connectedAtRef.current!) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    const open = phase !== "idle" || Boolean(error);
    onOverlayChange?.(open);
    return () => onOverlayChange?.(false);
  }, [error, onOverlayChange, phase]);

  useEffect(
    () => () => {
      clearCallTimeout();
      closePc();
      stopMedia();
    },
    [],
  );

  if (phase === "idle" && !error) return null;
  const peerName = peer?.username || "Friend";
  const live = phase === "connected" || phase === "connecting";
  const status =
    phase === "incoming"
      ? "Incoming call"
      : phase === "ringing"
        ? "Ringing…"
        : phase === "connecting"
          ? `Connecting… · ${formatDuration(durationSeconds)}`
          : phase === "connected"
            ? formatDuration(durationSeconds)
            : error || "Call ended";
  if (minimized && live)
    return (
      <button type="button" className="direct-call-mini" onClick={() => setMinimized(false)}>
        <span className="direct-call-mini-icon">
          <Icon name={video ? "video" : "phone"} />
        </span>
        <span className="direct-call-mini-copy">
          <strong>{peerName}</strong>
          <small>{formatDuration(durationSeconds)} · Click to resume</small>
        </span>
        <span className="direct-call-mini-live" aria-label="Call live" />
      </button>
    );
  return (
    <div
      className="direct-call-backdrop"
      onClick={() => {
        if (live) setMinimized(true);
      }}
    >
      <div
        className="direct-call-card"
        role="dialog"
        aria-modal="true"
        aria-label={`${video ? "Video" : "Voice"} call with ${peerName}`}
        onClick={(event: ReactMouseEvent<HTMLDivElement>) => event.stopPropagation()}
      >
        {live && (
          <button
            type="button"
            className="ds-btn ds-btn-ghost ds-icon-btn ds-btn-sm direct-call-minimize"
            title="Minimize call"
            aria-label="Minimize call"
            onClick={() => setMinimized(true)}
          >
            <Icon name="minimize" />
          </button>
        )}
        <span className="ds-kicker">{video ? "Video call" : "Voice call"}</span>
        <h2 className="direct-call-title">
          {peerName}
          {live && <CallVerificationMark connectionId="direct-call" />}
        </h2>
        <div className={`direct-call-status${phase === "idle" && error ? " ds-text-danger" : ""}`}>{status}</div>
        {video && phase !== "incoming" && (
          <div className="direct-call-video">
            <video ref={remoteVideoRef} autoPlay playsInline className="direct-call-video-remote" />
            <video ref={localVideoRef} autoPlay muted playsInline className="direct-call-video-local" />
          </div>
        )}
        {!video && <audio ref={remoteAudioRef} autoPlay />}
        {!!error && phase !== "idle" && (
          <div className="ds-notice danger direct-call-error" role="alert">
            {error}
          </div>
        )}
        <div className="direct-call-actions">
          {phase === "incoming" ? (
            <>
              <button
                className="direct-call-round danger"
                title="Decline call"
                aria-label="Decline call"
                onClick={decline}
              >
                <CallIcon name="end" />
              </button>
              <button
                className="direct-call-round accept"
                title="Accept call"
                aria-label="Accept call"
                onClick={() => void accept()}
              >
                <CallIcon name={video ? "video" : "phone"} />
              </button>
            </>
          ) : live ? (
            <>
              <button
                className={`direct-call-round ${muted ? "active" : ""}`}
                title={muted ? "Turn microphone on" : "Mute microphone"}
                aria-label={muted ? "Unmute" : "Mute"}
                onClick={toggleMicrophone}
              >
                <CallIcon name={muted ? "micOff" : "mic"} />
              </button>
              <span className="direct-call-control-wrap">
                <button
                  className="direct-call-round"
                  title="Adjust call volume"
                  aria-label="Adjust call volume"
                  onClick={() => setVolumeOpen((value) => !value)}
                >
                  <CallIcon name="volume" />
                </button>
                {volumeOpen && (
                  <label className="direct-call-volume">
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={volume}
                      onChange={(event: ChangeEvent<HTMLInputElement>) => setVolume(Number(event.target.value))}
                    />
                    <span>{volume}%</span>
                  </label>
                )}
              </span>
              {phase === "connected" && !video && (
                <button
                  className="direct-call-round"
                  title="Switch to video call"
                  aria-label="Switch to video call"
                  onClick={() => void upgradeToVideo()}
                >
                  <CallIcon name="video" />
                </button>
              )}
              {video && (
                <button
                  className={`direct-call-round ${!camera ? "active" : ""}`}
                  title={camera ? "Turn camera off" : "Turn camera on"}
                  aria-label={camera ? "Turn camera off" : "Turn camera on"}
                  onClick={() => void toggleCamera()}
                >
                  <CallIcon name={camera ? "video" : "videoOff"} />
                </button>
              )}
              <button className="direct-call-round danger" title="End call" aria-label="End call" onClick={end}>
                <CallIcon name="end" />
              </button>
            </>
          ) : (
            <button type="button" className="ds-btn" onClick={end}>
              {error ? "Close" : "Cancel call"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
