// Shared forum contract + pure helpers (Worker and client).

import { englishErrorText, errorText, type ErrorText } from "./i18n/error-code.ts";
import { readServerNotice, type ServerNotice } from "./i18n/server-notices.ts";

export const FORUM_POST_PREFIX = "__DECAVE_FORUM_POST_V1__";
export const EVENT_MESSAGE_PREFIX = "__DECAVE_EVENT__";
/** Message prefixes whose presence cannot be added or removed by editing. */
export const STRUCTURED_MESSAGE_PREFIXES = [
  FORUM_POST_PREFIX,
  EVENT_MESSAGE_PREFIX,
  "__DECAVE_POLL__",
  "__DECAVE_BOT__",
] as const;

export const FORUM_TAG_LIMITS = { maxTags: 20, maxTagLength: 24, maxTagsPerPost: 5 } as const;
export const FORUM_PAGE_SIZE = 25;
export const FORUM_REPLY_PAGE_SIZE = 50;

export type ForumSort = "active" | "new" | "top" | "unanswered";
export const FORUM_SORTS: readonly ForumSort[] = ["active", "new", "top", "unanswered"];

/** Post kinds. Older clients ignore the field and render every post as a discussion. */
export const FORUM_POST_TYPES = ["discussion", "question", "guide", "media", "poll", "lfg"] as const;
export type ForumPostType = (typeof FORUM_POST_TYPES)[number];

export const FORUM_POLL_LIMITS = {
  minOptions: 2,
  maxOptions: 6,
  maxOptionLength: 80,
  maxDurationMs: 30 * 24 * 60 * 60 * 1000,
} as const;
export const FORUM_LFG_LIMITS = { maxGameLength: 60, maxPlatformLength: 30, minSlots: 1, maxSlots: 64 } as const;
export const FORUM_MEDIA_URL_MAX = 500;

export type ForumPoll = { options: string[]; multi: boolean; endsAt: number | null };
export type ForumLfg = { game: string; platform: string; slots: number; startAt: number | null };
export type ForumMedia = { url: string; mime?: string };

