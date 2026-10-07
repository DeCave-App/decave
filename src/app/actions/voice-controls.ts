// Voice controls: soundboard, mute and deafen, camera and screen sharing.

import type { MutableRefObject } from "react";
import { discardUnapprovedDisplayAudio, displayAudioExcludesOwnPlayback } from "../../voice/display-audio-policy";
import type { ExtraSettings } from "../../features/settings";
import type {
  Server,
  AccountUser,
  PeerSession,
  ScreenQuality,
  SoundboardSound,
  ApiError,
  PrivacySettings,
  UiSoundEvent,
} from "../types";
import { HTTP_URL } from "../env";
import { SCREEN_SHARE_PROFILES } from "../voice";
import type { SoundboardState } from "../state/soundboard";
import type { CameraShareOptionsState } from "../state/camera-share-options";
import type { VoiceCallState } from "../state/voice-call";
import type { CallMediaState } from "../state/call-media";

export type VoiceControlActionsDeps = {
  currentUser: AccountUser | null;
  extraSettingsRef: MutableRefObject<ExtraSettings>;
  voiceChannelRef: MutableRefObject<number | null>;
  privacySettingsRef: MutableRefObject<PrivacySettings>;
  isMutedRef: MutableRefObject<boolean>;
  localScreenStreamRef: MutableRefObject<MediaStream | null>;
  localCameraStreamRef: MutableRefObject<MediaStream | null>;
  cameraStartInFlightRef: MutableRefObject<boolean>;
  screenShareInFlightRef: MutableRefObject<boolean>;
  screenQualityRef: MutableRefObject<ScreenQuality>;
  peerSessionsRef: MutableRefObject<Map<string, PeerSession>>;
  isDeafenedRef: MutableRefObject<boolean>;
  playUiSound: (event: UiSoundEvent, preview?: boolean, quietChecked?: boolean) => void;
  currentServer: Server;
  authorizedFetch: (url: string, init?: RequestInit) => Promise<Response>;
  sendSocket: (payload: unknown) => boolean;
  applyMicrophoneEnabledState: () => boolean;
  addLocalTracksToPeer: (session: PeerSession) => void;
  stopCamera: () => void;
  soundboard: SoundboardState;
  cameraShareOptions: CameraShareOptionsState;
  voiceCall: VoiceCallState;
  callMedia: CallMediaState;
};

