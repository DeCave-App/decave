// Home dashboard storage: widget layout, scene, notes, quick links, and external widget URL checks.

import {
  DEFAULT_HOME_PRESET,
  fitHomeWidgetSize,
  homeLegacyLeadWidgets,
  homePresetLayout,
  normalizeHomeWidgetSize,
  resolveHomeWidgetId,
  type HomePreset,
} from "../features/home";
import type { ExternalHomeWidget, HomeDashboardWidget } from "./types";

const HOME_LAYOUT_KEY = "decave_home_layout_v3";
const HOME_WIDGETS_V2_KEY = "decave_home_widgets_v2";
const HOME_WIDGETS_LEGACY_KEY = "decave_home_widgets_v1";
const HOME_SCENE_KEY = "decave_home_scene_v1";
export const HOME_NOTES_KEY = "decave_home_notes_v1";
export const HOME_QUICK_LINKS_KEY = "decave_home_quick_links_v1";
export const MAX_EXTERNAL_HOME_WIDGETS = 12;
export const MAX_EXTERNAL_HOME_WIDGET_TITLE_LENGTH = 80;
export const MAX_EXTERNAL_HOME_WIDGET_URL_LENGTH = 2048;
export const MAX_HOME_QUICK_LINKS = 24;
export const MAX_HOME_QUICK_LINK_NAME_LENGTH = 48;
const MAX_HOME_LAYOUT_ITEMS = 32;

export type HomeQuickLink = {
  id: string;
  name: string;
  url: string;
  domain: string;
  icon: string;
  tone: "red" | "purple" | "orange" | "green" | "blue" | "pink" | "gray";
  visible: boolean;
};

export const HOME_QUICK_LINKS: readonly HomeQuickLink[] = [
  {
    id: "reddit",
    name: "Reddit",
    url: "https://www.reddit.com/",
    domain: "reddit.com",
    icon: "●",
    tone: "orange",
    visible: true,
  },
  {
    id: "spotify",
    name: "Spotify",
    url: "https://open.spotify.com/",
    domain: "spotify.com",
    icon: "◉",
    tone: "green",
    visible: true,
  },
  {
    id: "netflix",
    name: "Netflix",
    url: "https://www.netflix.com/",
    domain: "netflix.com",
    icon: "N",
    tone: "red",
    visible: true,
  },
  {
    id: "steam",
    name: "Steam",
    url: "https://store.steampowered.com/",
    domain: "steampowered.com",
    icon: "S",
    tone: "blue",
    visible: true,
  },
  {
    id: "discord",
    name: "Discord",
    url: "https://discord.com/",
    domain: "discord.com",
    icon: "⌁",
    tone: "purple",
    visible: true,
  },
  { id: "x", name: "X", url: "https://x.com/", domain: "x.com", icon: "𝕏", tone: "gray", visible: true },
  {
    id: "github",
    name: "GitHub",
    url: "https://github.com/",
    domain: "github.com",
    icon: "◖",
    tone: "gray",
    visible: true,
  },
  {
    id: "wikipedia",
    name: "Wikipedia",
    url: "https://www.wikipedia.org/",
    domain: "wikipedia.org",
    icon: "W",
    tone: "blue",
    visible: true,
  },
  {
    id: "prime-video",
    name: "Prime Video",
    url: "https://www.primevideo.com/",
    domain: "primevideo.com",
    icon: "P",
    tone: "blue",
    visible: true,
  },
  {
    id: "crunchyroll",
    name: "Crunchyroll",
    url: "https://www.crunchyroll.com/",
    domain: "crunchyroll.com",
    icon: "✦",
    tone: "orange",
    visible: true,
  },
];

function normalizeHomeQuickLinkName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  if (!name || name.length > MAX_HOME_QUICK_LINK_NAME_LENGTH || /[\u0000-\u001f\u007f]/.test(name)) return null;
  return name;
}

export function normalizeHomeQuickLink(value: unknown, fallback?: HomeQuickLink): HomeQuickLink | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<HomeQuickLink>;
  const id = typeof item.id === "string" && /^[a-z0-9][a-z0-9-]{1,47}$/i.test(item.id) ? item.id : fallback?.id;
  if (id === "youtube" || id === "twitch") return null;
  const name = normalizeHomeQuickLinkName(item.name) ?? (typeof item.name === "undefined" ? fallback?.name : null);
  const url = normalizeExternalHomeWidgetUrl(item.url) ?? (typeof item.url === "undefined" ? fallback?.url : null);
  if (!id || !name || !url) return null;
  const parsed = new URL(url);
  const known = HOME_QUICK_LINKS.find((link) => link.id === id) ?? fallback;
  return {
    id,
    name,
    url,
    domain: parsed.hostname.replace(/^www\./i, ""),
    icon: known?.icon ?? name.slice(0, 1).toUpperCase(),
    tone: known?.tone ?? "gray",
    visible: item.visible !== false,
  };
}

export function loadHomeQuickLinks(): HomeQuickLink[] {
  try {
    const stored = JSON.parse(localStorage.getItem(HOME_QUICK_LINKS_KEY) || "null") as unknown;
    if (Array.isArray(stored)) {
      const seen = new Set<string>();
      const cleaned = stored.slice(0, MAX_HOME_QUICK_LINKS).flatMap((item) => {
        const normalized = normalizeHomeQuickLink(item);
        if (!normalized || seen.has(normalized.id)) return [];
        seen.add(normalized.id);
        return [normalized];
      });
      return cleaned;
    }
  } catch {
    // Use the curated defaults when local preferences are unavailable or invalid.
  }
  return HOME_QUICK_LINKS.map((link) => ({ ...link }));
}

