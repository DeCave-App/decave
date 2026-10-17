// Liquid Glass on the phone: see-through panels over a soft backdrop picture,
// in the current skin's colors. Saved on this device like the skin, read once at
// startup (styles are built then), and changing it reloads the app.
// Kept free of app imports so theme.ts can read it before anything renders.

import * as SecureStore from "expo-secure-store";

export type GlassStyle = "clear" | "tinted";
/** "skin" uses the current skin's colors; the rest are built-in wallpapers. */
export type GlassBackdrop = "skin" | "aurora" | "sunset" | "ocean" | "forest" | "graphite";

export const GLASS_STYLES: readonly GlassStyle[] = ["clear", "tinted"];
export const GLASS_BACKDROPS: readonly GlassBackdrop[] = ["skin", "aurora", "sunset", "ocean", "forest", "graphite"];

export type GlassSettings = { enabled: boolean; style: GlassStyle; backdrop: GlassBackdrop };

export const GLASS_STORAGE_KEY = "decave.glass.v1";
export const DEFAULT_GLASS: GlassSettings = { enabled: false, style: "clear", backdrop: "skin" };

export function normalizeGlass(value: unknown): GlassSettings {
  const raw = (value && typeof value === "object" ? value : {}) as Partial<GlassSettings>;
  return {
    enabled: raw.enabled === true,
    style: raw.style === "tinted" ? "tinted" : "clear",
    backdrop: GLASS_BACKDROPS.includes(raw.backdrop as GlassBackdrop) ? (raw.backdrop as GlassBackdrop) : "skin",
  };
}

function storedGlass(): GlassSettings {
  try {
    return normalizeGlass(JSON.parse(SecureStore.getItem(GLASS_STORAGE_KEY) || "{}"));
  } catch {
    return { ...DEFAULT_GLASS };
  }
}

/** Glass as saved when the app started. */
export const startupGlass: GlassSettings = storedGlass();

export async function saveGlass(settings: GlassSettings): Promise<void> {
  await SecureStore.setItemAsync(GLASS_STORAGE_KEY, JSON.stringify(normalizeGlass(settings)));
}
