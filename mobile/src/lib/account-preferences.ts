import { apiJson } from "@/src/lib/api";
import type { NotificationPreview } from "@/src/lib/notification-preview";

export type ActivityVisibility = "everyone" | "friends" | "nobody";
export type FriendRequestPolicy = "everyone" | "friends_of_friends" | "none";
export type NotifyLevel = "all" | "mentions" | "nothing";

export type QuietHours = {
  enabled: boolean;
  start: string;
  end: string;
  allowMentions: boolean;
};

export type SyncedNotifications = {
  enabled: boolean;
  dms: boolean;
  mentions: boolean;
  hubMessages: boolean;
  groups: boolean;
  desktop: boolean;
  sounds: boolean;
  friendRequests: boolean;
  voiceEvents: boolean;
};

/** Settings shared between the web app, desktop and this phone (version v:1). */
export type SyncedClientSettings = {
  v?: number;
  notifications?: Partial<SyncedNotifications>;
  privacy?: { notificationPreview?: NotificationPreview; sendTypingIndicators?: boolean };
  notifyLevels?: { hubs?: Record<string, NotifyLevel>; rooms?: Record<string, NotifyLevel> };
  mutedHubs?: Record<string, number>;
  extra?: { quietHours?: Partial<QuietHours> } & Record<string, unknown>;
  timeZone?: string;
};

export type AccountPreferences = {
  loginAlerts: boolean;
  activityVisibility: ActivityVisibility;
  friendRequestPolicy: FriendRequestPolicy;
  streamerMode: boolean;
  allowStreamPreviews: boolean;
  clientSettings: SyncedClientSettings | null;
  clientSettingsUpdatedAt: string | null;
};

export type AccountPreferencesPatch = Partial<
  Pick<AccountPreferences, "loginAlerts" | "activityVisibility" | "friendRequestPolicy" | "streamerMode">
> & {
  clientSettingsPatch?: SyncedClientSettings;
};

export const DEFAULT_QUIET_HOURS: QuietHours = {
  enabled: false,
  start: "22:00",
  end: "08:00",
  allowMentions: true,
};

export function loadAccountPreferences(token: string): Promise<AccountPreferences> {
  return apiJson<AccountPreferences>("/api/account/preferences", {}, token);
}

export function updateAccountPreferences(
  token: string,
  patch: AccountPreferencesPatch,
): Promise<AccountPreferences> {
  return apiJson<AccountPreferences>(
    "/api/account/preferences",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    },
    token,
  );
}

export function deviceTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/** Accepts "H:MM" or "HH:MM" (24-hour) and returns "HH:MM", or null when invalid. */
export function normalizeClockTime(value: string): string | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function readQuietHours(settings: SyncedClientSettings | null | undefined): QuietHours {
  const value = settings?.extra?.quietHours;
  return {
    enabled: typeof value?.enabled === "boolean" ? value.enabled : DEFAULT_QUIET_HOURS.enabled,
    start: (typeof value?.start === "string" && normalizeClockTime(value.start)) || DEFAULT_QUIET_HOURS.start,
    end: (typeof value?.end === "string" && normalizeClockTime(value.end)) || DEFAULT_QUIET_HOURS.end,
    allowMentions:
      typeof value?.allowMentions === "boolean" ? value.allowMentions : DEFAULT_QUIET_HOURS.allowMentions,
  };
}
