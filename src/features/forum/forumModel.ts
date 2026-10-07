// Forum feature: shared types, permission rules, API helpers and local
// "last seen" bookkeeping. Wire format lives in shared/forum.ts.
import {
  FORUM_POST_PREFIX,
  parseForumPostPayload,
  type ForumPostPayload,
  type ForumPostType,
  type ForumSort,
} from "../../../shared/forum";
import { localeForLanguage } from "../../app/locale";

export type ForumAttachment = { id: string; name: string; mimeType: string; size: number; url: string };

/** Structural subset of App's ChatMessage (App's type is assignable to it). */
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

export type ForumPostPolicy = "everyone" | "staff" | "roles" | "members";

export type ForumRoom = {
  id: number;
  name: string;
  forumGuidelines?: string;
  forumPostPolicy?: ForumPostPolicy;
  forumPostRoleIds?: string[];
  forumPostMemberIds?: string[];
  forumTags?: unknown;
};

export type ForumViewer = {
  userId: string;
  hubRole: "owner" | "admin" | "member" | string | null | undefined;
  customRoles: { id: string; name: string; permissions: readonly string[] }[];
  /** False when the Hub is owner-only posting and the viewer is not the owner. */
  canPostInHub: boolean;
};

export const FORUM_SORT_LABELS: Record<ForumSort, string> = {
  active: "Active",
  new: "New",
  top: "Top",
  unanswered: "Unanswered",
};
export const FORUM_TITLE_MAX = 120;
export const FORUM_BODY_MAX = 3200;
export const FORUM_REPLY_MAX = 3800;

export { FORUM_POST_PREFIX, parseForumPostPayload };
export type { ForumPostPayload, ForumPostType, ForumSort };

export const FORUM_TYPE_META: Record<ForumPostType, { label: string; icon: string; hint: string }> = {
  discussion: { label: "Discussion", icon: "💬", hint: "Start an open conversation" },
  question: { label: "Question", icon: "❓", hint: "Ask for help, then mark the best answer" },
  guide: { label: "Guide", icon: "📘", hint: "Share a tutorial, build or walkthrough" },
  media: { label: "Clip / Media", icon: "🎬", hint: "Show off a clip, screenshot or video" },
  poll: { label: "Poll", icon: "📊", hint: "Let the community vote" },
  lfg: { label: "LFG", icon: "🎮", hint: "Looking for group: find teammates" },
};

/** Legacy posts carry no type and behave like discussions (solving stays available). */
export const postTypeOf = (payload: ForumPostPayload): ForumPostType => payload.type ?? "discussion";
export const canBeSolved = (payload: ForumPostPayload): boolean => !payload.type || payload.type === "question";

/** Poll votes are reactions keyed poll_<index> on the post message (same mechanism as chat polls). */
export function pollTallies(reactions: Record<string, string[]> | undefined, optionCount: number, viewerId: string) {
  const keys = Array.from({ length: optionCount }, (_, index) => `poll_${index}`);
  const counts = keys.map((key) => reactions?.[key]?.length ?? 0);
  const mine = keys.map((key) => reactions?.[key]?.includes(viewerId) ?? false);
  const voters = new Set<string>();
  keys.forEach((key) => (reactions?.[key] ?? []).forEach((user) => voters.add(user)));
  return { counts, mine, total: counts.reduce((a, b) => a + b, 0), voters: voters.size };
}

// ---------- compose drafts (per room, localStorage) ----------

const legacyDraftKey = (roomId: number) => `decave.forum.draft.v1.${roomId}`;
const forumDraftEpochs = new Map<string, number>();
export const forumDraftStorageKey = (userId: string, roomId: number) =>
  `decave.forum.draft.v2:${encodeURIComponent(userId)}:${roomId}`;
export const forumDraftSessionVersion = (userId: string) => forumDraftEpochs.get(userId) ?? 0;

export function clearForumDraftsForAccount(userId: string): void {
  forumDraftEpochs.set(userId, forumDraftSessionVersion(userId) + 1);
  try {
    const prefix = `decave.forum.draft.v2:${encodeURIComponent(userId)}:`;
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(prefix)) window.localStorage.removeItem(key);
    }
  } catch {
    /* storage unavailable */
  }
}

