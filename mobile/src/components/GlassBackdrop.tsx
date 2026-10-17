import { Image, StyleSheet } from "react-native";
import { startupGlass, type GlassBackdrop as Backdrop } from "@/src/glass-data";
import { glassActive, startupSkinId } from "@/src/theme";

// Pre-blurred pictures: see-through panels over them read as glass without
// live blur, so scrolling stays smooth on every phone.
const WALLPAPERS: Record<Exclude<Backdrop, "skin">, number> = {
  aurora: require("../../assets/glass/aurora.jpg"),
  sunset: require("../../assets/glass/sunset.jpg"),
  ocean: require("../../assets/glass/ocean.jpg"),
  forest: require("../../assets/glass/forest.jpg"),
  graphite: require("../../assets/glass/graphite.jpg"),
};

const SKIN_WALLPAPERS: Record<string, number> = {
  neon: require("../../assets/glass/skin-neon.jpg"),
  nebula: require("../../assets/glass/skin-nebula.jpg"),
  arctic: require("../../assets/glass/skin-arctic.jpg"),
  crimson: require("../../assets/glass/skin-crimson.jpg"),
  royal: require("../../assets/glass/skin-royal.jpg"),
  pearl: require("../../assets/glass/skin-pearl.jpg"),
  obsidian: require("../../assets/glass/skin-obsidian.jpg"),
};

/** The picture for a backdrop; "skin" follows the given skin's colors. */
export function glassWallpaper(backdrop: Backdrop, skinId: string): number {
  return backdrop === "skin" ? (SKIN_WALLPAPERS[skinId] ?? SKIN_WALLPAPERS.neon) : WALLPAPERS[backdrop];
}

/** Fills the window behind every screen while Liquid Glass is on. */
export function GlassBackdrop() {
  if (!glassActive) return null;
  return (
    <Image
      source={glassWallpaper(startupGlass.backdrop, startupSkinId)}
      style={StyleSheet.absoluteFill}
      resizeMode="cover"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}
