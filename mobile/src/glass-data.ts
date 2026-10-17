// Liquid Glass on the phone: see-through panels over a soft backdrop picture,
// in the current skin's colors. Saved on this device like the skin, read once at
// startup (styles are built then), and changing it reloads the app.
// Kept free of app imports so theme.ts can read it before anything renders.

import * as SecureStore from "expo-secure-store";
import { DEFAULT_GLASS, normalizeGlass, type GlassSettings } from "@/src/lib/glass-model";

export {
  GLASS_BACKDROPS,
  GLASS_STYLES,
  type GlassBackdrop,
  type GlassSettings,
  type GlassStyle,
} from "@/src/lib/glass-model";

export const GLASS_STORAGE_KEY = "decave.glass.v1";

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
