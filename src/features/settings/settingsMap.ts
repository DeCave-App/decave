// The one map of Settings: groups, tabs, the settings inside each tab that
// search can jump to, and where old tab ids land. The sidebar, search and
// every entry point read from here.

import type { IconName } from "../../components/Icon";

export type SettingsTabId =
  | "setup"
  | "profile"
  | "account"
  | "privacy"
  | "connections"
  | "gaming"
  | "voice"
  | "notifications"
  | "chat"
  | "appearance"
  | "language"
  | "app";

export type SettingsGroupId = "you" | "session" | "app";

export type SettingsTabMeta = {
  labelKey: string;
  descriptionKey: string;
  keywordsKey: string;
  icon: IconName;
  /** Only shown in the desktop app. */
  desktopOnly?: boolean;
};

const tab = (id: SettingsTabId, icon: IconName): SettingsTabMeta => ({
  labelKey: `settings.tabs.${id}.label`,
  descriptionKey: `settings.tabs.${id}.description`,
  keywordsKey: `settings.tabs.${id}.keywords`,
  icon,
});

export const SETTINGS_TABS: Record<SettingsTabId, SettingsTabMeta> = {
  setup: tab("setup", "check"),
  profile: tab("profile", "user"),
  account: tab("account", "id-card"),
  privacy: tab("privacy", "lock"),
  connections: tab("connections", "link"),
  gaming: tab("gaming", "gamepad"),
  voice: tab("voice", "mic"),
  notifications: tab("notifications", "bell"),
  chat: tab("chat", "message"),
  appearance: tab("appearance", "sliders"),
  language: tab("language", "globe"),
  app: tab("app", "settings"),
};

export const SETTINGS_GROUPS: { id: SettingsGroupId; labelKey: string; tabs: SettingsTabId[] }[] = [
  { id: "you", labelKey: "settings.groups.you", tabs: ["profile", "account", "privacy", "connections"] },
  { id: "session", labelKey: "settings.groups.session", tabs: ["gaming", "voice", "notifications"] },
  { id: "app", labelKey: "settings.groups.app", tabs: ["chat", "appearance", "language", "app"] },
];

/** Every tab in sidebar order, "Your setup" first. */
export const SETTINGS_TAB_ORDER: SettingsTabId[] = ["setup", ...SETTINGS_GROUPS.flatMap((group) => group.tabs)];

export type SettingsAnchor = { id: string; tab: SettingsTabId; labelKey: string; keywordsKey?: string };

const anchor = (id: string, tabId: SettingsTabId, key: string, withKeywords = false): SettingsAnchor => ({
  id,
  tab: tabId,
  labelKey: `settings.anchors.${key}.label`,
  ...(withKeywords ? { keywordsKey: `settings.anchors.${key}.keywords` } : {}),
});

/** Settings rows search can scroll to; each row carries data-settings-anchor="<id>". */
export const SETTINGS_ANCHORS: SettingsAnchor[] = [
  anchor("avatar", "profile", "avatar", true),
  anchor("banner", "profile", "banner"),
  anchor("display-name", "profile", "displayName", true),
  anchor("status", "profile", "status", true),
  anchor("bio", "profile", "bio", true),
  anchor("accent", "profile", "accent", true),
  anchor("quiet-presence", "profile", "quietPresence", true),
  anchor("username", "account", "username"),
  anchor("email", "account", "email"),
  anchor("password", "account", "password"),
  anchor("decave-id", "account", "decaveId", true),
  anchor("two-factor", "account", "twoFactor", true),
  anchor("sign-in-alerts", "account", "signInAlerts"),
  anchor("sessions", "account", "sessions", true),
  anchor("your-data", "account", "yourData", true),
  anchor("delete-account", "account", "deleteAccount", true),
  anchor("encryption", "privacy", "encryption", true),
  anchor("key-devices", "privacy", "keyDevices"),
  anchor("friend-requests", "privacy", "friendRequests"),
  anchor("direct-messages", "privacy", "directMessages", true),
  anchor("blocked", "privacy", "blocked", true),
  anchor("stream-privacy", "privacy", "streamPrivacy", true),
  anchor("typing", "privacy", "typing"),
  anchor("reports", "privacy", "reports", true),
  anchor("steam", "connections", "steam"),
  anchor("twitch", "connections", "twitch"),
  anchor("faceit", "connections", "faceit"),
  anchor("activity-visibility", "gaming", "activityVisibility"),
  anchor("automatic-activity", "gaming", "automaticActivity", true),
  anchor("excluded-games", "gaming", "excludedGames"),
  anchor("overlay", "gaming", "overlay", true),
  anchor("keybinds", "gaming", "keybinds", true),
  anchor("push-to-talk", "gaming", "pushToTalk", true),
  anchor("shortcuts", "gaming", "shortcuts", true),
  anchor("devices", "voice", "devices", true),
  anchor("input-mode", "voice", "inputMode", true),
  anchor("input-volume", "voice", "inputVolume"),
  anchor("noise-suppression", "voice", "noiseSuppression", true),
  anchor("voice-processing", "voice", "voiceProcessing", true),
  anchor("output", "voice", "output", true),
  anchor("camera", "voice", "camera", true),
  anchor("mic-test", "voice", "micTest"),
  anchor("people-volume", "voice", "peopleVolume", true),
  anchor("notification-preset", "notifications", "notificationPreset"),
  anchor("desktop-notifications", "notifications", "desktopNotifications", true),
  anchor("message-previews", "notifications", "messagePreviews"),
  anchor("quiet-hours", "notifications", "quietHours", true),
  anchor("sound-theme", "notifications", "soundTheme", true),
  anchor("muted-places", "notifications", "mutedPlaces", true),
  anchor("send-key", "chat", "sendKey", true),
  anchor("animate", "chat", "animate", true),
  anchor("large-emoji", "chat", "largeEmoji"),
  anchor("spoilers", "chat", "spoilers"),
  anchor("spellcheck", "chat", "spellcheck"),
  anchor("skin", "appearance", "skin", true),
  anchor("theme-mode", "appearance", "themeMode", true),
  anchor("text-size", "appearance", "textSize", true),
  anchor("readability", "appearance", "readability", true),
  anchor("app-language", "language", "appLanguage"),
  anchor("date-style", "language", "dateStyle"),
  anchor("time-format", "language", "timeFormat", true),
  anchor("startup", "app", "startup", true),
  anchor("tray", "app", "tray", true),
  anchor("updates", "app", "updates", true),
  anchor("support", "app", "support", true),
  anchor("whats-new", "app", "whatsNew", true),
];

