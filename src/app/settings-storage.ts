// User settings kept in localStorage: keys, defaults and loaders.

import { DEFAULT_NOTIFICATION_PREVIEW, normalizeNotificationPreview } from "../privacy/notification-preview";
import type {
  AppSkin,
  ActivitySettings,
  FriendRequestPolicy,
  AudioSettings,
  NotificationSettings,
  PrivacySettings,
  SoundTheme,
  SoundVariant,
  UiSoundEvent,
  SoundSettings,
} from "./types";
import { clamp } from "./format";

export const APP_SKIN_OPTIONS: ReadonlyArray<{ id: AppSkin; label: string }> = [
  { id: "nebula", label: "Nebula Pulse" },
  { id: "arctic", label: "Arctic Flux" },
  { id: "crimson", label: "Crimson Glass" },
  { id: "royal", label: "Royal Violet" },
  { id: "pearl", label: "Pearl Glass" },
  { id: "obsidian", label: "Obsidian Glass" },
  { id: "verdant", label: "Verdant Raid" },
  { id: "bright", label: "Bright Grey" },
];
export const APP_SKIN_IDS = APP_SKIN_OPTIONS.map((option) => option.id);
export const VOICE_USER_VOLUMES_KEY = "gamerchat_voice_user_volumes_v1";
export const VADRION_SKIN_KEY = "vadrion_skin_v1";
export const AUDIO_SETTINGS_KEY = "gamerchat_audio_settings_v2";
export const MUTED_HUBS_KEY = "decave_muted_hubs_v1";
export const MUTED_USERS_KEY = "decave_muted_users_v1";
export const LAST_WORKSPACE_KEY = "decave_last_workspace_v1";

export function loadLastWorkspaceSelection(): { serverId: number; channelId: number } {
  try {
    const value = JSON.parse(localStorage.getItem(LAST_WORKSPACE_KEY) || "null") as Partial<{
      serverId: number;
      channelId: number;
    }> | null;
    return {
      serverId: Number.isInteger(value?.serverId) && (value?.serverId ?? 0) > 0 ? value!.serverId! : 1,
      channelId: Number.isInteger(value?.channelId) && (value?.channelId ?? 0) > 0 ? value!.channelId! : 1,
    };
  } catch {
    return { serverId: 1, channelId: 1 };
  }
}

export function loadMutedHubIds(): number[] {
  try {
    const value = JSON.parse(localStorage.getItem(MUTED_HUBS_KEY) || "[]") as unknown;
    return Array.isArray(value) ? value.filter((item): item is number => Number.isInteger(item) && item > 0) : [];
  } catch {
    return [];
  }
}

export function loadMutedUserIds(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(MUTED_USERS_KEY) || "[]") as unknown;
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
      : [];
  } catch {
    return [];
  }
}
// Alert sounds that quiet hours silence. Mute/deafen/screen-share sounds are
// feedback for your own actions and always play.
export const QUIET_HOURS_SOUNDS: ReadonlySet<UiSoundEvent> = new Set([
  "receive",
  "mention",
  "friendRequest",
  "voiceJoin",
  "voiceLeave",
]);

export const NOTIFICATION_SETTINGS_KEY = "vadrion_notifications_v1";
export const NOTIFY_LEVELS_KEY = "decave_notify_levels_v1";
export const PRIVACY_SETTINGS_KEY = "decave_privacy_v1";
export const SOUND_SETTINGS_KEY = "decave_sound_settings_v1";
export const ACCESSIBILITY_TEXT_SCALE_KEY = "decave_accessibility_text_scale_v1";
export const ACTIVITY_SETTINGS_KEY = "decave_activity_settings_v1";
export const DEFAULT_ACTIVITY_SETTINGS: ActivitySettings = {
  autoDetectLocal: false,
  // Off until the person turns it on: linking Steam alone does not share games.
  useSteamPresence: false,
  publishAutomatic: true,
  excludedGames: [],
};

