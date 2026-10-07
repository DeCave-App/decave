import * as SecureStore from "expo-secure-store";
import { isSkinId, SKINS, SKIN_STORAGE_KEY, type SkinId } from "@/src/skins-data";

export type ColorMode = "dark" | "light";
export const COLOR_MODE_KEY = "decave.colorMode";

const dark = {
  bg: "#09080D",
  panel: "#14121B",
  panel2: "#1B1825",
  nav: "rgba(20, 17, 29, 0.96)",
  input: "#120F19",

  border: "rgba(255, 255, 255, 0.08)",
  borderStrong: "rgba(255, 255, 255, 0.14)",

  text: "#ECEAF2",
  muted: "#A29DB2",
  faint: "#7D7890",

  cyan: "#22D3EE",
  blue: "#4384FF",
  violet: "#7C3AED",
  green: "#43E29A",
  yellow: "#FFC65C",
  red: "#FF6678",
  pink: "#F472B6",
  lilac: "#C4B5FD",

  cyanSoft: "rgba(34, 211, 238, 0.10)",
  violetSoft: "rgba(139, 92, 246, 0.22)",
  greenSoft: "rgba(67, 226, 154, 0.09)",
  redSoft: "rgba(255, 102, 120, 0.10)",

  overlay: "rgba(5, 4, 9, 0.78)",
  /** Subtle fill for chips and buttons on top of panels. */
  wash: "rgba(255, 255, 255, 0.06)",
  /** Text and icons on top of `nav` and `panel` when selected. */
  strong: "#FFFFFF",
};

const light: typeof dark = {
  bg: "#F5F4F9",
  panel: "#FFFFFF",
  panel2: "#EEECF4",
  nav: "rgba(255, 255, 255, 0.97)",
  input: "#FFFFFF",

  border: "rgba(24, 18, 44, 0.10)",
  borderStrong: "rgba(24, 18, 44, 0.18)",

  text: "#17141F",
  muted: "#5B566C",
  faint: "#857F96",

  cyan: "#0B8BA3",
  blue: "#2F6FE0",
  violet: "#7C3AED",
  green: "#11905C",
  yellow: "#B7791F",
  red: "#D33650",
  pink: "#DB2777",
  lilac: "#6D4BD8",

  cyanSoft: "rgba(11, 139, 163, 0.10)",
  violetSoft: "rgba(124, 58, 237, 0.12)",
  greenSoft: "rgba(17, 144, 92, 0.10)",
  redSoft: "rgba(211, 54, 80, 0.10)",

  overlay: "rgba(24, 18, 44, 0.45)",
  wash: "rgba(24, 18, 44, 0.05)",
  strong: "#17141F",
};

function storedColorMode(): ColorMode {
  try {
    return SecureStore.getItem(COLOR_MODE_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

/**
 * Chosen once at startup, before any screen builds its StyleSheet, so every
 * style picks up the right palette. Changing it reloads the app.
 */
export const colorMode: ColorMode = storedColorMode();

function storedSkin(): SkinId {
  try {
    const saved = SecureStore.getItem(SKIN_STORAGE_KEY);
    return isSkinId(saved) ? saved : "neon";
  } catch {
    return "neon";
  }
}

/** Skin saved at startup; changing it reloads the app like the color mode. */
export const startupSkinId: SkinId = storedSkin();

function hexSoft(hex: string, alpha: number): string {
  const value = parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

function skinnedColors(): typeof dark {
  const skin = SKINS.find((item) => item.id === startupSkinId) ?? SKINS[0];
  if (colorMode === "light") {
    // Keep light surfaces; the skin only sets the accent, darkened for contrast.
    const accent = skin.lightAccent;
    return { ...light, cyan: accent, violet: accent, lilac: accent, cyanSoft: hexSoft(accent, 0.1), violetSoft: hexSoft(accent, 0.12) };
  }
  // Neon Lounge is the original dark palette.
  if (skin.id === "neon") return { ...dark };
  const palette = skin.palette;
  return {
    ...dark,
    bg: palette.bg,
    panel: palette.panel,
    panel2: palette.panel2,
    nav: palette.nav,
    input: palette.bg,
    border: palette.border,
    text: palette.text,
    muted: palette.muted,
    cyan: palette.accent,
    violet: palette.accent,
    lilac: palette.accent,
    cyanSoft: palette.accentSoft,
    violetSoft: palette.accentSoft,
  };
}

export const colors = skinnedColors();

export const radii = {
  xs: 8,
  sm: 10,
  md: 14,
  lg: 20,
  xl: 26,
  pill: 999,
};

export const spacing = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
};
