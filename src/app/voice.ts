// Voice and screen-share helpers: share quality profiles, noise suppression labels, microphone errors.

import type {
  NoiseSuppressionMode,
  ScreenQuality,
  ScreenShareProfile,
  VoiceMiniDragState,
  VoiceMiniPlayerPosition,
} from "./types";
import { clamp } from "./format";
import { i18next } from "../i18n/index.ts";

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

// Mesh voice uploads one encoded copy per viewer, so the per-viewer ceiling
// shrinks as viewers are added. One viewer still gets the full preset; more
// viewers split a shared uplink budget, never dropping below a usable floor.
const SCREEN_UPLINK_BUDGET_BPS = 12_000_000;
const SCREEN_MIN_VIEWER_BPS = 1_500_000;
export const SCREEN_PREVIEW_BITRATE = 250_000;
export const SCREEN_PREVIEW_FPS = 5;
export const SCREEN_PREVIEW_DOWNSCALE = 4;

export function screenBitratePerViewer(presetMaxBitrate: number, viewers: number): number {
  const budget = Math.max(presetMaxBitrate, SCREEN_UPLINK_BUDGET_BPS);
  const share = budget / Math.max(1, viewers);
  return Math.round(Math.min(presetMaxBitrate, Math.max(SCREEN_MIN_VIEWER_BPS, share)));
}

export const voiceMiniDragState = new WeakMap<HTMLElement, VoiceMiniDragState>();

export function noiseSuppressionLabel(mode: NoiseSuppressionMode): string {
  return mode === "ai"
    ? "DeCave ClearVoice"
    : mode === "deepfilter"
      ? "DeepFilterNet"
      : mode === "strong" || mode === "standard"
        ? i18next.t("chat.actions.noise.standard")
        : i18next.t("chat.actions.noise.off");
}

export function noiseSuppressionShortLabel(mode: NoiseSuppressionMode): string {
  return mode === "ai"
    ? "CV"
    : mode === "deepfilter"
      ? "DFN"
      : mode === "strong" || mode === "standard"
        ? i18next.t("chat.actions.noise.standardShort")
        : i18next.t("chat.actions.noise.offShort");
}

/** Shown when the relay (TURN) service is unreachable; voice never falls back to direct peer connections. */
export const VOICE_RELAY_UNAVAILABLE_KEY = "voice.engine.relayUnavailable" as const;
export const CALL_RELAY_UNAVAILABLE_KEY = "dm.call.relayUnavailable" as const;

export const voiceRelayUnavailableMessage = (): string => i18next.t(VOICE_RELAY_UNAVAILABLE_KEY);
export const callRelayUnavailableMessage = (): string => i18next.t(CALL_RELAY_UNAVAILABLE_KEY);

export function microphoneErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") {
      return i18next.t("chat.actions.microphone.blocked");
    }
    if (error.name === "NotFoundError") {
      return i18next.t("chat.actions.microphone.notFound");
    }
    if (error.name === "NotReadableError") {
      return i18next.t("chat.actions.microphone.busy");
    }
    if (error.name === "OverconstrainedError") {
      return i18next.t("chat.actions.microphone.overconstrained");
    }
  }
  return error instanceof Error ? error.message : i18next.t("chat.actions.microphone.failed");
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