export function loadActivitySettings(): ActivitySettings {
  try {
    const value = JSON.parse(localStorage.getItem(ACTIVITY_SETTINGS_KEY) || "{}") as Partial<ActivitySettings>;
    return {
      autoDetectLocal: value.autoDetectLocal === true,
      useSteamPresence: value.useSteamPresence !== false,
      publishAutomatic: value.publishAutomatic !== false,
      excludedGames: Array.isArray(value.excludedGames)
        ? value.excludedGames.filter((item): item is string => typeof item === "string").slice(0, 50)
        : [],
    };
  } catch {
    return DEFAULT_ACTIVITY_SETTINGS;
  }
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  desktop: true,
  sounds: true,
  friendRequests: true,
  dms: true,
  groups: true,
  mentions: true,
  voiceEvents: true,
};
export const DEFAULT_PRIVACY_SETTINGS: PrivacySettings = {
  notificationPreview: DEFAULT_NOTIFICATION_PREVIEW,
  sendTypingIndicators: true,
  friendRequestPolicy: "everyone",
  allowStreamPreviews: false,
  streamerMode: false,
  autoStreamerMode: false,
};
export const DEFAULT_SOUND_VARIANTS: Record<UiSoundEvent, SoundVariant> = {
  send: "default",
  receive: "default",
  voiceJoin: "default",
  voiceLeave: "default",
  friendRequest: "default",
  mention: "default",
  mute: "default",
  unmute: "default",
  deafen: "deep",
  undeafen: "bright",
  screenShare: "default",
};
export const DEFAULT_SOUND_SETTINGS: SoundSettings = {
  theme: "soft",
  variants: { ...DEFAULT_SOUND_VARIANTS },
  send: true,
  receive: true,
  voiceJoin: true,
  voiceLeave: true,
  friendRequest: true,
  mention: true,
  mute: true,
  unmute: true,
  deafen: true,
  undeafen: true,
  screenShare: true,
};
export function loadSoundSettings(): SoundSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(SOUND_SETTINGS_KEY) || "{}") as Partial<SoundSettings>;
    const theme: SoundTheme =
      stored.theme === "off" || stored.theme === "pulse" || stored.theme === "arcade" ? stored.theme : "soft";
    const rawVariants = stored.variants && typeof stored.variants === "object" ? stored.variants : {};
    const variants = { ...DEFAULT_SOUND_VARIANTS } as Record<UiSoundEvent, SoundVariant>;
    (Object.keys(DEFAULT_SOUND_VARIANTS) as UiSoundEvent[]).forEach((event) => {
      const value = (rawVariants as Partial<Record<UiSoundEvent, SoundVariant>>)[event];
      if (
        value === "bright" ||
        value === "deep" ||
        value === "digital" ||
        value === "glass" ||
        value === "warm" ||
        value === "chime" ||
        value === "minimal"
      )
        variants[event] = value;
    });
    return { ...DEFAULT_SOUND_SETTINGS, ...stored, theme, variants };
  } catch {
    return DEFAULT_SOUND_SETTINGS;
  }
}
export function loadNotificationSettings(): NotificationSettings {
  try {
    return {
      ...DEFAULT_NOTIFICATION_SETTINGS,
      ...(JSON.parse(localStorage.getItem(NOTIFICATION_SETTINGS_KEY) || "{}") as Partial<NotificationSettings>),
    };
  } catch {
    return DEFAULT_NOTIFICATION_SETTINGS;
  }
}
export function loadPrivacySettings(): PrivacySettings {
  try {
    const stored = JSON.parse(localStorage.getItem(PRIVACY_SETTINGS_KEY) || "{}") as Partial<PrivacySettings>;
    const friendRequestPolicy: FriendRequestPolicy =
      stored.friendRequestPolicy === "friends_of_friends" || stored.friendRequestPolicy === "none"
        ? stored.friendRequestPolicy
        : "everyone";
    return {
      notificationPreview: normalizeNotificationPreview(stored.notificationPreview),
      sendTypingIndicators: stored.sendTypingIndicators !== false,
      friendRequestPolicy,
      allowStreamPreviews: stored.allowStreamPreviews === true,
      streamerMode: stored.streamerMode === true,
      autoStreamerMode: stored.autoStreamerMode === true,
    };
  } catch {
    return DEFAULT_PRIVACY_SETTINGS;
  }
}

