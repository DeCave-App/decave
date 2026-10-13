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
import type { ScreenSfuSharer } from "../../voice/screen-sfu/sharer";
import type { CameraShareOptionsState } from "../state/camera-share-options";
import type { VoiceCallState } from "../state/voice-call";
import { i18next } from "../../i18n/index.ts";
import { apiErrorMessage } from "../../i18n/apiError.ts";
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
  screenSfu: Pick<ScreenSfuSharer, "begin" | "end">;
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
    screenSfu,
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
        setSoundboardNotice(apiErrorMessage(data, "client.soundboard.load"));
        return;
      }
      setSoundboardSounds(Array.isArray(data.sounds) ? data.sounds : []);
    } catch {
      setSoundboardNotice(i18next.t("errors.client.soundboard.load"));
    }
  };

  const uploadSoundboardSound = async (file: File) => {
    if (soundboardBusy) return;
    if (file.size <= 0 || file.size > 1536 * 1024) {
      setSoundboardNotice(i18next.t("chat.actions.soundboard.tooLarge"));
      return;
    }
    if (!["audio/mpeg", "audio/wav", "audio/x-wav", "audio/ogg", "audio/mp4", "audio/webm"].includes(file.type)) {
      setSoundboardNotice(i18next.t("chat.actions.soundboard.badType"));
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
          typeof reader.result === "string"
            ? resolve(reader.result)
            : reject(new Error(i18next.t("chat.actions.soundboard.readFailed")));
        reader.onerror = () => reject(reader.error ?? new Error(i18next.t("chat.actions.soundboard.readFailed")));
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
        setSoundboardNotice(apiErrorMessage(data, "client.soundboard.upload"));
        return;
      }
      setSoundboardSounds((current) => [data.sound!, ...current.filter((item) => item.id !== data.sound!.id)]);
      setSoundboardNotice(i18next.t("chat.actions.soundboard.added", { name: data.sound.name }));
    } catch {
      setSoundboardNotice(i18next.t("errors.client.soundboard.upload"));
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
        setSoundboardNotice(apiErrorMessage(data, "client.soundboard.delete"));
        return;
      }
      setSoundboardSounds((current) => current.filter((item) => item.id !== sound.id));
    } catch {
      setSoundboardNotice(i18next.t("errors.client.soundboard.delete"));
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
    if (
      voiceChannelRef.current === null ||
      isCameraOn ||
      cameraStartInFlightRef.current ||
      screenShareInFlightRef.current
    )
      return;
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
        else setCameraEffectNotice(i18next.t("chat.actions.camera.blurUnsupported"));
      }
      if (cameraEffect === "replace") {
        if (supported.backgroundReplacement) videoConstraints.backgroundReplacement = true;
        else setCameraEffectNotice(i18next.t("chat.actions.camera.replaceUnsupported"));
      }
      camera = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false });
      // F7/F8-style guard: the user may have left voice while the prompt was open.
      if (voiceChannelRef.current === null || voiceChannelRef.current !== cameraVoiceChannel) {
        for (const t of camera.getTracks()) t.stop();
        return;
      }
      const track = camera.getVideoTracks()[0];
      if (!track) throw new Error(i18next.t("chat.actions.camera.noTrack"));
      track.contentHint = "detail";
      // Keep the current capture alive until the replacement has been acquired
      // and validated. Permission cancellation or device failure must not end
      // the user's existing screen share.
      if (localScreenStreamRef.current) stopScreenShare();
      localCameraStreamRef.current = camera;
      setLocalCameraStream(camera);
      setIsCameraOn(true);
      sendSocket({ type: "VOICE_CAMERA_STATE", cameraSharing: true });
      // Signaling state is sent first; WebSocket ordering ensures receivers can
      // install the sealed camera generation before the subsequent SDP offer.
      for (const session of peerSessionsRef.current.values()) addLocalTracksToPeer(session);
      track.onended = () => {
        if (localCameraStreamRef.current === camera) stopCamera();
      };
    } catch (error) {
      // Dispose only the candidate from this attempt. An existing camera or
      // screen capture belongs to the prior state and must survive failure.
      if (camera && localCameraStreamRef.current === camera) stopCamera();
      else if (camera) for (const track of camera.getTracks()) track.stop();
      if (error instanceof DOMException && error.name === "NotAllowedError") return;
      setVoiceError(error instanceof Error ? error.message : i18next.t("chat.actions.camera.startFailed"));
    } finally {
      cameraStartInFlightRef.current = false;
    }
  };

  const stopScreenShare = () => {
    const screen = localScreenStreamRef.current;
    if (!screen) return;
    screenSfu.end();
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
    if (
      voiceChannelRef.current === null ||
      isScreenSharing ||
      screenShareInFlightRef.current ||
      cameraStartInFlightRef.current
    )
      return;
    screenShareInFlightRef.current = true;
    const shareVoiceChannel = voiceChannelRef.current;
    const stillInSameVoice = () => voiceChannelRef.current !== null && voiceChannelRef.current === shareVoiceChannel;
    setVoiceError("");
    let screen: MediaStream | null = null;
    try {
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
      screen = await navigator.mediaDevices.getDisplayMedia({
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
        throw new Error(i18next.t("chat.actions.screen.noTrack"));
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
        setVoiceError(i18next.t("chat.actions.screen.systemAudioDropped"));
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
      // The picker and capture setup can take time. Stop the current camera
      // only after the replacement stream is ready and the user is still in
      // the same voice channel.
      if (localCameraStreamRef.current) stopCamera();
      localScreenStreamRef.current = screen;
      setLocalScreenStream(screen);
      setIsScreenSharing(true);
      videoTrack.onended = () => {
        if (localScreenStreamRef.current === screen) stopScreenShare();
      };
      // Decides SFU vs mesh synchronously, so the mesh senders below follow it.
      void screenSfu.begin(videoTrack);
      for (const session of peerSessionsRef.current.values()) addLocalTracksToPeer(session);
      sendSocket({
        type: "VOICE_SCREEN_STATE",
        screenSharing: true,
        // Lets viewers tell this share's audio from our microphone.
        screenStreamId: screen.id,
        allowStreamPreview: privacySettingsRef.current.allowStreamPreviews,
      });
      playUiSound("screenShare");
    } catch (error) {
      // Do not tear down a previously active screen share if this attempt was
      // canceled or failed before replacing it.
      if (screen && localScreenStreamRef.current === screen) stopScreenShare();
      else if (screen) for (const track of screen.getTracks()) track.stop();
      if (error instanceof DOMException && error.name === "NotAllowedError") return;
      console.error("Could not start protected screen sharing:", error);
      setVoiceError(error instanceof Error ? error.message : i18next.t("chat.actions.screen.startFailed"));
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
