import { useEffect, useState } from "react";
import { reloadAppAsync } from "expo";
import * as SecureStore from "expo-secure-store";
import { colorMode, colors, startupSkinId } from "@/src/theme";
import { SKINS, SKIN_STORAGE_KEY, type Palette, type SkinId } from "@/src/skins-data";

export { SKINS, type SkinDefinition, type SkinId } from "@/src/skins-data";

let currentSkin: SkinId = startupSkinId;
const listeners = new Set<() => void>();

/**
 * Styles are built once at startup from the saved skin (see theme.ts), so a
 * new skin is saved and the app reloads, the same as switching Dark/Light.
 */
export async function setSkin(id: SkinId) {
  currentSkin = id;
  for (const listener of listeners) listener();
  try {
    await SecureStore.setItemAsync(SKIN_STORAGE_KEY, id);
  } catch {}
  await reloadAppAsync("Skin changed");
}

export function useSkin() {
  const [, setRevision] = useState(0);

  useEffect(() => {
    const listener = () => setRevision((value) => value + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const skin = SKINS.find((item) => item.id === currentSkin) ?? SKINS[0];
  // Light mode keeps light surfaces and takes the skin's accent (already applied to colors).
  const palette: Palette =
    colorMode === "light"
      ? { bg: colors.bg, panel: colors.panel, panel2: colors.panel2, nav: colors.nav, border: colors.border, text: colors.text, muted: colors.muted, accent: colors.violet, accentSoft: colors.violetSoft }
      : skin.palette;
  return { skin, palette, setSkin };
}
