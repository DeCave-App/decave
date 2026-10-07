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

export function safeGiphyUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value, HTTP_URL);
    if (parsed.origin === HTTP_URL && parsed.pathname === "/api/giphy/media") {
      const source = new URL(parsed.searchParams.get("url") || "");
      return isTrustedGiphySource(source) ? parsed.toString() : null;
    }
    if (isTrustedGiphySource(parsed)) {
      const proxy = new URL("/api/giphy/media", HTTP_URL);
      proxy.searchParams.set("url", parsed.toString());
      return proxy.toString();
    }
  } catch {}
  return null;
}

function isTrustedGiphySource(parsed: URL): boolean {
  const host = parsed.hostname.toLowerCase();
  return (
    parsed.protocol === "https:" &&
    !parsed.port &&
    !parsed.username &&
    !parsed.password &&
    ([
      "media.giphy.com",
      "media0.giphy.com",
      "media1.giphy.com",
      "media2.giphy.com",
      "media3.giphy.com",
      "media4.giphy.com",
    ].includes(host) ||
      (host === "giphy.com" && parsed.pathname.startsWith("/media/")))
  );
}

export function safeForumIconUrl(value: string | undefined): string | null {
  if (!value) return null;
  if (value.startsWith("/uploads/")) return `${HTTP_URL}${value}`;
  if (value.startsWith(`${HTTP_URL}/uploads/`)) return value;
  return null;
}
