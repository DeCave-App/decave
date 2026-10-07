// Shared by the Hub screen and its parts: room types and icons, sorting, Hub
// member shape, asset URLs and the split-view context.

import type { Channel } from "@/src/types";
import { API_BASE } from "@/src/lib/api";
import { createContext } from "react";

export type RoomType = "text" | "voice" | "forum";

// Same picks as the web room settings, so rooms look identical everywhere.
export const ROOM_ICON_CHOICES = ["💬", "#", "🎮", "📣", "📌", "🛠️", "🎵", "🏆", "🎙️", "🔊", "🕹️", "🔥", "💗", "✨", "🌙", "📜", "❓"];

export function roomTypeOf(channel: Channel): RoomType {
  return channel.type === "forum" || channel.kind === "forum" ? "forum" : channel.type;
}

export function byPosition(a: Channel, b: Channel): number {
  return (a.position ?? 0) - (b.position ?? 0) || a.id - b.id;
}

export type HubMember = {
  userId: string;
  username: string;
  role: "owner" | "admin" | "member";
  avatarUrl?: string | null;
};

export function assetUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^(https?:|data:|file:)/i.test(value)) return value;
  return `${API_BASE}${value.startsWith("/") ? "" : "/"}${value}`;
}

/** iPad split view: text rooms open in the right pane instead of a new screen. */
export type SplitRoom = { id: number; name: string; forum: boolean };

export const SplitContext = createContext<{ selected: SplitRoom | null; select: (room: SplitRoom) => void } | null>(null);

export const SPLIT_MIN_WIDTH = 700;