export type ForumPostPayload = {
  version: 1;
  title: string;
  tags: string[];
  body: string;
  iconUrl?: string;
  // Optional extensions (backward compatible; absent = legacy discussion post).
  type?: ForumPostType;
  poll?: ForumPoll;
  lfg?: ForumLfg;
  media?: ForumMedia;
  /** Staff-only: the post is created with replies locked. */
  repliesLocked?: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isTime = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const cleanText = (value: string) =>
  value
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
const isPostType = (value: unknown): value is ForumPostType =>
  typeof value === "string" && (FORUM_POST_TYPES as readonly string[]).includes(value);

function readExtras(raw: Record<string, unknown>): Partial<ForumPostPayload> {
  if (!isPostType(raw.type)) return {};
  const type = raw.type;
  const out: Partial<ForumPostPayload> = { type };
  if (type === "poll" && isRecord(raw.poll) && Array.isArray(raw.poll.options)) {
    const options = raw.poll.options
      .filter((x): x is string => typeof x === "string")
      .slice(0, FORUM_POLL_LIMITS.maxOptions);
    if (options.length >= FORUM_POLL_LIMITS.minOptions)
      out.poll = { options, multi: raw.poll.multi === true, endsAt: isTime(raw.poll.endsAt) ? raw.poll.endsAt : null };
  }
  if (type === "lfg" && isRecord(raw.lfg) && typeof raw.lfg.game === "string") {
    const slots = typeof raw.lfg.slots === "number" && Number.isFinite(raw.lfg.slots) ? Math.round(raw.lfg.slots) : 1;
    out.lfg = {
      game: raw.lfg.game,
      platform: typeof raw.lfg.platform === "string" ? raw.lfg.platform : "",
      slots: Math.min(FORUM_LFG_LIMITS.maxSlots, Math.max(FORUM_LFG_LIMITS.minSlots, slots)),
      startAt: isTime(raw.lfg.startAt) ? raw.lfg.startAt : null,
    };
  }
  if (type === "media" && isRecord(raw.media) && typeof raw.media.url === "string")
    out.media = { url: raw.media.url, ...(typeof raw.media.mime === "string" ? { mime: raw.media.mime } : {}) };
  if (raw.repliesLocked === true) out.repliesLocked = true;
  return out;
}

/**
 * Strict server-side validation of the optional post extensions. Returns an
 * error code (errors catalog) and its params, or null when acceptable. Legacy payloads (no extension
 * fields) always pass.
 */
export function forumPostExtrasProblem(
  raw: unknown,
  now = Date.now(),
  options: { isEdit?: boolean } = {},
): ErrorText | null {
  const problem = errorText;
  if (!isRecord(raw)) return problem("forumPost.invalid");
  const type = raw.type;
  if (type !== undefined && !isPostType(type)) return problem("forumPost.unknownType");
  if (raw.repliesLocked !== undefined && typeof raw.repliesLocked !== "boolean")
    return problem("forumPost.repliesLockedInvalid");
  if (raw.poll !== undefined) {
    if (type !== "poll") return problem("forumPost.pollOnlyOnPolls");
    const poll = raw.poll;
    if (!isRecord(poll) || !Array.isArray(poll.options)) return problem("forumPost.pollOptionsRequired");
    if (poll.options.length < FORUM_POLL_LIMITS.minOptions || poll.options.length > FORUM_POLL_LIMITS.maxOptions)
      return problem("forumPost.pollOptionCount", {
        min: FORUM_POLL_LIMITS.minOptions,
        max: FORUM_POLL_LIMITS.maxOptions,
      });
    const seen = new Set<string>();
    for (const option of poll.options) {
      if (typeof option !== "string" || !cleanText(option)) return problem("forumPost.pollOptionEmpty");
      if (Array.from(option).length > FORUM_POLL_LIMITS.maxOptionLength)
        return problem("forumPost.pollOptionTooLong", { max: FORUM_POLL_LIMITS.maxOptionLength });
      const key = cleanText(option).toLowerCase();
      if (seen.has(key)) return problem("forumPost.pollOptionsDuplicate");
      seen.add(key);
    }
    if (poll.multi !== undefined && typeof poll.multi !== "boolean") return problem("forumPost.pollMultiInvalid");
    if (poll.endsAt !== undefined && poll.endsAt !== null) {
      if (!isTime(poll.endsAt)) return problem("forumPost.pollEndInvalid");
      if (!options.isEdit && poll.endsAt <= now) return problem("forumPost.pollEndPast");
      if (!options.isEdit && poll.endsAt > now + FORUM_POLL_LIMITS.maxDurationMs)
        return problem("forumPost.pollTooLong");
    }
  } else if (type === "poll") return problem("forumPost.pollPostNeedsOptions");
  if (raw.lfg !== undefined) {
    if (type !== "lfg") return problem("forumPost.lfgOnlyOnLfg");
    const lfg = raw.lfg;
    if (!isRecord(lfg) || typeof lfg.game !== "string" || !cleanText(lfg.game))
      return problem("forumPost.lfgGameRequired");
    if (Array.from(lfg.game).length > FORUM_LFG_LIMITS.maxGameLength)
      return problem("forumPost.lfgGameTooLong", { max: FORUM_LFG_LIMITS.maxGameLength });
    if (
      lfg.platform !== undefined &&
      (typeof lfg.platform !== "string" || Array.from(lfg.platform).length > FORUM_LFG_LIMITS.maxPlatformLength)
    )
      return problem("forumPost.lfgPlatformTooLong", { max: FORUM_LFG_LIMITS.maxPlatformLength });
    if (
      typeof lfg.slots !== "number" ||
      !Number.isInteger(lfg.slots) ||
      lfg.slots < FORUM_LFG_LIMITS.minSlots ||
      lfg.slots > FORUM_LFG_LIMITS.maxSlots
    )
      return problem("forumPost.lfgSlotsInvalid", { min: FORUM_LFG_LIMITS.minSlots, max: FORUM_LFG_LIMITS.maxSlots });
    if (lfg.startAt !== undefined && lfg.startAt !== null && !isTime(lfg.startAt))
      return problem("forumPost.lfgStartInvalid");
  } else if (type === "lfg") return problem("forumPost.lfgPostNeedsDetails");
  if (raw.media !== undefined) {
    if (type !== "media") return problem("forumPost.mediaOnlyOnMedia");
    const media = raw.media;
    if (!isRecord(media) || typeof media.url !== "string" || !media.url || media.url.length > FORUM_MEDIA_URL_MAX)
      return problem("forumPost.mediaLinkInvalid");
    if (
      media.mime !== undefined &&
      (typeof media.mime !== "string" || !/^[\w.+-]+\/[\w.+-]+$/.test(media.mime) || media.mime.length > 100)
    )
      return problem("forumPost.mediaTypeInvalid");
    if (!media.url.startsWith("/uploads/")) {
      try {
        if (new URL(media.url).protocol !== "https:") return problem("forumPost.mediaLinkNotHttps");
      } catch {
        return problem("forumPost.mediaLinkInvalid");
      }
    }
  }
  return null;
}

/** forumPostExtrasProblem() as English text, or null when acceptable. */
export function validateForumPostExtras(
  raw: unknown,
  now = Date.now(),
  options: { isEdit?: boolean } = {},
): string | null {
  const problem = forumPostExtrasProblem(raw, now, options);
  return problem ? englishErrorText(problem.code, problem.params) : null;
}

/** Parse the raw JSON body of a forum post text (no field filtering). */
export function rawForumPostJson(text: string): unknown {
  if (!text.startsWith(FORUM_POST_PREFIX)) return null;
  try {
    return JSON.parse(text.slice(FORUM_POST_PREFIX.length));
  } catch {
    return null;
  }
}

/**
 * DeCave-written parts of a bot's forum post (Twitch clips) as notices: `titleNotice`
 * stands for the title, `notice` for the body. Clients show them in the reader's
 * language only for bot-authored posts, so a member can't borrow DeCave's wording.
 */
export function forumPostNotices(text: string): { title: ServerNotice | null; body: ServerNotice | null } {
  const raw = rawForumPostJson(text);
  if (!isRecord(raw)) return { title: null, body: null };
  return { title: readServerNotice(raw.titleNotice), body: readServerNotice(raw.notice) };
}

export function structuredPrefixOf(text: string): string | null {
  for (const prefix of STRUCTURED_MESSAGE_PREFIXES) if (text.startsWith(prefix)) return prefix;
  return null;
}

export function parseForumPostPayload(text: string): ForumPostPayload | null {
  if (!text.startsWith(FORUM_POST_PREFIX)) return null;
  try {
    const raw = JSON.parse(text.slice(FORUM_POST_PREFIX.length)) as Record<string, unknown>;
    if (!raw || typeof raw !== "object" || typeof raw.title !== "string") return null;
    return {
      version: 1,
      title: raw.title,
      tags: Array.isArray(raw.tags) ? raw.tags.filter((x): x is string => typeof x === "string") : [],
      body: typeof raw.body === "string" ? raw.body : "",
      ...(typeof raw.iconUrl === "string" ? { iconUrl: raw.iconUrl } : {}),
      ...readExtras(raw),
    };
  } catch {
    return null;
  }
}

/** Normalize a moderator tag list: trimmed, ≤24 chars, case-insensitively unique, ≤20 tags. */
export function normalizeForumTags(value: unknown): { ok: true; tags: string[] } | ({ ok: false } & ErrorText) {
  if (value === undefined || value === null) return { ok: true, tags: [] };
  if (!Array.isArray(value)) return { ok: false, ...errorText("forumTags.notStrings") };
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") return { ok: false, ...errorText("forumTags.notStrings") };
    const tag = entry
      .normalize("NFC")
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!tag) continue;
    if (Array.from(tag).length > FORUM_TAG_LIMITS.maxTagLength)
      return { ok: false, ...errorText("forumTags.tooLong", { max: FORUM_TAG_LIMITS.maxTagLength }) };
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  if (tags.length > FORUM_TAG_LIMITS.maxTags)
    return { ok: false, ...errorText("forumTags.tooMany", { max: FORUM_TAG_LIMITS.maxTags }) };
  return { ok: true, tags };
}

export function safeJsonStringArray(value: unknown): string[] {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
