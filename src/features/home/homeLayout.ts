import type { IconName } from "../../components/Icon";
/* Home widget catalogue, presets and legacy-layout migration (pure data). */

export type HomeWidgetId =
  | "jumpBack"
  | "stats"
  | "friendsOnline"
  | "voiceRooms"
  | "events"
  | "hubs"
  | "messages"
  | "nowPlaying"
  | "quickLinks"
  | "profile"
  | "clock"
  | "notes";

export type HomeWidgetSize = "small" | "medium" | "wide";
export type HomePreset = "gaming" | "social" | "minimal";
export type HomeWidgetConfig = { id: HomeWidgetId; size: HomeWidgetSize };

export type HomeWidgetDefinition = {
  id: HomeWidgetId;
  title: string;
  description: string;
  icon: IconName;
  category: "Gaming" | "Social" | "Voice" | "Hubs" | "Personal";
  defaultSize: HomeWidgetSize;
  sizes: readonly HomeWidgetSize[];
};

export const HOME_WIDGET_SIZES: readonly HomeWidgetSize[] = ["small", "medium", "wide"];
export const HOME_WIDGET_SIZE_LABELS: Record<HomeWidgetSize, string> = {
  small: "Small",
  medium: "Medium",
  wide: "Wide",
};

export const HOME_WIDGET_DEFINITIONS: readonly HomeWidgetDefinition[] = [
  {
    id: "jumpBack",
    title: "Jump back in",
    description: "Resume your last room, voice call and quick actions",
    icon: "zap",
    category: "Personal",
    defaultSize: "wide",
    sizes: ["medium", "wide"],
  },
  {
    id: "stats",
    title: "At a glance",
    description: "Friends online, people in voice, Hubs and unread DMs",
    icon: "bar-chart",
    category: "Personal",
    defaultSize: "wide",
    sizes: ["medium", "wide"],
  },
  {
    id: "friendsOnline",
    title: "Friends online",
    description: "Who is online and what they're playing",
    icon: "users",
    category: "Social",
    defaultSize: "medium",
    sizes: ["small", "medium", "wide"],
  },
  {
    id: "voiceRooms",
    title: "Voice rooms",
    description: "Join voice rooms across your Hubs",
    icon: "mic",
    category: "Voice",
    defaultSize: "medium",
    sizes: ["small", "medium", "wide"],
  },
  {
    id: "events",
    title: "Upcoming events",
    description: "Scheduled sessions from your Hubs",
    icon: "calendar",
    category: "Hubs",
    defaultSize: "medium",
    sizes: ["medium", "wide"],
  },
  {
    id: "hubs",
    title: "Your Hubs",
    description: "Fast access to your communities",
    icon: "castle",
    category: "Hubs",
    defaultSize: "medium",
    sizes: ["small", "medium", "wide"],
  },
  {
    id: "messages",
    title: "Messages",
    description: "Jump back into private chats",
    icon: "mail",
    category: "Social",
    defaultSize: "medium",
    sizes: ["small", "medium", "wide"],
  },
  {
    id: "nowPlaying",
    title: "Now playing",
    description: "Your detected game and session time",
    icon: "gamepad",
    category: "Gaming",
    defaultSize: "medium",
    sizes: ["small", "medium", "wide"],
  },
  {
    id: "quickLinks",
    title: "Quick links",
    description: "Shortcuts to your favorite websites",
    icon: "link",
    category: "Personal",
    defaultSize: "wide",
    sizes: ["medium", "wide"],
  },
  {
    id: "profile",
    title: "Profile",
    description: "Your presence at a glance",
    icon: "id-card",
    category: "Personal",
    defaultSize: "small",
    sizes: ["small", "medium"],
  },
  {
    id: "clock",
    title: "Clock",
    description: "Local time and date",
    icon: "clock",
    category: "Personal",
    defaultSize: "small",
    sizes: ["small", "medium"],
  },
  {
    id: "notes",
    title: "Notes",
    description: "A private scratchpad on this device",
    icon: "note",
    category: "Personal",
    defaultSize: "medium",
    sizes: ["small", "medium", "wide"],
  },
];

const LIVE: HomeWidgetConfig[] = [
  { id: "friendsOnline", size: "medium" },
  { id: "voiceRooms", size: "medium" },
  { id: "events", size: "medium" },
  { id: "hubs", size: "medium" },
];

