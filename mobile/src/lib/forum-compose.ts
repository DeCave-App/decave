// The New post draft: validation and the payload it publishes, matching web's
// ForumComposeModal (src/features/forum/ForumComposeModal.tsx). Pure, so it
// can be tested without React Native.

import {
  FORUM_LFG_LIMITS,
  FORUM_MEDIA_URL_MAX,
  FORUM_POLL_LIMITS,
  FORUM_TAG_LIMITS,
  type ForumPostPayload,
  type ForumPostType,
} from "../../../shared/forum";

export const FORUM_COMPOSE_TITLE_MAX = 120;
export const FORUM_COMPOSE_BODY_MAX = 3200;
export const FORUM_COMPOSE_MAX_TAGS = FORUM_TAG_LIMITS.maxTagsPerPost;

export const POLL_DURATIONS = [
  { id: "none", ms: 0 },
  { id: "h1", ms: 3_600_000 },
  { id: "d1", ms: 86_400_000 },
  { id: "d3", ms: 3 * 86_400_000 },
  { id: "w1", ms: 7 * 86_400_000 },
  { id: "d30", ms: FORUM_POLL_LIMITS.maxDurationMs },
] as const;

/** LFG start choices (mobile has no date-time field): offsets from now. */
export const LFG_STARTS = [
  { id: "none", ms: 0 },
  { id: "now", ms: 1 },
  { id: "h1", ms: 3_600_000 },
  { id: "h3", ms: 3 * 3_600_000 },
  { id: "d1", ms: 86_400_000 },
] as const;

export const LFG_PLATFORMS = ["PC", "PlayStation", "Xbox", "Switch", "Mobile", "Cross-play"] as const;

export type ForumDraft = {
  type: ForumPostType;
  title: string;
  body: string;
  tags: string[];
  iconUrl: string;
  pollOptions: string[];
  pollMulti: boolean;
  pollDurationMs: number;
  lfgGame: string;
  lfgPlatform: string;
  lfgSlots: number;
  lfgStartMs: number;
  mediaUrl: string;
  mediaMime: string;
  repliesLocked: boolean;
};

export const EMPTY_FORUM_DRAFT: ForumDraft = {
  type: "discussion",
  title: "",
  body: "",
  tags: [],
  iconUrl: "",
  pollOptions: ["", ""],
  pollMulti: false,
  pollDurationMs: 86_400_000,
  lfgGame: "",
  lfgPlatform: "",
  lfgSlots: 1,
  lfgStartMs: 0,
  mediaUrl: "",
  mediaMime: "",
  repliesLocked: false,
};

export type ForumDraftErrorKey = "title" | "body" | "pollOptions" | "pollDuplicate" | "lfgGame" | "media" | "mediaHttps";

/** The first problem with the draft, as a forum.compose.errors.* key, or null when it can be published. */
export function forumDraftError(draft: ForumDraft): ForumDraftErrorKey | null {
  const bodyOptional = draft.type === "poll" || draft.type === "lfg" || draft.type === "media";
  if (!draft.title.trim()) return "title";
  if (!bodyOptional && !draft.body.trim()) return "body";
  if (draft.type === "poll") {
    const options = draft.pollOptions.map((option) => option.trim()).filter(Boolean);
    if (options.length < FORUM_POLL_LIMITS.minOptions) return "pollOptions";
    if (new Set(options.map((option) => option.toLowerCase())).size !== options.length) return "pollDuplicate";
  }
  if (draft.type === "lfg" && !draft.lfgGame.trim()) return "lfgGame";
  if (draft.type === "media") {
    const url = draft.mediaUrl.trim();
    if (!url) return "media";
    if (!url.startsWith("/uploads/") && !/^https:\/\/\S+$/.test(url)) return "mediaHttps";
  }
  return null;
}

export function toggleDraftTag(tags: readonly string[], tag: string): string[] {
  const clean = tag.trim().slice(0, FORUM_TAG_LIMITS.maxTagLength);
  if (!clean) return [...tags];
  if (tags.some((item) => item.toLowerCase() === clean.toLowerCase()))
    return tags.filter((item) => item.toLowerCase() !== clean.toLowerCase());
  return tags.length >= FORUM_COMPOSE_MAX_TAGS ? [...tags] : [...tags, clean];
}

/** The payload web would publish for this draft (without `version`). */
export function buildForumPayload(
  draft: ForumDraft,
  now: number,
  { canLockReplies }: { canLockReplies: boolean },
): Omit<ForumPostPayload, "version"> {
  const payload: Omit<ForumPostPayload, "version"> = {
    title: draft.title.trim().slice(0, FORUM_COMPOSE_TITLE_MAX),
    tags: draft.tags.slice(0, FORUM_COMPOSE_MAX_TAGS),
    body: draft.body.trim().slice(0, FORUM_COMPOSE_BODY_MAX),
    ...(draft.iconUrl ? { iconUrl: draft.iconUrl } : {}),
    type: draft.type,
  };
  if (draft.type === "poll")
    payload.poll = {
      options: draft.pollOptions
        .map((option) => option.trim())
        .filter(Boolean)
        .slice(0, FORUM_POLL_LIMITS.maxOptions)
        .map((option) => option.slice(0, FORUM_POLL_LIMITS.maxOptionLength)),
      multi: draft.pollMulti,
      endsAt: draft.pollDurationMs ? now + draft.pollDurationMs : null,
    };
  if (draft.type === "lfg")
    payload.lfg = {
      game: draft.lfgGame.trim().slice(0, FORUM_LFG_LIMITS.maxGameLength),
      platform: draft.lfgPlatform.trim().slice(0, FORUM_LFG_LIMITS.maxPlatformLength),
      slots: Math.min(FORUM_LFG_LIMITS.maxSlots, Math.max(FORUM_LFG_LIMITS.minSlots, Math.round(draft.lfgSlots))),
      startAt: draft.lfgStartMs ? now + draft.lfgStartMs : null,
    };
  if (draft.type === "media" && draft.mediaUrl.trim())
    payload.media = {
      url: draft.mediaUrl.trim().slice(0, FORUM_MEDIA_URL_MAX),
      ...(draft.mediaMime ? { mime: draft.mediaMime.slice(0, 100) } : {}),
    };
  if (canLockReplies && draft.repliesLocked) payload.repliesLocked = true;
  return payload;
}
