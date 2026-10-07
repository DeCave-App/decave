// Polls, events, stickers, GIFs, bot messages and DM attachments travel as prefixed JSON inside message text.

import type { EventInviteMode, EventPayload } from "./types";
import { HTTP_URL } from "./env";

export const POLL_PREFIX = "__DECAVE_POLL__";
export const EVENT_PREFIX = "__DECAVE_EVENT__";
export const DM_ATTACHMENT_PREFIX = "__DECAVE_DM_ATTACHMENT__";
export const STICKER_PREFIX = "__DECAVE_STICKER__";
export const BOT_PREFIX = "__DECAVE_BOT__";
export const GIF_PREFIX = "__DECAVE_GIF__";

export function parsePrefixedJson<T>(text: string, prefix: string): T | null {
  if (!text.startsWith(prefix)) return null;
  try {
    return JSON.parse(text.slice(prefix.length)) as T;
  } catch {
    return null;
  }
}

export function parseHubCalendarEvent(text: string): EventPayload | null {
  const raw = parsePrefixedJson<Partial<EventPayload>>(text, EVENT_PREFIX);
  if (!raw || typeof raw.title !== "string" || typeof raw.startAt !== "string") return null;
  const title = raw.title.trim().slice(0, 100);
  const startAt = raw.startAt.trim();
  if (!title || Number.isNaN(Date.parse(startAt))) return null;
  const inviteMode: EventInviteMode = raw.inviteMode === "selected" ? "selected" : "all";
  const invitedUserIds = Array.isArray(raw.invitedUserIds)
    ? raw.invitedUserIds.filter((value): value is string => typeof value === "string").slice(0, 100)
    : [];
  const invitedUsernames = Array.isArray(raw.invitedUsernames)
    ? raw.invitedUsernames
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.slice(0, 80))
        .slice(0, 100)
    : [];
  return {
    title,
    startAt,
    description: typeof raw.description === "string" ? raw.description.trim().slice(0, 600) : "",
    inviteMode,
    invitedUserIds,
    invitedUsernames,
  };
}

/**
 * Canonical GIPHY media URL (https, media.giphy.com / mediaN.giphy.com / i.giphy.com,
 * plain .gif/.webp/.mp4 path, no query) or null. Mirrors the Worker's media proxy rules.
 */
export function safeGiphyUrl(value: string | undefined): string | null {
  if (!value || value.length > 2048) return null;
  // Percent-encoded or backslash path bytes are never part of a GIPHY media path.
  if (/[%\\]/.test(value.split(/[?#]/, 1)[0] ?? "")) return null;
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase();
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) return null;
    if (hostname !== "media.giphy.com" && hostname !== "i.giphy.com" && !/^media[0-9]\.giphy\.com$/.test(hostname)) {
      return null;
    }
    const segments = parsed.pathname.split("/").slice(1);
    if (segments.length < 1 || segments.length > 6) return null;
    if (segments.some((segment) => !/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,159}$/.test(segment) || segment.includes(".."))) {
      return null;
    }
    if (!/\.(?:gif|webp|mp4)$/i.test(segments[segments.length - 1] ?? "")) return null;
    return `https://${hostname}/${segments.join("/")}`;
  } catch {}
  return null;
}

/**
 * Same-origin proxy address for a GIPHY media URL, so viewers' devices never
 * contact GIPHY. The session cookie authenticates the request.
 */
export function giphyMediaProxyUrl(value: string | undefined): string | null {
  const safe = safeGiphyUrl(value);
  return safe ? `${HTTP_URL}/api/giphy/media?u=${encodeURIComponent(safe)}` : null;
}

export function safeForumIconUrl(value: string | undefined): string | null {
  if (!value) return null;
  if (value.startsWith("/uploads/")) return `${HTTP_URL}${value}`;
  if (value.startsWith(`${HTTP_URL}/uploads/`)) return value;
  return null;
}

// List previews for DM and group messages are shared with the mobile app.
export { dmPreviewText } from "../../shared/dm-message-preview";