export const HOME_PRESETS: Record<
  HomePreset,
  { label: string; description: string; layout: readonly HomeWidgetConfig[] }
> = {
  gaming: {
    label: "Gaming",
    description: "Now playing, voice and events up front",
    layout: [
      { id: "jumpBack", size: "wide" },
      { id: "stats", size: "wide" },
      { id: "nowPlaying", size: "medium" },
      { id: "voiceRooms", size: "medium" },
      { id: "friendsOnline", size: "medium" },
      { id: "events", size: "medium" },
      { id: "hubs", size: "medium" },
      { id: "messages", size: "medium" },
      { id: "quickLinks", size: "wide" },
    ],
  },
  social: {
    label: "Social",
    description: "Friends, messages and your Hubs first",
    layout: [
      { id: "jumpBack", size: "wide" },
      { id: "friendsOnline", size: "medium" },
      { id: "messages", size: "medium" },
      { id: "stats", size: "wide" },
      { id: "events", size: "medium" },
      { id: "hubs", size: "medium" },
      { id: "voiceRooms", size: "medium" },
      { id: "notes", size: "medium" },
    ],
  },
  minimal: {
    label: "Minimal",
    description: "Just the essentials",
    layout: [
      { id: "jumpBack", size: "wide" },
      { id: "stats", size: "wide" },
      { id: "clock", size: "small" },
      { id: "profile", size: "small" },
      { id: "events", size: "medium" },
    ],
  },
};

export const DEFAULT_HOME_PRESET: HomePreset = "gaming";

/** Widget ids used by the pre-2026-10 grid, mapped onto the new catalogue. */
const LEGACY_WIDGET_IDS: Record<string, HomeWidgetId> = {
  nowPlaying: "nowPlaying",
  friendsActivity: "friendsOnline",
  favoriteFriends: "friendsOnline",
  recentDms: "messages",
  favoriteHubs: "hubs",
  hubCalendar: "events",
  voiceQuickJoin: "voiceRooms",
  quickLinks: "quickLinks",
  quickActions: "jumpBack",
  profile: "profile",
  notes: "notes",
};

export function homeWidgetDefinition(id: HomeWidgetId): HomeWidgetDefinition {
  return HOME_WIDGET_DEFINITIONS.find((item) => item.id === id) ?? HOME_WIDGET_DEFINITIONS[0];
}

/** Accepts both current and legacy widget ids. */
export function resolveHomeWidgetId(value: unknown): HomeWidgetId | null {
  if (typeof value !== "string") return null;
  if (HOME_WIDGET_DEFINITIONS.some((item) => item.id === value)) return value as HomeWidgetId;
  return Object.prototype.hasOwnProperty.call(LEGACY_WIDGET_IDS, value) ? LEGACY_WIDGET_IDS[value] : null;
}

/** Accepts current sizes plus the legacy "large" size (now "wide"). */
export function normalizeHomeWidgetSize(value: unknown): HomeWidgetSize | null {
  if (value === "small" || value === "medium" || value === "wide") return value;
  if (value === "large") return "wide";
  return null;
}

/** Clamp a size to the ones a widget supports. */
export function fitHomeWidgetSize(id: HomeWidgetId, size: HomeWidgetSize): HomeWidgetSize {
  const { sizes, defaultSize } = homeWidgetDefinition(id);
  if (sizes.includes(size)) return size;
  if (size === "wide" && sizes.includes("medium")) return "medium";
  if (size === "small" && sizes.includes("medium")) return "medium";
  return defaultSize;
}

export function homePresetLayout(preset: HomePreset): HomeWidgetConfig[] {
  return HOME_PRESETS[preset].layout.map((item) => ({ ...item }));
}

/**
 * The old Home always rendered the hero quick actions + stats (and, outside
 * Minimal, the four live sections) above the legacy grid. Keep those visible
 * when migrating, then append the user's legacy widgets in their order.
 */
export function homeLegacyLeadWidgets(scene: HomePreset): HomeWidgetConfig[] {
  return [
    { id: "jumpBack", size: "wide" },
    { id: "stats", size: "wide" },
    ...(scene === "minimal" ? [] : LIVE.map((item) => ({ ...item }))),
  ];
}