export function homeLayoutStorageKey(userId: string | number): string {
  return `${HOME_LAYOUT_KEY}:${userId}`;
}

export function isExternalHomeWidget(value: HomeDashboardWidget): value is ExternalHomeWidget {
  return "kind" in value && value.kind === "external";
}

export function normalizeExternalHomeWidgetTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const title = value.trim();
  if (!title || title.length > MAX_EXTERNAL_HOME_WIDGET_TITLE_LENGTH || /[\u0000-\u001f\u007f]/.test(title))
    return null;
  return title;
}

function isBlockedExternalHomeWidgetHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  if (
    !normalized ||
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    normalized.endsWith(".home.arpa") ||
    normalized === "de-cave.com" ||
    normalized.endsWith(".de-cave.com") ||
    normalized.includes(":") ||
    !normalized.includes(".") ||
    /^(?:0x[0-9a-f]+|\d+)$/i.test(normalized)
  )
    return true;
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalized);
}

export function normalizeExternalHomeWidgetUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw || raw.length > MAX_EXTERNAL_HOME_WIDGET_URL_LENGTH) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    isBlockedExternalHomeWidgetHostname(parsed.hostname)
  )
    return null;
  return parsed.toString();
}

function parseExternalHomeWidget(value: unknown): ExternalHomeWidget | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<ExternalHomeWidget>;
  if (
    item.kind !== "external" ||
    typeof item.id !== "string" ||
    !/^external-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item.id)
  )
    return null;
  const title = normalizeExternalHomeWidgetTitle(item.title);
  const url = normalizeExternalHomeWidgetUrl(item.url);
  const size = normalizeHomeWidgetSize(item.size);
  if (!title || !url || !size) return null;
  return { kind: "external", id: item.id, title, url, size };
}

function cleanHomeWidgetLayout(value: unknown): HomeDashboardWidget[] {
  if (!Array.isArray(value)) return [];
  const cleaned: HomeDashboardWidget[] = [];
  const seenIds = new Set<string>();
  let externalCount = 0;
  for (const rawItem of value.slice(0, MAX_HOME_LAYOUT_ITEMS)) {
    if (!rawItem || typeof rawItem !== "object") continue;
    const item = rawItem as { id?: unknown; size?: unknown };
    // Accepts legacy ids/sizes too (e.g. "hubCalendar" -> "events", "large" -> "wide").
    const builtinId = resolveHomeWidgetId(item.id);
    const builtinSize = normalizeHomeWidgetSize(item.size);
    const builtin =
      builtinId && builtinSize ? { id: builtinId, size: fitHomeWidgetSize(builtinId, builtinSize) } : null;
    const external = builtin ? null : parseExternalHomeWidget(rawItem);
    const normalized = builtin ?? external;
    if (!normalized || seenIds.has(normalized.id)) continue;
    if (isExternalHomeWidget(normalized) && externalCount >= MAX_EXTERNAL_HOME_WIDGETS) continue;
    seenIds.add(normalized.id);
    if (isExternalHomeWidget(normalized)) externalCount += 1;
    cleaned.push(normalized);
  }
  return cleaned;
}

/** Load the signed-in user's Home layout, migrating pre-v3 layouts once. */
export function loadHomeLayout(userId: string | number | null | undefined): HomeDashboardWidget[] {
  try {
    if (userId !== null && userId !== undefined) {
      const stored = JSON.parse(localStorage.getItem(homeLayoutStorageKey(userId)) || "null") as unknown;
      // An empty array is a valid saved layout (the user hid everything).
      if (Array.isArray(stored)) return cleanHomeWidgetLayout(stored);
    }
    const scene = loadHomeScene();
    let legacy = cleanHomeWidgetLayout(
      JSON.parse(localStorage.getItem(`${HOME_WIDGETS_V2_KEY}:${scene}`) || "[]") as unknown,
    );
    if (!legacy.length && scene === "gaming") {
      legacy = cleanHomeWidgetLayout(JSON.parse(localStorage.getItem(HOME_WIDGETS_LEGACY_KEY) || "[]") as unknown);
    }
    if (legacy.length) return cleanHomeWidgetLayout([...homeLegacyLeadWidgets(scene), ...legacy]);
    return homePresetLayout(scene);
  } catch {
    return homePresetLayout(DEFAULT_HOME_PRESET);
  }
}

function loadHomeScene(): HomePreset {
  try {
    const scene = localStorage.getItem(HOME_SCENE_KEY);
    return scene === "social" || scene === "minimal" ? scene : "gaming";
  } catch {
    return "gaming";
  }
}

export function homeNotesStorageKey(userId: string): string {
  return `${HOME_NOTES_KEY}:${encodeURIComponent(userId)}`;
}

/** Account-owned notes; the former global value is discarded without migration. */
export function loadHomeNotes(userId: string | null): string {
  try {
    localStorage.removeItem(HOME_NOTES_KEY);
    return userId ? localStorage.getItem(homeNotesStorageKey(userId)) || "" : "";
  } catch {
    return "";
  }
}

export function saveHomeNotes(userId: string, notes: string): void {
  try {
    localStorage.setItem(homeNotesStorageKey(userId), notes);
  } catch {}
}
