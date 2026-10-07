// Voice and screen-share helpers: share quality profiles, noise suppression labels, microphone errors.

import type {
  NoiseSuppressionMode,
  ScreenQuality,
  ScreenShareProfile,
  VoiceMiniDragState,
  VoiceMiniPlayerPosition,
} from "./types";
import { clamp } from "./format";

// Keep capture constraints and RTP sender limits in one place so changing a
// quality preset cannot leave another part of the screen-share pipeline on an
// older resolution, frame-rate, or bitrate target. maxBitrate is a ceiling,
// not a forced send rate; WebRTC congestion control can and should adapt lower.
export const SCREEN_SHARE_PROFILES: Record<ScreenQuality, ScreenShareProfile> = {
  // Auto favors a stable 1080p30 baseline. Higher frame rates remain available
  // explicitly, but mesh voice sends one encoder per viewer and 1080p60 can
  // otherwise saturate ordinary uplinks before congestion control settles.
  auto: { width: 1920, height: 1080, fps: 30, maxBitrate: 8_000_000 },
  "720p30": { width: 1280, height: 720, fps: 30, maxBitrate: 5_000_000 },
  "1080p30": { width: 1920, height: 1080, fps: 30, maxBitrate: 8_000_000 },
  "1080p60": { width: 1920, height: 1080, fps: 60, maxBitrate: 15_000_000 },
  "1440p30": { width: 2560, height: 1440, fps: 30, maxBitrate: 18_000_000 },
  // 2K/1440p60 needs substantially more headroom for high-motion game
  // content. This remains only a maximum; congestion control may use less.
  "1440p60": { width: 2560, height: 1440, fps: 60, maxBitrate: 28_000_000 },
};

export const voiceMiniDragState = new WeakMap<HTMLElement, VoiceMiniDragState>();

export function noiseSuppressionLabel(mode: NoiseSuppressionMode): string {
  return mode === "ai" ? "DeCave ClearVoice" : mode === "strong" || mode === "standard" ? "Standard" : "Off";
}

export function noiseSuppressionShortLabel(mode: NoiseSuppressionMode): string {
  return mode === "ai" ? "CV" : mode === "strong" || mode === "standard" ? "STD" : "OFF";
}

/** Shown when the relay (TURN) service is unreachable; voice never falls back to direct peer connections. */
export const VOICE_RELAY_UNAVAILABLE_MESSAGE =
  "Voice is temporarily unavailable. We couldn't reach the secure voice relay. Please try again in a few minutes.";
export const CALL_RELAY_UNAVAILABLE_MESSAGE =
  "Calls are temporarily unavailable. We couldn't reach the secure call relay. Please try again in a few minutes.";

export function microphoneErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") {
      return "Microphone access is blocked. Allow microphone permission for DeCave in your browser settings and try again.";
    }
    if (error.name === "NotFoundError") {
      return "No microphone was found on this device.";
    }
    if (error.name === "NotReadableError") {
      return "The microphone is busy or unavailable. Close other apps using it and try again.";
    }
    if (error.name === "OverconstrainedError") {
      return "The selected microphone does not support the requested audio settings.";
    }
  }
  return error instanceof Error ? error.message : "Could not access the microphone.";
}

export const clampVoiceMiniPosition = (
  position: VoiceMiniPlayerPosition,
  width: number,
  height: number,
): VoiceMiniPlayerPosition => {
  const margin = 12;
  return {
    x: clamp(position.x, margin, Math.max(margin, window.innerWidth - width - margin)),
    y: clamp(position.y, margin, Math.max(margin, window.innerHeight - height - margin)),
  };
};
