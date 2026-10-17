// Forum rooms on mobile use the same endpoints and wire format as web
// (src/features/forum/forumModel.ts, shared/forum.ts): posts are chat
// messages whose text is a FORUM_POST_PREFIX payload, replies are messages
// with replyToId = the post, and votes are reactions.

import { t } from "i18next";
import {
  FORUM_POST_PREFIX,
  FORUM_TAG_LIMITS,
  forumPostNotices,
  parseForumPostPayload,
  type ForumPostPayload,
  type ForumPostType,
  type ForumSort,
} from "../../../shared/forum";
import { apiErrorText, apiFetch } from "./api";
import { noticeText } from "./server-text";

export type { ForumPostPayload, ForumPostType, ForumSort };

export const FORUM_TITLE_MAX = 120;
export const FORUM_BODY_MAX = 3200;
export const FORUM_REPLY_MAX = 3800;
export const FORUM_MAX_TAGS_PER_POST = FORUM_TAG_LIMITS.maxTagsPerPost;

export const FORUM_TYPE_ICONS: Record<ForumPostType, string> = {
  discussion: "💬",
  question: "❓",
  guide: "📘",
  media: "🎬",
  poll: "📊",
  lfg: "🎮",
};

export type ForumAttachment = { id?: string; name: string; mimeType: string; size: number; url: string };

export type ForumMessage = {
  id: string;
  userId?: string;
  username: string;
  avatarUrl?: string | null;
  text: string;
  timestamp: string;
  channelId: number;
  editedAt?: string | null;
  replyToId?: string | null;
  reactions?: Record<string, string[]>;
  attachment?: ForumAttachment | null;
  bot?: unknown;
};

export type ForumEntry = {
  message: ForumMessage;
  payload: ForumPostPayload;
  replyCount: number;
  lastActivityAt: string;
  pinned: boolean;
  locked: boolean;
  solvedReplyId: string | null;
};

type RawEntry = Omit<ForumEntry, "payload">;

/** The post payload as shown: a bot's post (Twitch clips) uses DeCave's wording in the UI language. */
export function displayForumPayload(message: { text: string; bot?: unknown }): ForumPostPayload | null {
  const payload = parseForumPostPayload(message.text);
  if (!payload) return null;
  if (!message.bot) return payload;
  const notices = forumPostNotices(message.text);
  return {
    ...payload,
    title: noticeText(notices.title) ?? payload.title,
    body: noticeText(notices.body) ?? payload.body,
  };
}

export const postTypeOf = (payload: ForumPostPayload): ForumPostType => payload.type ?? "discussion";
/** Legacy posts carry no type and behave like discussions, which can still be solved. */
export const canBeSolved = (payload: ForumPostPayload): boolean => !payload.type || payload.type === "question";

export function toEntry(raw: RawEntry | null | undefined): ForumEntry | null {
  const payload = raw?.message ? displayForumPayload(raw.message) : null;
  if (!raw || !payload) return null;
  return {
    message: raw.message,
    payload,
    replyCount: Number(raw.replyCount) || 0,
    lastActivityAt: raw.lastActivityAt || raw.message.timestamp,
    pinned: raw.pinned === true,
    locked: raw.locked === true,
    solvedReplyId: typeof raw.solvedReplyId === "string" ? raw.solvedReplyId : null,
  };
}

export function encodeForumPost(payload: Omit<ForumPostPayload, "version">): string {
  return `${FORUM_POST_PREFIX}${JSON.stringify({ version: 1, ...payload } satisfies ForumPostPayload)}`;
}

/** Room tags set by moderators (Room settings → forum tags). */
export function roomForumTags(room: { forumTags?: unknown } | null | undefined): string[] {
  return Array.isArray(room?.forumTags)
    ? room.forumTags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
    : [];
}

export function forumScore(message: ForumMessage): number {
  return (message.reactions?.forum_vote_up?.length ?? 0) - (message.reactions?.forum_vote_down?.length ?? 0);
}

const ts = (value: string) => {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
};

/** Client re-sort for live updates; mirrors the server order (pinned first). */
export function sortEntries(entries: ForumEntry[], sort: ForumSort): ForumEntry[] {
  const list = sort === "unanswered" ? entries.filter((entry) => entry.replyCount === 0) : [...entries];
  return list.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (sort === "new") return ts(b.message.timestamp) - ts(a.message.timestamp);
    if (sort === "top") return forumScore(b.message) - forumScore(a.message) || ts(b.lastActivityAt) - ts(a.lastActivityAt);
    return ts(b.lastActivityAt) - ts(a.lastActivityAt);
  });
}

export function relativeTime(iso: string, now = Date.now()): string {
  const diff = Math.max(0, now - ts(iso));
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return t("forum.time.justNow");
  if (minutes < 60) return t("forum.time.minutesAgo", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("forum.time.hoursAgo", { count: hours });
  return t("forum.time.daysAgo", { count: Math.floor(hours / 24) });
}

/** Text without markdown images, plus the image urls (`![alt](url)`) shown under it. */
export function splitBodyImages(body: string): { text: string; images: { alt: string; url: string }[] } {
  const images: { alt: string; url: string }[] = [];
  const text = body
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_match, alt: string, url: string) => {
      images.push({ alt, url });
      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, images };
}

/** Poll votes on a post are `poll_<index>` reactions on the post message. */
export function forumPollTallies(reactions: Record<string, string[]> | undefined, optionCount: number, viewerId: string) {
  const keys = Array.from({ length: optionCount }, (_, index) => `poll_${index}`);
  const counts = keys.map((key) => reactions?.[key]?.length ?? 0);
  const mine = keys.map((key) => reactions?.[key]?.includes(viewerId) ?? false);
  const voters = new Set<string>();
  keys.forEach((key) => (reactions?.[key] ?? []).forEach((user) => voters.add(user)));
  return { counts, mine, total: counts.reduce((a, b) => a + b, 0), voters: voters.size };
}