export function loadForumDraft<T>(userId: string, roomId: number): T | null {
  try {
    window.localStorage.removeItem(legacyDraftKey(roomId));
    if (!userId) return null;
    const raw = window.localStorage.getItem(forumDraftStorageKey(userId, roomId));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function saveForumDraft(
  userId: string,
  roomId: number,
  draft: unknown,
  sessionVersion = forumDraftSessionVersion(userId),
): void {
  try {
    if (!userId || sessionVersion !== forumDraftSessionVersion(userId)) return;
    const key = forumDraftStorageKey(userId, roomId);
    if (draft === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(draft));
  } catch {
    /* storage unavailable */
  }
}

// ---------- permissions (mirrors api-contract §1) ----------

const isHubManager = (viewer: ForumViewer) => viewer.hubRole === "owner" || viewer.hubRole === "admin";

/** Forum "staff": may reply to locked posts and post under the `staff` policy. */
export function isForumStaff(viewer: ForumViewer): boolean {
  return (
    isHubManager(viewer) ||
    viewer.customRoles.some(
      (role) =>
        role.permissions.includes("moderateMessages") ||
        role.permissions.includes("manageRooms") ||
        /^mod(erator)?$/i.test(role.name.trim()),
    )
  );
}

export function canPinOrLock(viewer: ForumViewer): boolean {
  return isHubManager(viewer) || viewer.customRoles.some((role) => role.permissions.includes("manageRooms"));
}

export function canMarkSolved(viewer: ForumViewer, post: ForumMessage): boolean {
  return Boolean(post.userId && post.userId === viewer.userId) || isForumStaff(viewer);
}

export function roomForumTags(room: ForumRoom): string[] {
  return Array.isArray(room.forumTags)
    ? room.forumTags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
    : [];
}

/** Returns null when the viewer may create posts, otherwise a human explanation. */
export function postRestriction(
  room: ForumRoom,
  viewer: ForumViewer,
  roleNames: Record<string, string>,
): string | null {
  if (!viewer.canPostInHub) return "Only the Hub owner can post in this Hub.";
  if (isHubManager(viewer)) return null;
  const policy = room.forumPostPolicy ?? "everyone";
  if (policy === "everyone") return null;
  if (policy === "staff")
    return isForumStaff(viewer)
      ? null
      : "Only moderators and Hub admins can start new posts here. You can still reply.";
  if (policy === "roles") {
    const allowed = room.forumPostRoleIds ?? [];
    if (viewer.customRoles.some((role) => allowed.includes(role.id))) return null;
    const names = allowed.map((id) => roleNames[id]).filter(Boolean);
    return names.length
      ? `Only members with the ${names.join(", ")} role${names.length === 1 ? "" : "s"} can start new posts here. You can still reply.`
      : "Only members with specific roles can start new posts here. You can still reply.";
  }
  return (room.forumPostMemberIds ?? []).includes(viewer.userId)
    ? null
    : "Only selected members can start new posts here. You can still reply.";
}

// ---------- API ----------

export type ForumFetch = (url: string, init?: RequestInit) => Promise<Response>;

type RawEntry = {
  message: ForumMessage;
  replyCount: number;
  lastActivityAt: string;
  pinned: boolean;
  locked: boolean;
  solvedReplyId: string | null;
};

export function toEntry(raw: RawEntry): ForumEntry | null {
  const payload = raw?.message ? parseForumPostPayload(raw.message.text) : null;
  if (!payload) return null;
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

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  const data = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !data)
    throw new Error((data && typeof data.error === "string" && data.error) || `${fallback} (${response.status})`);
  return data;
}

export async function fetchForumPosts(
  fetcher: ForumFetch,
  base: string,
  roomId: number,
  query: { sort: ForumSort; tag: string | null; q: string; cursor: string | null; limit?: number },
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({ sort: query.sort });
  if (query.limit) params.set("limit", String(query.limit));
  if (query.tag) params.set("tag", query.tag);
  if (query.q.trim()) params.set("q", query.q.trim().slice(0, 100));
  if (query.cursor) params.set("cursor", query.cursor);
  const data = await readJson<{ posts: RawEntry[]; nextCursor: string | null }>(
    await fetcher(`${base}/api/channels/${roomId}/forum/posts?${params}`, { signal }),
    "Could not load posts",
  );
  return {
    posts: (data.posts ?? []).map(toEntry).filter((entry): entry is ForumEntry => entry !== null),
    nextCursor: data.nextCursor ?? null,
  };
}

export async function fetchForumPost(
  fetcher: ForumFetch,
  base: string,
  roomId: number,
  postId: string,
  signal?: AbortSignal,
) {
  const data = await readJson<{ post: RawEntry }>(
    await fetcher(`${base}/api/channels/${roomId}/forum/posts/${encodeURIComponent(postId)}`, { signal }),
    "Could not load the post",
  );
  return toEntry(data.post);
}

export async function fetchForumReplies(
  fetcher: ForumFetch,
  base: string,
  roomId: number,
  postId: string,
  cursor: string | null,
  signal?: AbortSignal,
) {
  const params = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const data = await readJson<{ replies: ForumMessage[]; nextCursor: string | null }>(
    await fetcher(`${base}/api/channels/${roomId}/forum/posts/${encodeURIComponent(postId)}/replies${params}`, {
      signal,
    }),
    "Could not load replies",
  );
  return { replies: data.replies ?? [], nextCursor: data.nextCursor ?? null };
}

export type ForumPostStatePatch = { pinned?: boolean; locked?: boolean; solvedReplyId?: string | null };
export type ForumPostState = {
  postId: string;
  replyCount: number;
  lastActivityAt: string;
  pinned: boolean;
  locked: boolean;
  solvedReplyId: string | null;
};

export async function patchForumPost(
  fetcher: ForumFetch,
  base: string,
  roomId: number,
  postId: string,
  patch: ForumPostStatePatch,
) {
  return readJson<ForumPostState>(
    await fetcher(`${base}/api/channels/${roomId}/forum/posts/${encodeURIComponent(postId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }),
    "Could not update the post",
  );
}

export async function uploadForumFile(
  fetcher: ForumFetch,
  base: string,
  roomId: number,
  file: File,
  signal?: AbortSignal,
): Promise<ForumAttachment> {
  const response = await fetcher(`${base}/api/channels/${roomId}/attachments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-File-Name": encodeURIComponent(file.name),
      "X-File-Type": file.type || "application/octet-stream",
    },
    body: file,
    signal,
  });
  const data = await readJson<{ attachment?: ForumAttachment }>(response, "Could not upload the file");
  if (!data.attachment) throw new Error("Could not upload the file.");
  return data.attachment;
}

