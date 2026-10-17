// Liquid Glass settings and colors with no React Native imports, so the rules
// can be tested in Node. Storage lives in src/glass-data.ts.

export type GlassStyle = "clear" | "tinted";
/** "skin" uses the current skin's colors; the rest are built-in wallpapers. */
export type GlassBackdrop = "skin" | "aurora" | "sunset" | "ocean" | "forest" | "graphite";

export const GLASS_STYLES: readonly GlassStyle[] = ["clear", "tinted"];
export const GLASS_BACKDROPS: readonly GlassBackdrop[] = ["skin", "aurora", "sunset", "ocean", "forest", "graphite"];

export type GlassSettings = { enabled: boolean; style: GlassStyle; backdrop: GlassBackdrop };

export const DEFAULT_GLASS: GlassSettings = { enabled: false, style: "clear", backdrop: "skin" };

export function normalizeGlass(value: unknown): GlassSettings {
  const raw = (value && typeof value === "object" ? value : {}) as Partial<GlassSettings>;
  return {
    enabled: raw.enabled === true,
    style: raw.style === "tinted" ? "tinted" : "clear",
    backdrop: GLASS_BACKDROPS.includes(raw.backdrop as GlassBackdrop) ? (raw.backdrop as GlassBackdrop) : "skin",
  };
}

/** Same color at a new opacity; accepts #rrggbb and rgb()/rgba(). */
export function withAlpha(color: string, alpha: number): string {
  if (color.startsWith("#")) {
    const value = parseInt(color.slice(1), 16);
    return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
  }
  const parts = color.match(/[\d.]+/g) ?? ["0", "0", "0"];
  return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha})`;
}

export type GlassSurfaceBase = { bg: string; panel: string; panel2: string; nav: string; border: string };

/**
 * Page and panel colors while glass is on: pages are see-through so the
 * backdrop shows, and panels are lightly frosted (clear) or tinted with the skin.
 */
export function glassSurfaces(base: GlassSurfaceBase, style: GlassStyle): GlassSurfaceBase & { input: string } {
  if (style === "tinted") {
    return {
      bg: "transparent",
      panel: withAlpha(base.panel, 0.66),
      panel2: withAlpha(base.panel2, 0.62),
      nav: withAlpha(base.bg, 0.74),
      input: withAlpha(base.bg, 0.5),
      border: "rgba(255, 255, 255, 0.14)",
    };
  }
  return {
    bg: "transparent",
    panel: "rgba(255, 255, 255, 0.08)",
    panel2: "rgba(255, 255, 255, 0.12)",
    nav: "rgba(10, 10, 22, 0.4)",
    input: "rgba(255, 255, 255, 0.07)",
    border: "rgba(255, 255, 255, 0.16)",
  };
}
