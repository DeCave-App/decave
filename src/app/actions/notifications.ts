// UI sounds, notification previews (respecting the privacy setting) and desktop notifications.

import type { MutableRefObject } from "react";
import { quietHoursSilences, type ExtraSettings } from "../../features/settings";
import { resolveNotificationPreview, type NotificationPreview } from "../../privacy/notification-preview";
import type { NotificationSettings, PrivacySettings, UiSoundEvent, SoundSettings } from "../types";
import { QUIET_HOURS_SOUNDS } from "../settings-storage";

export type NotificationActionsDeps = {
  extraSettingsRef: MutableRefObject<ExtraSettings>;
  notificationSettingsRef: MutableRefObject<NotificationSettings>;
  soundSettingsRef: MutableRefObject<SoundSettings>;
  privacySettingsRef: MutableRefObject<PrivacySettings>;
  effectiveStreamerMode?: () => boolean;
};

/** Called once per render with that render's values. */
export function createNotificationActions(deps: NotificationActionsDeps) {
  const { extraSettingsRef, notificationSettingsRef, soundSettingsRef, privacySettingsRef, effectiveStreamerMode } =
    deps;

  const playUiSound = (event: UiSoundEvent, preview = false, quietChecked = false) => {
    const settings = soundSettingsRef.current;
    if (!notificationSettingsRef.current.sounds || settings.theme === "off") return;
    if (!preview && settings[event] === false) return;
    if (
      !preview &&
      !quietChecked &&
      QUIET_HOURS_SOUNDS.has(event) &&
      quietHoursSilences(extraSettingsRef.current.quietHours, event === "mention" ? "mention" : "other")
    )
      return;
    try {
      const context = new AudioContext();
      const master = context.createGain();
      const now = context.currentTime;
      const theme = settings.theme;
      const palette: Record<UiSoundEvent, number[]> = {
        send: [640, 820],
        receive: [520, 660],
        voiceJoin: [440, 660, 820],
        voiceLeave: [700, 520, 390],
        friendRequest: [660, 880, 1040],
        mention: [760, 980],
        mute: [410, 330],
        unmute: [360, 520],
        deafen: [300, 220],
        undeafen: [310, 470, 650],
        screenShare: [520, 720, 920],
      };
      const variant = settings.variants?.[event] ?? "default";
      const frequencyScale =
        variant === "bright"
          ? 1.18
          : variant === "deep"
            ? 0.78
            : variant === "glass"
              ? 1.34
              : variant === "warm"
                ? 0.9
                : variant === "chime"
                  ? 1.08
                  : 1;
      let notes = palette[event].map((frequency) => Math.round(frequency * frequencyScale));
      if (variant === "chime" && notes.length < 3) notes = [...notes, Math.round(notes[notes.length - 1] * 1.25)];
      if (variant === "minimal") notes = notes.slice(0, 1);
      const wave: OscillatorType =
        variant === "digital"
          ? "square"
          : variant === "warm"
            ? "triangle"
            : variant === "glass" || variant === "chime"
              ? "sine"
              : theme === "arcade"
                ? "square"
                : theme === "pulse"
                  ? "triangle"
                  : "sine";
      const spacingBase = theme === "arcade" ? 0.055 : theme === "pulse" ? 0.07 : 0.085;
      const spacing =
        variant === "digital"
          ? Math.max(0.045, spacingBase - 0.02)
          : variant === "chime"
            ? spacingBase + 0.025
            : variant === "minimal"
              ? 0.045
              : spacingBase;
      const durationBase = theme === "arcade" ? 0.085 : theme === "pulse" ? 0.12 : 0.14;
      const duration =
        variant === "digital"
          ? Math.max(0.075, durationBase - 0.035)
          : variant === "glass"
            ? durationBase + 0.06
            : variant === "warm"
              ? durationBase + 0.035
              : variant === "chime"
                ? durationBase + 0.08
                : variant === "minimal"
                  ? 0.075
                  : durationBase;
      const baseVolume = theme === "soft" ? 0.035 : theme === "pulse" ? 0.048 : 0.036;
      const volume =
        variant === "warm"
          ? baseVolume * 0.88
          : variant === "glass"
            ? baseVolume * 0.78
            : variant === "minimal"
              ? baseVolume * 0.72
              : baseVolume;
      master.gain.setValueAtTime(0.0001, now);
      master.gain.exponentialRampToValueAtTime(volume, now + 0.012);
      master.connect(context.destination);
      notes.forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        const noteGain = context.createGain();
        oscillator.type = wave;
        oscillator.frequency.setValueAtTime(frequency, now + index * spacing);
        if (theme === "pulse")
          oscillator.frequency.exponentialRampToValueAtTime(frequency * 1.035, now + index * spacing + duration);
        noteGain.gain.setValueAtTime(0.0001, now + index * spacing);
        noteGain.gain.exponentialRampToValueAtTime(0.85, now + index * spacing + 0.008);
        noteGain.gain.exponentialRampToValueAtTime(0.0001, now + index * spacing + duration);
        oscillator.connect(noteGain).connect(master);
        oscillator.start(now + index * spacing);
        oscillator.stop(now + index * spacing + duration + 0.02);
      });
      const end = now + Math.max(0.24, notes.length * spacing + duration + 0.05);
      master.gain.exponentialRampToValueAtTime(0.0001, end);
      window.setTimeout(() => void context.close(), Math.ceil((end - now) * 1000) + 80);
    } catch {}
  };

  const notificationPreviewMode = (): NotificationPreview => {
    if (effectiveStreamerMode?.()) return "hidden";
    return resolveNotificationPreview(privacySettingsRef.current.notificationPreview, true);
  };

  const notificationPreviewText = (
    sender: string,
    text: string,
    _fallbackTitle = "DeCave",
    context?: string,
  ): { title: string; body: string } => {
    const mode = notificationPreviewMode();
    if (mode === "hidden") {
      return {
        title: "DeCave",
        body: "You have a new notification.",
      };
    }
    if (mode === "sender") {
      return {
        title: context || sender,
        body: context ? `${sender} sent a message.` : `${sender} sent you a message.`,
      };
    }
    return {
      title: context || sender,
      body: context ? `${sender}: ${text.slice(0, 120)}` : text.slice(0, 120),
    };
  };

  const desktopNotify = (
    title: string,
    body: string,
    kind: "friend" | "dm" | "voice" = "dm",
    soundEvent?: UiSoundEvent | null,
    quietKind: "dm" | "mention" | "other" = kind === "dm" ? "dm" : "other",
  ) => {
    if (quietHoursSilences(extraSettingsRef.current.quietHours, quietKind)) return;
    if (soundEvent !== null)
      playUiSound(
        soundEvent ?? (kind === "friend" ? "friendRequest" : kind === "voice" ? "voiceJoin" : "receive"),
        false,
        true,
      );
    if (!notificationSettingsRef.current.desktop || typeof Notification === "undefined") return;
    if (Notification.permission === "granted") {
      const hidden = notificationPreviewMode() === "hidden";
      new Notification(hidden ? "DeCave" : title, { body: hidden ? "You have a new notification." : body });
    }
  };

  return {
    playUiSound,
    notificationPreviewMode,
    notificationPreviewText,
    desktopNotify,
  };
}