export function loadAccessibilityTextScale(userId?: string): number {
  if (!userId) return 100;
  try {
    const raw = localStorage.getItem(`${ACCESSIBILITY_TEXT_SCALE_KEY}:${userId}`);
    if (raw === null) return 100;
    const stored = Number(raw);
    return Number.isFinite(stored) ? Math.max(80, Math.min(140, stored)) : 100;
  } catch {
    return 100;
  }
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  inputDeviceId: "",
  outputDeviceId: "",
  inputVolume: 100,
  sensitivityMode: "auto",
  sensitivityDb: -42,
  noiseSuppression: "strong",
  echoCancellation: true,
  autoGainControl: true,
  pushToTalk: false,
  pushToTalkKey: "KeyV",
};

export function loadAudioSettings(): AudioSettings {
  try {
    const raw = localStorage.getItem(AUDIO_SETTINGS_KEY);
    if (!raw) return DEFAULT_AUDIO_SETTINGS;
    const value = JSON.parse(raw) as Partial<AudioSettings>;
    // The old Standard profile was weaker than the current gaming profile.
    // Migrate its persisted value to the renamed Standard option so users do
    // not keep receiving a mode that is no longer presented in the UI.
    const storedNoiseSuppression = value.noiseSuppression === "standard" ? "strong" : value.noiseSuppression;
    return {
      inputDeviceId: typeof value.inputDeviceId === "string" ? value.inputDeviceId : "",
      outputDeviceId: typeof value.outputDeviceId === "string" ? value.outputDeviceId : "",
      inputVolume:
        typeof value.inputVolume === "number" ? clamp(value.inputVolume, 0, 200) : DEFAULT_AUDIO_SETTINGS.inputVolume,
      sensitivityMode: value.sensitivityMode === "manual" ? "manual" : "auto",
      sensitivityDb:
        typeof value.sensitivityDb === "number"
          ? clamp(value.sensitivityDb, -80, -10)
          : DEFAULT_AUDIO_SETTINGS.sensitivityDb,
      noiseSuppression:
        storedNoiseSuppression === "off" || storedNoiseSuppression === "strong" || storedNoiseSuppression === "ai"
          ? storedNoiseSuppression
          : DEFAULT_AUDIO_SETTINGS.noiseSuppression,
      echoCancellation:
        typeof value.echoCancellation === "boolean" ? value.echoCancellation : DEFAULT_AUDIO_SETTINGS.echoCancellation,
      autoGainControl:
        typeof value.autoGainControl === "boolean" ? value.autoGainControl : DEFAULT_AUDIO_SETTINGS.autoGainControl,
      pushToTalk: typeof value.pushToTalk === "boolean" ? value.pushToTalk : false,
      pushToTalkKey: typeof value.pushToTalkKey === "string" && value.pushToTalkKey ? value.pushToTalkKey : "KeyV",
    };
  } catch {
    return DEFAULT_AUDIO_SETTINGS;
  }
}

export function loadVoiceUserVolumes(): Record<string, number> {
  try {
    const raw = localStorage.getItem(VOICE_USER_VOLUMES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const result: Record<string, number> = {};
    for (const [userId, value] of Object.entries(parsed)) {
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      result[userId] = clamp(value, 0, 200);
    }
    return result;
  } catch {
    return {};
  }
}

export function loadAppSkin(): AppSkin {
  try {
    const stored = localStorage.getItem(VADRION_SKIN_KEY);
    if (
      stored === "nebula" ||
      stored === "arctic" ||
      stored === "crimson" ||
      stored === "royal" ||
      stored === "pearl" ||
      stored === "obsidian" ||
      stored === "verdant" ||
      stored === "bright"
    ) {
      return stored;
    }
    return "nebula";
  } catch {
    return "nebula";
  }
}