/** Old tab ids (saved workspace history, older entry points) → their new home. */
const LEGACY_TABS: Record<string, SettingsTabId> = {
  activity: "gaming",
  keybinds: "gaming",
  sounds: "notifications",
  system: "app",
  support: "app",
  language: "language",
};

export function isSettingsTabId(id: unknown): id is SettingsTabId {
  return typeof id === "string" && Object.prototype.hasOwnProperty.call(SETTINGS_TABS, id);
}

export function normalizeSettingsTab(id: string | null | undefined): SettingsTabId {
  if (isSettingsTabId(id)) return id;
  if (id && Object.prototype.hasOwnProperty.call(LEGACY_TABS, id)) return LEGACY_TABS[id];
  return "profile";
}

/** Translation lookup for keys held as data; components pass their t(). */
export type SettingsTranslate = (key: string) => string;

export type SettingsSearchResult = { tab: SettingsTabId; anchor?: string };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Every search word must start a word somewhere in the text ("phone" doesn't match "microphone"). */
function matchesAll(terms: readonly string[], text: string): boolean {
  const haystack = text.toLocaleLowerCase();
  return terms.every((term) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(term)}`, "u").test(haystack));
}

/**
 * Settings matching a search, best first: a setting whose name matches, then
 * one whose keywords match, then whole tabs. Desktop-only tabs are included;
 * the window hides them on web.
 */
export function searchSettings(query: string, t: SettingsTranslate): SettingsSearchResult[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const scored: { result: SettingsSearchResult; score: number; order: number }[] = [];
  SETTINGS_ANCHORS.forEach((item, order) => {
    const label = t(item.labelKey);
    if (matchesAll(terms, label)) {
      scored.push({ result: { tab: item.tab, anchor: item.id }, score: 3, order });
    } else if (matchesAll(terms, `${label} ${item.keywordsKey ? t(item.keywordsKey) : ""}`)) {
      scored.push({ result: { tab: item.tab, anchor: item.id }, score: 2, order });
    }
  });
  const anchoredTabs = new Set(scored.map((entry) => entry.result.tab));
  SETTINGS_TAB_ORDER.forEach((id, order) => {
    if (anchoredTabs.has(id)) return;
    const meta = SETTINGS_TABS[id];
    if (matchesAll(terms, `${t(meta.labelKey)} ${t(meta.descriptionKey)} ${t(meta.keywordsKey)}`)) {
      scored.push({ result: { tab: id }, score: 1, order: SETTINGS_ANCHORS.length + order });
    }
  });
  return scored.sort((left, right) => right.score - left.score || left.order - right.order).map((e) => e.result);
}

/** Tabs that have at least one search result, in sidebar order. */
export function tabsMatching(results: readonly SettingsSearchResult[]): SettingsTabId[] {
  const tabs = new Set(results.map((result) => result.tab));
  return SETTINGS_TAB_ORDER.filter((id) => tabs.has(id));
}
