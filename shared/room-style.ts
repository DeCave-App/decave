// Per-room styling: an optional accent colour that overrides the Hub accent
// inside one room. Shared by the Worker (validation), web and mobile clients.

/** Curated swatches that stay readable on every Hub theme. */
export const ROOM_ACCENT_SWATCHES: ReadonlyArray<{ color: string; label: string }> = [
  { color: "#7c5cff", label: "Violet" },
  { color: "#4f8cff", label: "Blue" },
  { color: "#22b8cf", label: "Cyan" },
  { color: "#2dd4a7", label: "Teal" },
  { color: "#3fb950", label: "Green" },
  { color: "#a3d930", label: "Lime" },
  { color: "#f5c518", label: "Yellow" },
  { color: "#f5a524", label: "Amber" },
  { color: "#f0703c", label: "Orange" },
  { color: "#ef4f5f", label: "Red" },
  { color: "#ec5fa8", label: "Pink" },
  { color: "#8b96a5", label: "Steel" },
];

const HEX = /^#[0-9a-f]{6}$/;

/**
 * Parses a submitted room accent. `null` (or "") clears it so the room uses
 * the Hub accent. Returns `undefined` for anything that is not `#rrggbb`.
 */
export function parseRoomAccent(value: unknown): string | null | undefined {
  if (value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  return HEX.test(normalized) ? normalized : undefined;
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a `#rrggbb` colour. */
export function relativeLuminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** Text colour (near-black or white) with the higher contrast on the accent. */
export function roomAccentInk(hex: string): "#0b0d12" | "#ffffff" {
  const lum = relativeLuminance(hex);
  const onWhite = 1.05 / (lum + 0.05);
  const onDark = (lum + 0.05) / (relativeLuminance("#0b0d12") + 0.05);
  return onDark >= onWhite ? "#0b0d12" : "#ffffff";
}
