// The separate "Notification sounds" and "Voice join / leave sounds" switches
// were replaced by the sound theme and per-event sounds (Settings →
// Notifications & sounds). Someone who had turned either off keeps the same
// silence: the matching events are switched off once, and the old switches are
// set back on so they no longer silence anything by themselves.

export const VOICE_SOUND_EVENTS = ["voiceJoin", "voiceLeave"] as const;
export const OTHER_SOUND_EVENTS = [
  "send",
  "receive",
  "friendRequest",
  "mention",
  "mute",
  "unmute",
  "deafen",
  "undeafen",
  "screenShare",
] as const;

type OldToggles = { sounds: boolean; voiceEvents: boolean };

export function migrateSoundToggles<N extends OldToggles, S extends object>(
  notifications: N,
  sounds: S,
): { notifications: N; sounds: S; changed: boolean } {
  if (notifications.sounds !== false && notifications.voiceEvents !== false) {
    return { notifications, sounds, changed: false };
  }
  const nextSounds = { ...sounds } as Record<string, unknown>;
  if (notifications.sounds === false) for (const event of OTHER_SOUND_EVENTS) nextSounds[event] = false;
  if (notifications.voiceEvents === false) for (const event of VOICE_SOUND_EVENTS) nextSounds[event] = false;
  return {
    notifications: { ...notifications, sounds: true, voiceEvents: true },
    sounds: nextSounds as S,
    changed: true,
  };
}