export function encodeForumPost(payload: Omit<ForumPostPayload, "version">): string {
  return `${FORUM_POST_PREFIX}${JSON.stringify({ version: 1, ...payload } satisfies ForumPostPayload)}`;
}

// ---------- ordering ----------

const ts = (value: string) => {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
};
const score = (entry: ForumEntry) =>
  (entry.message.reactions?.forum_vote_up?.length ?? 0) - (entry.message.reactions?.forum_vote_down?.length ?? 0);

/** Client re-sort for live updates; mirrors the server order (pinned first). */
export function sortEntries(entries: ForumEntry[], sort: ForumSort): ForumEntry[] {
  const keyed = sort === "unanswered" ? entries.filter((entry) => entry.replyCount === 0) : entries.slice();
  return keyed.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (sort === "new" || sort === "unanswered") return ts(b.message.timestamp) - ts(a.message.timestamp);
    if (sort === "top") return score(b) - score(a) || ts(b.lastActivityAt) - ts(a.lastActivityAt);
    return ts(b.lastActivityAt) - ts(a.lastActivityAt);
  });
}

// ---------- presentation helpers ----------

export function plainPreview(body: string): string {
  return body
    .replace(/!\[([^\]\n]*)\]\(([^\s)]+)\)/g, "🖼 $1")
    .replace(/\|\|([^|\n]+)\|\|/g, "▒▒▒")
    .replace(/~~([^~\n]+)~~/g, "$1")
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1$2")
    .replace(/^(#{1,3}|>|[-*]|\d+\.)\s+/gm, "")
    .replace(/```/g, "")
    .replace(/\[([^\]\n]+)\]\((https:\/\/[^\s)]+)\)/g, "$1")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/(^|\s)_([^_\n]+)_(?=\s|$)/g, "$1$2")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function tagHue(tag: string): number {
  let hash = 0;
  for (const char of tag.toLowerCase()) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return hash % 360;
}

export function relativeTime(iso: string, now = Date.now()): string {
  const time = ts(iso);
  if (!time) return "";
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(time).toLocaleDateString(localeForLanguage(), {
    month: "short",
    day: "numeric",
    year: days > 300 ? "numeric" : undefined,
  });
}

// ---------- unread tracking (per-viewer, localStorage) ----------

type SeenStore = { baseline: number; posts: Record<string, number> };
const seenKey = (roomId: number) => `decave.forum.seen.v1.${roomId}`;

export function loadSeen(roomId: number): SeenStore {
  try {
    const raw = window.localStorage.getItem(seenKey(roomId));
    if (raw) {
      const parsed = JSON.parse(raw) as SeenStore;
      if (parsed && typeof parsed.baseline === "number" && parsed.posts && typeof parsed.posts === "object")
        return parsed;
    }
  } catch {
    /* storage unavailable */
  }
  // First visit: everything that already exists counts as seen.
  const fresh: SeenStore = { baseline: Date.now(), posts: {} };
  saveSeen(roomId, fresh);
  return fresh;
}

export function saveSeen(roomId: number, store: SeenStore): void {
  try {
    const entries = Object.entries(store.posts);
    // Bound storage: keep the 400 most recently seen posts.
    const posts =
      entries.length > 400 ? Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, 400)) : store.posts;
    window.localStorage.setItem(seenKey(roomId), JSON.stringify({ baseline: store.baseline, posts }));
  } catch {
    /* storage unavailable */
  }
}

export function isUnread(store: SeenStore, entry: ForumEntry, viewerId: string): boolean {
  const activity = ts(entry.lastActivityAt);
  const seen = store.posts[entry.message.id] ?? store.baseline;
  if (activity <= seen) return false;
  // Your own brand-new post is not "unread" for you.
  return !(entry.replyCount === 0 && entry.message.userId === viewerId);
}
