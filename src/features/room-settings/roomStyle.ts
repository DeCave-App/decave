// Per-room styling on the web client: turns a room's accent and background
// into CSS custom properties. The design-system tokens are computed once on
// :root, so a scope has to override the derived --ds-* tokens, not just
// --gc-accent.

import type { CSSProperties } from "react";
import { parseRoomAccent, roomAccentInk } from "../../../shared/room-style";

/** Accent tokens for one room; empty when the room uses the Hub accent. */
export function roomAccentVars(accent: string | null | undefined): CSSProperties {
  const color = parseRoomAccent(accent);
  if (!color) return {};
  return {
    "--gc-accent": color,
    "--gc-accent-2": color,
    "--ds-accent": color,
    "--ds-accent-2": color,
    "--ds-accent-text": color,
    "--ds-on-accent": roomAccentInk(color),
    "--ds-accent-soft": `color-mix(in srgb, ${color} 16%, transparent)`,
    "--ds-active": `color-mix(in srgb, ${color} 20%, transparent)`,
  } as CSSProperties;
}

/** Accent plus the room's own chat background (which replaces the Hub's). */
export function roomWorkspaceStyle(
  room: { accent?: string | null; backgroundUrl?: string | null },
  mediaBase: string,
): CSSProperties {
  return {
    ...roomAccentVars(room.accent),
    ...(room.backgroundUrl ? { "--dc-chat-background": `url(${mediaBase}${room.backgroundUrl})` } : {}),
  } as CSSProperties;
}