/**
 * Reaction toggles for a forum poll vote: in a single-choice poll other votes
 * are removed first; the chosen key always toggles (tap again to unvote).
 */
export function forumPollVoteToggles(
  reactions: Record<string, string[]> | undefined,
  viewerId: string,
  optionIndex: number,
  multi: boolean,
): string[] {
  const key = `poll_${optionIndex}`;
  const others = multi
    ? []
    : Object.entries(reactions ?? {})
        .filter(([other, users]) => other.startsWith("poll_") && other !== key && users.includes(viewerId))
        .map(([other]) => other);
  return [...others, key];
}

/** Up and down votes are exclusive on the server, so a vote is one reaction toggle. */
export function forumVoteKey(direction: "up" | "down"): string {
  return direction === "up" ? "forum_vote_up" : "forum_vote_down";
}

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  const data = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !data) throw new Error(apiErrorText(data, fallback));
  return data;
}

export async function fetchForumPosts(
  token: string,
  roomId: number,
  query: { sort: ForumSort; tag: string | null; q: string; cursor: string | null },
): Promise<{ posts: ForumEntry[]; nextCursor: string | null }> {
  const params = new URLSearchParams({ sort: query.sort });
  if (query.tag) params.set("tag", query.tag);
  if (query.q.trim()) params.set("q", query.q.trim().slice(0, 100));
  if (query.cursor) params.set("cursor", query.cursor);
  const data = await readJson<{ posts?: RawEntry[]; nextCursor?: string | null }>(
    await apiFetch(`/api/channels/${roomId}/forum/posts?${params}`, {}, token),
    t("forum.api.loadPosts"),
  );
  return {
    posts: (data.posts ?? []).map(toEntry).filter((entry): entry is ForumEntry => entry !== null),
    nextCursor: data.nextCursor ?? null,
  };
}

export async function fetchForumPost(token: string, roomId: number, postId: string): Promise<ForumEntry | null> {
  const data = await readJson<{ post?: RawEntry }>(
    await apiFetch(`/api/channels/${roomId}/forum/posts/${encodeURIComponent(postId)}`, {}, token),
    t("forum.api.loadPost"),
  );
  return toEntry(data.post);
}

export async function fetchForumReplies(
  token: string,
  roomId: number,
  postId: string,
  cursor: string | null,
): Promise<{ replies: ForumMessage[]; nextCursor: string | null }> {
  const params = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const data = await readJson<{ replies?: ForumMessage[]; nextCursor?: string | null }>(
    await apiFetch(`/api/channels/${roomId}/forum/posts/${encodeURIComponent(postId)}/replies${params}`, {}, token),
    t("forum.api.loadReplies"),
  );
  return { replies: data.replies ?? [], nextCursor: data.nextCursor ?? null };
}

export type ForumPostStatePatch = { pinned?: boolean; locked?: boolean; solvedReplyId?: string | null };
export type ForumPostState = Pick<ForumEntry, "replyCount" | "lastActivityAt" | "pinned" | "locked" | "solvedReplyId">;

export async function patchForumPost(
  token: string,
  roomId: number,
  postId: string,
  patch: ForumPostStatePatch,
): Promise<ForumPostState> {
  return readJson<ForumPostState>(
    await apiFetch(
      `/api/channels/${roomId}/forum/posts/${encodeURIComponent(postId)}`,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) },
      token,
    ),
    t("forum.api.updatePost"),
  );
}

/** Toggles one reaction (a vote, a poll choice) on a post or reply; returns the updated message when the server sends it. */
export async function toggleForumReaction(
  token: string,
  roomId: number,
  messageId: string,
  emoji: string,
): Promise<ForumMessage | null> {
  const data = await readJson<{ message?: ForumMessage }>(
    await apiFetch(
      `/api/channels/${roomId}/messages/${encodeURIComponent(messageId)}/reactions`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ emoji }) },
      token,
    ),
    t("forum.view.updateFailed"),
  );
  return data.message ?? null;
}

export async function deleteForumMessage(token: string, roomId: number, messageId: string): Promise<void> {
  await readJson<unknown>(
    await apiFetch(`/api/channels/${roomId}/messages/${encodeURIComponent(messageId)}`, { method: "DELETE" }, token),
    t("chat.mobile.channel.couldNotDeleteMessage"),
  );
}

/** A realtime CHAT_MESSAGE frame in this room as a forum message, or null. */
export function forumMessageFromFrame(data: Record<string, unknown>, roomId: number): ForumMessage | null {
  if (data.type !== "CHAT_MESSAGE" || typeof data.id !== "string" || Number(data.channelId) !== roomId) return null;
  return {
    id: data.id,
    userId: typeof data.userId === "string" ? data.userId : undefined,
    username: typeof data.username === "string" ? data.username : t("forum.view.unknownUser"),
    avatarUrl: typeof data.avatarUrl === "string" ? data.avatarUrl : null,
    text: typeof data.text === "string" ? data.text : "",
    timestamp: typeof data.timestamp === "string" ? data.timestamp : new Date().toISOString(),
    channelId: roomId,
    replyToId: typeof data.replyToId === "string" ? data.replyToId : null,
    reactions: data.reactions && typeof data.reactions === "object" ? (data.reactions as Record<string, string[]>) : {},
    attachment: data.attachment && typeof data.attachment === "object" ? (data.attachment as ForumAttachment) : null,
    ...(data.bot ? { bot: data.bot } : {}),
  };
}