/** Called once per render with that render's values. */
export function createVoiceControlActions(deps: VoiceControlActionsDeps) {
  const {
    currentUser,
    extraSettingsRef,
    voiceChannelRef,
    privacySettingsRef,
    isMutedRef,
    localScreenStreamRef,
    localCameraStreamRef,
    cameraStartInFlightRef,
    screenShareInFlightRef,
    screenQualityRef,
    peerSessionsRef,
    isDeafenedRef,
    playUiSound,
    currentServer,
    authorizedFetch,
    sendSocket,
    applyMicrophoneEnabledState,
    addLocalTracksToPeer,
    stopCamera,
    soundboard,
    cameraShareOptions,
    voiceCall,
    callMedia,
  } = deps;
  const { setIsScreenSharing, isScreenSharing, isCameraOn, setIsCameraOn, setLocalScreenStream, setLocalCameraStream } =
    callMedia;
  const { setSoundboardNotice, setVoiceError, isMuted, setIsMuted, isDeafened, setIsDeafened } = voiceCall;
  const { shareSystemAudio, cameraEffect, setCameraEffectNotice } = cameraShareOptions;
  const { setSoundboardSounds, soundboardBusy, setSoundboardBusy } = soundboard;

  const loadSoundboardSounds = async () => {
    if (!currentUser || !currentServer.id) return;
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/soundboard?hubId=${currentServer.id}`, {
        cache: "no-store",
      });
      const data = (await response.json().catch(() => ({}))) as {
        sounds?: SoundboardSound[];
        error?: string;
      };
      if (!response.ok) {
        setSoundboardNotice(data.error || "Could not load this Hub's soundboard.");
        return;
      }
      setSoundboardSounds(Array.isArray(data.sounds) ? data.sounds : []);
    } catch {
      setSoundboardNotice("Could not load this Hub's soundboard.");
    }
  };

  const uploadSoundboardSound = async (file: File) => {
    if (soundboardBusy) return;
    if (file.size <= 0 || file.size > 1536 * 1024) {
      setSoundboardNotice("Soundboard files must be 1.5 MB or smaller.");
      return;
    }
    if (!["audio/mpeg", "audio/wav", "audio/x-wav", "audio/ogg", "audio/mp4", "audio/webm"].includes(file.type)) {
      setSoundboardNotice("Upload an MP3, WAV, OGG, M4A or WebM audio file.");
      return;
    }
    const name =
      file.name
        .replace(/\.[^.]+$/, "")
        .trim()
        .slice(0, 32) || "Sound";
    setSoundboardBusy(true);
    setSoundboardNotice("");
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () =>
          typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not read audio file."));
        reader.onerror = () => reject(reader.error ?? new Error("Could not read audio file."));
        reader.readAsDataURL(file);
      });
      const response = await authorizedFetch(`${HTTP_URL}/api/soundboard`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, dataUrl, hubId: currentServer.id }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        sound?: SoundboardSound;
        error?: string;
      };
      if (!response.ok || !data.sound) {
        setSoundboardNotice(data.error || "Could not upload that sound.");
        return;
      }
      setSoundboardSounds((current) => [data.sound!, ...current.filter((item) => item.id !== data.sound!.id)]);
      setSoundboardNotice(`${data.sound.name} added.`);
    } catch {
      setSoundboardNotice("Could not upload that sound.");
    } finally {
      setSoundboardBusy(false);
    }
  };

  const deleteSoundboardSound = async (sound: SoundboardSound) => {
    if (soundboardBusy) return;
    setSoundboardBusy(true);
    setSoundboardNotice("");
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/soundboard/${encodeURIComponent(sound.id)}`, {
        method: "DELETE",
      });
      const data = (await response.json().catch(() => ({}))) as ApiError;
      if (!response.ok) {
        setSoundboardNotice(data.error || "Could not delete that sound.");
        return;
      }
      setSoundboardSounds((current) => current.filter((item) => item.id !== sound.id));
    } catch {
      setSoundboardNotice("Could not delete that sound.");
    } finally {
      setSoundboardBusy(false);
    }
  };

  const toggleMute = () => {
    const nextMuted = !isMuted;
    isMutedRef.current = nextMuted;
    setIsMuted(nextMuted);
    applyMicrophoneEnabledState();

    if (voiceChannelRef.current !== null) {
      sendSocket({ type: "VOICE_MUTE", muted: nextMuted });
    }
    playUiSound(nextMuted ? "mute" : "unmute");
  };

  const toggleDeafen = () => {
    const next = !isDeafened;
    setIsDeafened(next);
    isDeafenedRef.current = next;
    for (const session of peerSessionsRef.current.values()) session.resumeAudio();

    applyMicrophoneEnabledState();

    if (voiceChannelRef.current !== null) {
      sendSocket({ type: "VOICE_DEAFEN", deafened: next });
    }
    playUiSound(next ? "deafen" : "undeafen");
  };

  const startCamera = async () => {
    if (voiceChannelRef.current === null || isCameraOn || cameraStartInFlightRef.current) return;
    if (localScreenStreamRef.current) stopScreenShare();
    setVoiceError("");
    setCameraEffectNotice("");
    cameraStartInFlightRef.current = true;
    const cameraVoiceChannel = voiceChannelRef.current;
    let camera: MediaStream | null = null;
    try {
      const supported = navigator.mediaDevices.getSupportedConstraints() as MediaTrackSupportedConstraints &
        Record<string, boolean>;
      const videoConstraints: MediaTrackConstraints & Record<string, unknown> = {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 30 },
      };
      // Settings → Voice → Camera. "ideal" so an unplugged camera falls back to the default.
      if (extraSettingsRef.current.cameraDeviceId)
        videoConstraints.deviceId = { ideal: extraSettingsRef.current.cameraDeviceId };
      if (cameraEffect === "blur") {
        if (supported.backgroundBlur) videoConstraints.backgroundBlur = true;
        else
          setCameraEffectNotice(
            "Background blur is not supported by this browser or camera driver; camera started without it.",
          );
      }
      if (cameraEffect === "replace") {
        if (supported.backgroundReplacement) videoConstraints.backgroundReplacement = true;
        else
          setCameraEffectNotice(
            "Background replacement is not supported by this browser or camera driver; camera started without it.",
          );
      }
      camera = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false });
      // F7/F8-style guard: the user may have left voice while the prompt was open.
      if (voiceChannelRef.current === null || voiceChannelRef.current !== cameraVoiceChannel) {
        for (const t of camera.getTracks()) t.stop();
        return;
      }
      const track = camera.getVideoTracks()[0];
      if (!track) throw new Error("No camera video track available.");
      track.contentHint = "detail";
      localCameraStreamRef.current = camera;
      setLocalCameraStream(camera);
      setIsCameraOn(true);
      sendSocket({ type: "VOICE_CAMERA_STATE", cameraSharing: true });
      // Signaling state is sent first; WebSocket ordering ensures receivers can
      // install the sealed camera generation before the subsequent SDP offer.
      for (const session of peerSessionsRef.current.values()) addLocalTracksToPeer(session);
      track.onended = () => stopCamera();
    } catch (error) {
      // F8: stop the acquired stream even when it never became the local camera stream.
      if (camera && localCameraStreamRef.current !== camera) for (const t of camera.getTracks()) t.stop();
      if (localCameraStreamRef.current) {
        for (const track of localCameraStreamRef.current.getTracks()) track.stop();
        localCameraStreamRef.current = null;
        setLocalCameraStream(null);
        setIsCameraOn(false);
      }
      if (error instanceof DOMException && error.name === "NotAllowedError") return;
      setVoiceError(error instanceof Error ? error.message : "Could not start protected camera.");
    } finally {
      cameraStartInFlightRef.current = false;
    }
  };

  const stopScreenShare = () => {
    const screen = localScreenStreamRef.current;
    if (!screen) return;
    const ids = new Set(screen.getTracks().map((track) => track.id));
    for (const session of peerSessionsRef.current.values()) {
      for (const sender of session.pc.getSenders())
        if (sender.track && ids.has(sender.track.id)) {
          session.pc.removeTrack(sender);
        }
    }
    for (const track of screen.getTracks()) track.stop();
    localScreenStreamRef.current = null;
    setLocalScreenStream(null);
    setIsScreenSharing(false);
    sendSocket({
      type: "VOICE_SCREEN_STATE",
      screenSharing: false,
      allowStreamPreview: privacySettingsRef.current.allowStreamPreviews,
    });
    playUiSound("screenShare");
  };

  const startScreenShare = async () => {
    // F7: one picker at a time; re-check voice after every await.
    if (voiceChannelRef.current === null || isScreenSharing || screenShareInFlightRef.current) return;
    screenShareInFlightRef.current = true;
    const shareVoiceChannel = voiceChannelRef.current;
    const stillInSameVoice = () => voiceChannelRef.current !== null && voiceChannelRef.current === shareVoiceChannel;
    setVoiceError("");
    try {
      if (localCameraStreamRef.current) stopCamera();
      const quality = screenQualityRef.current;
      const { width, height, fps } = SCREEN_SHARE_PROFILES[quality];
      // Protected calls need a separately reviewed system-audio media domain;
      // ordinary calls can carry the browser/Electron loopback track in the
      // screen stream. Keeping it out of the microphone stream avoids double
      // playback, voice gain processing, and the constant-noise failure mode.
      const captureSystemAudio = shareSystemAudio;
      const systemAudioConstraints: MediaTrackConstraints & Record<string, unknown> = {
        // Asks Chromium for the process-excluding loopback device. Without it,
        // DeCave's remote voice playback is recorded as system audio and sent
        // back to everyone as an echo. Checked on the track below.
        restrictOwnAudio: true,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: { ideal: 2 },
        sampleRate: { ideal: 48_000 },
      };
      const screen = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: width, max: width },
          height: { ideal: height, max: height },
          frameRate: { ideal: fps, max: fps },
        },
        audio: captureSystemAudio ? systemAudioConstraints : false,
      });
      if (!stillInSameVoice()) {
        for (const track of screen.getTracks()) track.stop();
        return;
      }
      discardUnapprovedDisplayAudio(screen, captureSystemAudio);
      const videoTrack = screen.getVideoTracks()[0];
      if (!videoTrack) {
        for (const track of screen.getTracks()) track.stop();
        throw new Error("No screen video track was selected.");
      }
      videoTrack.contentHint = "motion";
      let unsafeSystemAudioDropped = false;
      for (const audioTrack of screen.getAudioTracks()) {
        // Keep the selected screen video running and drop only audio that
        // could recapture DeCave's remote voice playback.
        if (captureSystemAudio && !displayAudioExcludesOwnPlayback(audioTrack.getSettings())) {
          unsafeSystemAudioDropped = true;
          screen.removeTrack(audioTrack);
          audioTrack.stop();
          continue;
        }
        audioTrack.contentHint = "music";
      }
      if (unsafeSystemAudioDropped) {
        setVoiceError(
          "Screen sharing started without system audio: this device cannot keep DeCave voices out of the shared sound, so everyone would hear themselves echo.",
        );
      }
      try {
        await videoTrack.applyConstraints({
          width: { ideal: width, max: width },
          height: { ideal: height, max: height },
          frameRate: { ideal: fps, max: fps },
        });
      } catch {}
      if (!stillInSameVoice()) {
        for (const track of screen.getTracks()) track.stop();
        return;
      }
      localScreenStreamRef.current = screen;
      setLocalScreenStream(screen);
      setIsScreenSharing(true);
      videoTrack.onended = () => stopScreenShare();
      for (const session of peerSessionsRef.current.values()) addLocalTracksToPeer(session);
      sendSocket({
        type: "VOICE_SCREEN_STATE",
        screenSharing: true,
        allowStreamPreview: privacySettingsRef.current.allowStreamPreviews,
      });
      playUiSound("screenShare");
    } catch (error) {
      if (localScreenStreamRef.current) {
        for (const track of localScreenStreamRef.current.getTracks()) track.stop();
        localScreenStreamRef.current = null;
        setLocalScreenStream(null);
        setIsScreenSharing(false);
      }
      if (error instanceof DOMException && error.name === "NotAllowedError") return;
      console.error("Could not start protected screen sharing:", error);
      setVoiceError(error instanceof Error ? error.message : "Could not start protected screen sharing.");
    } finally {
      screenShareInFlightRef.current = false;
    }
  };

  return {
    loadSoundboardSounds,
    uploadSoundboardSound,
    deleteSoundboardSound,
    toggleMute,
    toggleDeafen,
    startCamera,
    stopScreenShare,
    startScreenShare,
  };
}

export type VoiceControlActions = ReturnType<typeof createVoiceControlActions>;
