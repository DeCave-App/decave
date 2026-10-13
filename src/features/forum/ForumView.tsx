import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { i18next } from "../../i18n/index.ts";
import { realtimeErrorMessage } from "../../i18n/apiError.ts";
import {
  FORUM_REPLY_MAX,
  FORUM_SORT_LABELS,
  canBeSolved,
  canMarkSolved,
  canPinOrLock,
  fetchForumPost,
  fetchForumPosts,
  fetchForumReplies,
  isForumStaff,
  isUnread,
  loadSeen,
  displayForumPayload,
  patchForumPost,
  plainPreview,
  postTypeOf,
  postRestriction,
  relativeTime,
  roomForumTags,
  saveSeen,
  sortEntries,
  tagHue,
  uploadForumFile,
  type ForumAttachment,
  type ForumEntry,
  type ForumFetch,
  type ForumMessage,
  type ForumPostStatePatch,
  type ForumRoom,
  type ForumSort,
  type ForumViewer,
} from "./forumModel";
import { LfgBlock, MediaBlock, PollBlock, TypeBadge } from "./ForumPostExtras";
import { renderForumMarkdown, type ResolveRoomLink } from "./forumRichText";
import "../shared/shared.css";
import "./forum.css";
import { Icon } from "../../components/Icon";
import { BotBadge } from "../bot-cards";
import { messageBotFields } from "../../../shared/bots/card-view";

/** BOT badge for forum posts and replies a bot wrote. */
function ForumBotBadge({ message }: { message: object }) {
  const { bot } = messageBotFields(message);
  return bot ? <BotBadge bot={bot} /> : null;
}

/** A bot is the author of what it posts, not the admin who published it. */
function authorName(message: { username: string }): string {
  return messageBotFields(message).bot?.name ?? message.username;
}

const SORTS: ForumSort[] = ["active", "new", "top", "unanswered"];

export type ForumViewProps = {
  apiBase: string;
  fetcher: ForumFetch;
  room: ForumRoom;
  viewer: ForumViewer;
  /** Custom role id → name, used to explain posting restrictions. */
  roleNames: Record<string, string>;
  ownerOnlyPosting: boolean;
  activePostId: string | null;
  onOpenPost: (postId: string | null) => void;
  onNewPost: () => void;
  /** Makes #room mentions in posts open that room. */
  roomLink?: ResolveRoomLink;
  replyInput: string;
  onReplyInputChange: (value: string) => void;
  publishReply: (text: string, postId: string, attachment: ForumAttachment | null) => Promise<boolean>;
  onSent: () => void;
  onVote(message: ForumMessage, direction: "up" | "down"): void;
  /** Toggle a poll vote (reaction poll_<index>). Single-choice polls clear the viewer's other choice. */
  onPollVote?(message: ForumMessage, optionIndex: number, multi: boolean): void;
  onReport(message: ForumMessage, post: ForumEntry | null): void;
  onDownload(attachment: ForumAttachment): void;
  renderReplyBody(message: ForumMessage): ReactNode;
  renderRichText(text: string): ReactNode;
  renderAvatar(username: string, avatarUrl?: string | null): ReactNode;
  resolveIconUrl(url: string | undefined): string | null;
  formatTimestamp(timestamp: string): string;
  emojiSlot?: ReactNode;
  gifSlot?: ReactNode;
};

type RealtimeFrame = Record<string, unknown> & { type?: unknown };

export function TagChip({
  tag,
  active,
  onClick,
  removable,
}: {
  tag: string;
  active?: boolean;
  onClick?: () => void;
  removable?: boolean;
}) {
  const style = { ["--fx-tag-h" as string]: String(tagHue(tag)) };
  if (!onClick)
    return (
      <span className="fx-tag" style={style}>
        {tag}
      </span>
    );
  return (
    <button
      type="button"
      className={`fx-tag fx-tag-btn${active ? " active" : ""}`}
      style={style}
      aria-pressed={removable ? undefined : Boolean(active)}
      onClick={onClick}
    >
      {tag}
      {removable && <Icon name="close" size="sm" />}
    </button>
  );
}

function fileSize(size: number) {
  return size >= 1024 * 1024
    ? i18next.t("forum.view.sizeMb", { size: (size / 1024 / 1024).toFixed(1) })
    : i18next.t("forum.view.sizeKb", { size: Math.max(1, Math.round(size / 1024)) });
}

export function ForumView(props: ForumViewProps) {
  const { t } = useTranslation(["forum"]);
  const { apiBase, room, viewer, activePostId } = props;
  // App re-creates these callbacks every render; keep effects stable via refs.
  const fetcherRef = useRef(props.fetcher);
  fetcherRef.current = props.fetcher;
  const fetcher = useCallback<ForumFetch>((url, init) => fetcherRef.current(url, init), []);
  const openRef = useRef(props.onOpenPost);
  openRef.current = props.onOpenPost;
  const onOpenPost = useCallback((postId: string | null) => openRef.current(postId), []);
  const roomId = room.id;
  const searchId = useId();

  // ----- feed -----
  const [sort, setSort] = useState<ForumSort>("active");
  const [tag, setTag] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [posts, setPosts] = useState<ForumEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [feedLoading, setFeedLoading] = useState(true);
  const [feedError, setFeedError] = useState("");
  const [banner, setBanner] = useState("");
  const [seen, setSeen] = useState(() => loadSeen(roomId));
  const listRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const feedRequestRef = useRef(0);
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedQuery(query.trim()), 280);
    return () => window.clearTimeout(handle);
  }, [query]);

  const loadFeed = useCallback(
    async (cursor: string | null) => {
      const request = ++feedRequestRef.current;
      if (cursor) loadingMoreRef.current = true;
      else setFeedLoading(true);
      setFeedError("");
      try {
        const page = await fetchForumPosts(fetcher, apiBase, roomId, { sort, tag, q: debouncedQuery, cursor });
        if (request !== feedRequestRef.current) return;
        setPosts((current) => {
          if (!cursor) return page.posts;
          const known = new Set(current.map((entry) => entry.message.id));
          return [...current, ...page.posts.filter((entry) => !known.has(entry.message.id))];
        });
        setNextCursor(page.nextCursor);
      } catch (error) {
        if (request === feedRequestRef.current)
          setFeedError(error instanceof Error ? error.message : t("forum.view.loadPostsFailed"));
      } finally {
        if (request === feedRequestRef.current) {
          setFeedLoading(false);
          loadingMoreRef.current = false;
        }
      }
    },
    [apiBase, fetcher, roomId, sort, tag, debouncedQuery],
  );

  useEffect(() => {
    void loadFeed(null);
  }, [loadFeed]);

  // Infinite scroll.
  useEffect(() => {
    const target = sentinelRef.current;
    if (!target || !nextCursor) return;
    const observer = new IntersectionObserver(
      (items) => {
        if (items.some((item) => item.isIntersecting) && !loadingMoreRef.current) void loadFeed(nextCursor);
      },
      { root: listRef.current, rootMargin: "240px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [nextCursor, loadFeed, posts.length]);

  // ----- thread -----
  const [selected, setSelected] = useState<ForumEntry | null>(null);
  const [threadError, setThreadError] = useState("");
  const [replies, setReplies] = useState<ForumMessage[]>([]);
  const [repliesCursor, setRepliesCursor] = useState<string | null>(null);
  const [repliesLoading, setRepliesLoading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busyAction, setBusyAction] = useState("");
  const threadRequestRef = useRef(0);
  const countedReplyIdsRef = useRef(new Set<string>());

  const markSeen = useCallback(
    (entry: ForumEntry) => {
      setSeen((current) => {
        const at = Math.max(Date.parse(entry.lastActivityAt) || 0, Date.now());
        const next = { ...current, posts: { ...current.posts, [entry.message.id]: at } };
        saveSeen(roomId, next);
        return next;
      });
    },
    [roomId],
  );

  useEffect(() => {
    setMenuOpen(false);
    setThreadError("");
    if (!activePostId) {
      setSelected(null);
      setReplies([]);
      setRepliesCursor(null);
      return;
    }
    const request = ++threadRequestRef.current;
    const fromList = posts.find((entry) => entry.message.id === activePostId) ?? null;
    setSelected(fromList);
    setReplies([]);
    setRepliesCursor(null);
    setRepliesLoading(true);
    void (async () => {
      try {
        const [entry, page] = await Promise.all([
          fetchForumPost(fetcher, apiBase, roomId, activePostId),
          fetchForumReplies(fetcher, apiBase, roomId, activePostId, null),
        ]);
        if (request !== threadRequestRef.current) return;
        if (!entry) throw new Error(t("forum.view.notFound"));
        setSelected(entry);
        setReplies(page.replies);
        setRepliesCursor(page.nextCursor);
        page.replies.forEach((reply) => countedReplyIdsRef.current.add(reply.id));
        markSeen(entry);
      } catch (error) {
        if (request === threadRequestRef.current)
          setThreadError(error instanceof Error ? error.message : t("forum.view.loadPostFailed"));
      } finally {
        if (request === threadRequestRef.current) setRepliesLoading(false);
      }
    })();
    // Only re-run when the opened post changes; list refreshes must not refetch the thread.
  }, [activePostId, apiBase, fetcher, roomId]);

  const loadMoreReplies = async () => {
    if (!activePostId || !repliesCursor) return;
    const request = threadRequestRef.current;
    setRepliesLoading(true);
    try {
      const page = await fetchForumReplies(fetcher, apiBase, roomId, activePostId, repliesCursor);
      if (request !== threadRequestRef.current) return;
      setReplies((current) => {
        const known = new Set(current.map((reply) => reply.id));
        return [...current, ...page.replies.filter((reply) => !known.has(reply.id))];
      });
      page.replies.forEach((reply) => countedReplyIdsRef.current.add(reply.id));
      setRepliesCursor(page.nextCursor);
    } catch (error) {
      setThreadError(error instanceof Error ? error.message : t("forum.view.loadRepliesFailed"));
    } finally {
      setRepliesLoading(false);
    }
  };

  /** Apply a change to a post wherever it is shown (feed + open thread). */
  const patchEntry = useCallback(
    (postId: string, apply: (entry: ForumEntry) => ForumEntry | null, resort = false) => {
      setPosts((current) => {
        let changed = false;
        const next: ForumEntry[] = [];
        for (const entry of current) {
          if (entry.message.id !== postId) {
            next.push(entry);
            continue;
          }
          changed = true;
          const updated = apply(entry);
          if (updated) next.push(updated);
        }
        if (!changed) return current;
        return resort ? sortEntries(next, sort) : next;
      });
      setSelected((current) => (current && current.message.id === postId ? (apply(current) ?? current) : current));
    },
    [sort],
  );

  // ----- realtime (App re-broadcasts every socket frame as decave-realtime-event) -----
  const liveRef = useRef({ sort, tag, debouncedQuery, activePostId, repliesCursor, selected, replies });
  liveRef.current = { sort, tag, debouncedQuery, activePostId, repliesCursor, selected, replies };

  useEffect(() => {
    const onFrame = (event: Event) => {
      const data = (event as CustomEvent<RealtimeFrame>).detail;
      if (!data || typeof data !== "object") return;
      const live = liveRef.current;
      if (data.type === "ERROR") {
        if (typeof data.code === "string" && data.code.startsWith("FORUM_"))
          setBanner(realtimeErrorMessage(data, t("forum.view.rejected")));
        return;
      }
      if (
        Number(data.channelId) !== roomId &&
        !(
          data.type === "MESSAGE_UPDATED" &&
          data.message &&
          Number((data.message as ForumMessage).channelId) === roomId
        )
      )
        return;

      if (data.type === "CHAT_MESSAGE" && typeof data.id === "string") {
        const message: ForumMessage = {
          id: data.id,
          userId: typeof data.userId === "string" ? data.userId : undefined,
          username: typeof data.username === "string" ? data.username : t("forum.view.unknownUser"),
          avatarUrl: typeof data.avatarUrl === "string" ? data.avatarUrl : null,
          text: typeof data.text === "string" ? data.text : "",
          timestamp: typeof data.timestamp === "string" ? data.timestamp : new Date().toISOString(),
          channelId: roomId,
          replyToId: typeof data.replyToId === "string" ? data.replyToId : null,
          reactions:
            data.reactions && typeof data.reactions === "object" ? (data.reactions as Record<string, string[]>) : {},
          attachment:
            data.attachment && typeof data.attachment === "object" ? (data.attachment as ForumAttachment) : null,
          ...messageBotFields(data),
        };
        if (!message.replyToId) {
          const payload = displayForumPayload(message);
          if (!payload) return;
          const matchesTag = !live.tag || payload.tags.some((item) => item.toLowerCase() === live.tag!.toLowerCase());
          const q = live.debouncedQuery.toLowerCase();
          const matchesQuery = !q || payload.title.toLowerCase().includes(q) || payload.body.toLowerCase().includes(q);
          if (!matchesTag || !matchesQuery) return;
          const entry: ForumEntry = {
            message,
            payload,
            replyCount: 0,
            lastActivityAt: message.timestamp,
            pinned: false,
            locked: false,
            solvedReplyId: null,
          };
          setPosts((current) =>
            current.some((item) => item.message.id === message.id)
              ? current
              : sortEntries([entry, ...current], live.sort),
          );
          return;
        }
        const postId = message.replyToId;
        if (!countedReplyIdsRef.current.has(message.id)) {
          countedReplyIdsRef.current.add(message.id);
          patchEntry(
            postId,
            (entry) => ({ ...entry, replyCount: entry.replyCount + 1, lastActivityAt: message.timestamp }),
            true,
          );
        }
        if (live.activePostId === postId && !live.repliesCursor) {
          setReplies((current) => (current.some((reply) => reply.id === message.id) ? current : [...current, message]));
          if (live.selected) markSeen({ ...live.selected, lastActivityAt: message.timestamp });
        }
        return;
      }

      if (data.type === "MESSAGE_UPDATED" && data.message && typeof data.message === "object") {
        const message = data.message as ForumMessage;
        if (message.replyToId) {
          setReplies((current) => current.map((reply) => (reply.id === message.id ? { ...reply, ...message } : reply)));
        } else {
          const payload = displayForumPayload(message);
          if (payload)
            patchEntry(
              message.id,
              (entry) => ({ ...entry, message: { ...entry.message, ...message }, payload }),
              live.sort === "top",
            );
        }
        return;
      }

      if (data.type === "MESSAGE_DELETED" && typeof data.messageId === "string") {
        const messageId = data.messageId;
        if (live.activePostId === messageId) {
          onOpenPost(null);
          setBanner(t("forum.view.deleted"));
        }
        setPosts((current) => current.filter((entry) => entry.message.id !== messageId));
        if (live.activePostId && live.replies.some((reply) => reply.id === messageId)) {
          patchEntry(live.activePostId, (entry) => ({
            ...entry,
            replyCount: Math.max(0, entry.replyCount - 1),
            solvedReplyId: entry.solvedReplyId === messageId ? null : entry.solvedReplyId,
          }));
          setReplies((current) => current.filter((reply) => reply.id !== messageId));
        }
        return;
      }

      if (data.type === "FORUM_POST_UPDATED" && typeof data.postId === "string") {
        patchEntry(
          data.postId,
          (entry) => ({
            ...entry,
            replyCount: typeof data.replyCount === "number" ? data.replyCount : entry.replyCount,
            lastActivityAt: typeof data.lastActivityAt === "string" ? data.lastActivityAt : entry.lastActivityAt,
            pinned: typeof data.pinned === "boolean" ? data.pinned : entry.pinned,
            locked: typeof data.locked === "boolean" ? data.locked : entry.locked,
            solvedReplyId:
              data.solvedReplyId === null || typeof data.solvedReplyId === "string"
                ? (data.solvedReplyId as string | null)
                : entry.solvedReplyId,
          }),
          true,
        );
      }
    };
    window.addEventListener("decave-realtime-event", onFrame);
    return () => window.removeEventListener("decave-realtime-event", onFrame);
  }, [roomId, patchEntry, markSeen, onOpenPost]);

  // ----- moderation -----
  const runPatch = async (patch: ForumPostStatePatch, label: string) => {
    if (!selected) return;
    setMenuOpen(false);
    setBusyAction(label);
    try {
      const state = await patchForumPost(fetcher, apiBase, roomId, selected.message.id, patch);
      patchEntry(
        selected.message.id,
        (entry) => ({
          ...entry,
          pinned: state.pinned,
          locked: state.locked,
          solvedReplyId: state.solvedReplyId,
          replyCount: state.replyCount,
          lastActivityAt: state.lastActivityAt,
        }),
        true,
      );
    } catch (error) {
      setBanner(error instanceof Error ? error.message : t("forum.view.updateFailed"));
    } finally {
      setBusyAction("");
    }
  };

  // ----- reply composer (own attachment state — F5) -----
  const [replyAttachment, setReplyAttachment] = useState<ForumAttachment | null>(null);
  const [replyUploading, setReplyUploading] = useState(false);
  const [replyError, setReplyError] = useState("");
  const [sending, setSending] = useState(false);
  const replyFileRef = useRef<HTMLInputElement | null>(null);
  const replyTextRef = useRef<HTMLTextAreaElement | null>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // A draft attachment belongs to the thread it was added in.
    uploadAbortRef.current?.abort();
    setReplyAttachment(null);
    setReplyUploading(false);
    setReplyError("");
  }, [activePostId]);

  useEffect(() => () => uploadAbortRef.current?.abort(), []);

  useEffect(() => {
    const textarea = replyTextRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`;
  }, [props.replyInput, selected?.message.id]);

  const uploadReplyFile = async (file: File) => {
    uploadAbortRef.current?.abort();
    const controller = new AbortController();
    uploadAbortRef.current = controller;
    setReplyUploading(true);
    setReplyError("");
    try {
      const attachment = await uploadForumFile(fetcher, apiBase, roomId, file, controller.signal);
      if (!controller.signal.aborted) setReplyAttachment(attachment);
    } catch (error) {
      if (!controller.signal.aborted)
        setReplyError(error instanceof Error ? error.message : t("forum.api.uploadFailed"));
    } finally {
      if (uploadAbortRef.current === controller) {
        uploadAbortRef.current = null;
        setReplyUploading(false);
      }
    }
  };

  const staff = isForumStaff(viewer);
  const locked = Boolean(selected?.locked);
  const canReply = viewer.canPostInHub && (!locked || staff);

  const sendReply = async () => {
    if (!selected || sending || replyUploading || !canReply) return;
    const text = props.replyInput.trim().slice(0, FORUM_REPLY_MAX);
    if (!text && !replyAttachment) return;
    setSending(true);
    setReplyError("");
    try {
      if (!(await props.publishReply(text, selected.message.id, replyAttachment)))
        throw new Error(t("forum.view.reconnecting"));
      props.onReplyInputChange("");
      setReplyAttachment(null);
      props.onSent();
    } catch (error) {
      setReplyError(error instanceof Error ? error.message : t("forum.view.sendFailed"));
    } finally {
      setSending(false);
    }
  };

  const onReplyKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void sendReply();
    }
  };

  // ----- derived -----
  const roomTags = useMemo(() => roomForumTags(room), [room]);
  const filterTags = useMemo(() => {
    if (roomTags.length) return roomTags;
    // Rooms without a moderator tag list: offer tags seen in loaded posts.
    const seenTags = new Map<string, string>();
    posts.forEach((entry) =>
      entry.payload.tags.forEach((item) => {
        if (!seenTags.has(item.toLowerCase())) seenTags.set(item.toLowerCase(), item);
      }),
    );
    return Array.from(seenTags.values())
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 20);
  }, [roomTags, posts]);
  const restriction = postRestriction(room, viewer, props.roleNames);
  const filtersActive = Boolean(tag || debouncedQuery || sort === "unanswered");
  const canModerate = canPinOrLock(viewer);
  const canSolve = selected ? canBeSolved(selected.payload) && canMarkSolved(viewer, selected.message) : false;
  const votePoll = (message: ForumMessage, index: number, multi: boolean) => props.onPollVote?.(message, index, multi);
  const resolveImage = (url: string) => props.resolveIconUrl(url);
  const solvedReply = selected?.solvedReplyId
    ? (replies.find((reply) => reply.id === selected.solvedReplyId) ?? null)
    : null;

  // Close the ⋯ menu on outside click / Escape.
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [menuOpen]);

  const votes = (message: ForumMessage, className: string) => {
    const up = message.reactions?.forum_vote_up ?? [];
    const down = message.reactions?.forum_vote_down ?? [];
    const mineUp = up.includes(viewer.userId);
    const mineDown = down.includes(viewer.userId);
    return (
      <div className={`fx-votes ${className}`} role="group" aria-label={t("forum.view.votes")}>
        <button
          type="button"
          className={mineUp ? "active" : ""}
          aria-pressed={mineUp}
          aria-label={t("forum.view.upvote", { count: up.length })}
          onClick={(event) => {
            event.stopPropagation();
            props.onVote(message, "up");
          }}
        >
          ▲ <span>{up.length}</span>
        </button>
        <button
          type="button"
          className={mineDown ? "active down" : "down"}
          aria-pressed={mineDown}
          aria-label={t("forum.view.downvote", { count: down.length })}
          onClick={(event) => {
            event.stopPropagation();
            props.onVote(message, "down");
          }}
        >
          ▼ <span>{down.length}</span>
        </button>
      </div>
    );
  };

  const attachmentButton = (attachment: ForumAttachment) => (
    <button type="button" className="fx-attachment" onClick={() => props.onDownload(attachment)}>
      <span aria-hidden="true">📎</span>
      <span>
        <strong>{attachment.name}</strong>
        <small>
          {attachment.mimeType || t("forum.view.file")} · {fileSize(attachment.size)}
        </small>
      </span>
    </button>
  );

  // ----- render -----
  const feed = (
    <section className="fx-forum-feed" aria-label={t("forum.view.feedLabel", { room: room.name })}>
      <header className="fx-forum-head">
        <div className="fx-forum-head-copy">
          <span className="fx-kicker">{t("forum.view.kicker")}</span>
          <h2>{room.name}</h2>
        </div>
        <div className="fx-forum-head-actions">
          {restriction ? (
            <p className="fx-restriction" role="note">
              <span aria-hidden="true">🔒</span>
              {restriction}
            </p>
          ) : (
            <button type="button" className="dcx-btn dcx-btn-primary" onClick={props.onNewPost}>
              {t("forum.view.newPost")}
            </button>
          )}
        </div>
      </header>

      {room.forumGuidelines && (
        <details className="fx-guidelines">
          <summary>{t("forum.view.guidelines")}</summary>
          <p>{room.forumGuidelines}</p>
        </details>
      )}

      <div className="fx-controls">
        <div className="fx-sort-tabs" role="tablist" aria-label={t("forum.view.sort")}>
          {SORTS.map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={sort === item}
              className={sort === item ? "active" : ""}
              onClick={() => setSort(item)}
            >
              {FORUM_SORT_LABELS[item]}
            </button>
          ))}
        </div>
        <label className="fx-search" htmlFor={searchId}>
          <Icon name="search" size="sm" />
          <input
            id={searchId}
            type="search"
            value={query}
            maxLength={100}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("forum.view.searchPlaceholder")}
            aria-label={t("forum.view.search")}
          />
        </label>
      </div>
      {filterTags.length > 0 && (
        <div className="fx-tag-filter" role="group" aria-label={t("forum.view.filterTag")}>
          <button
            type="button"
            className={`fx-tag-all${tag ? "" : " active"}`}
            aria-pressed={!tag}
            onClick={() => setTag(null)}
          >
            {t("forum.view.allTags")}
          </button>
          {filterTags.map((item) => (
            <TagChip
              key={item}
              tag={item}
              active={tag?.toLowerCase() === item.toLowerCase()}
              onClick={() => setTag((current) => (current?.toLowerCase() === item.toLowerCase() ? null : item))}
            />
          ))}
        </div>
      )}

      <div className="fx-post-list" ref={listRef} aria-busy={feedLoading}>
        {feedLoading &&
          posts.length === 0 &&
          Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="fx-post-card fx-skeleton" aria-hidden="true" />
          ))}
        {posts.map((entry) => {
          const { message, payload } = entry;
          const unread = isUnread(seen, entry, viewer.userId);
          const iconUrl = props.resolveIconUrl(payload.iconUrl);
          const isActive = message.id === activePostId;
          return (
            <article
              key={message.id}
              className={`fx-post-card${isActive ? " active" : ""}${unread ? " unread" : ""}${entry.pinned ? " pinned" : ""}`}
            >
              <button
                type="button"
                className="fx-post-open"
                onClick={() => onOpenPost(message.id)}
                aria-current={isActive ? "true" : undefined}
                aria-label={unread ? t("forum.view.newActivity", { title: payload.title }) : payload.title}
              />
              <div className="fx-post-avatar" aria-hidden="true">
                {iconUrl ? <img src={iconUrl} alt="" /> : props.renderAvatar(message.username, message.avatarUrl)}
              </div>
              <div className="fx-post-copy">
                <div className="fx-post-title-row">
                  {unread && <span className="fx-unread-dot" aria-hidden="true" />}
                  <strong className="fx-post-title">{payload.title}</strong>
                  <span className="fx-badges">
                    {payload.type && payload.type !== "discussion" && <TypeBadge type={payload.type} />}
                    {entry.pinned && <span className="fx-badge pin">{t("forum.view.pinned")}</span>}
                    {entry.solvedReplyId && <span className="fx-badge solved">{t("forum.view.solved")}</span>}
                    {entry.locked && <span className="fx-badge lock">{t("forum.view.locked")}</span>}
                  </span>
                </div>
                {payload.lfg && <LfgBlock lfg={payload.lfg} compact />}
                {payload.poll && (
                  <PollBlock poll={payload.poll} reactions={message.reactions} viewerId={viewer.userId} compact />
                )}
                {payload.media && <MediaBlock media={payload.media} resolveUrl={resolveImage} compact />}
                {payload.body && <p className="fx-post-preview">{plainPreview(payload.body)}</p>}
                <div className="fx-post-meta">
                  {payload.tags.slice(0, 4).map((item) => (
                    <TagChip key={item} tag={item} />
                  ))}
                  <span className="fx-meta-text">{authorName(message)}</span>
                  <ForumBotBadge message={message} />
                  <span className="fx-meta-text" title={t("forum.view.replies", { count: entry.replyCount })}>
                    💬 {entry.replyCount}
                  </span>
                  <time
                    className="fx-meta-text"
                    dateTime={entry.lastActivityAt}
                    title={t("forum.view.lastActivity", { time: props.formatTimestamp(entry.lastActivityAt) })}
                  >
                    {relativeTime(entry.lastActivityAt)}
                  </time>
                </div>
              </div>
              {!props.ownerOnlyPosting && <div className="dc-forum-card-votes">{votes(message, "fx-card-votes")}</div>}
            </article>
          );
        })}
        {!feedLoading && feedError && (
          <div className="fx-empty" role="alert">
            <strong>{t("forum.view.feedErrorTitle")}</strong>
            <p>{feedError}</p>
            <button type="button" className="dcx-btn" onClick={() => void loadFeed(null)}>
              {t("forum.view.retry")}
            </button>
          </div>
        )}
        {!feedLoading && !feedError && posts.length === 0 && (
          <div className="fx-empty">
            <span className="fx-empty-icon" aria-hidden="true">
              <Icon name="forum" size="xl" />
            </span>
            <strong>{filtersActive ? t("forum.view.noMatch") : t("forum.view.empty")}</strong>
            <p>{filtersActive ? t("forum.view.noMatchHint") : (restriction ?? t("forum.view.emptyHint"))}</p>
            {filtersActive ? (
              <button
                type="button"
                className="dcx-btn"
                onClick={() => {
                  setTag(null);
                  setQuery("");
                  setSort("active");
                }}
              >
                {t("forum.view.clearFilters")}
              </button>
            ) : (
              !restriction && (
                <button type="button" className="dcx-btn dcx-btn-primary" onClick={props.onNewPost}>
                  {t("forum.view.createFirst")}
                </button>
              )
            )}
          </div>
        )}
        {nextCursor && (
          <div ref={sentinelRef} className="fx-sentinel">
            <button type="button" className="dcx-btn dcx-btn-sm" onClick={() => void loadFeed(nextCursor)}>
              {t("forum.view.loadMore")}
            </button>
          </div>
        )}
      </div>
    </section>
  );

  const thread = activePostId && (
    <section
      className="fx-thread"
      aria-label={selected ? t("forum.view.threadNamed", { title: selected.payload.title }) : t("forum.view.thread")}
    >
      <header className="fx-thread-bar">
        <button
          type="button"
          className="dcx-btn dcx-btn-ghost dcx-btn-sm fx-back"
          onClick={() => onOpenPost(null)}
          aria-label={t("forum.view.back")}
        >
          ← <span>{t("forum.view.allPosts")}</span>
        </button>
        {selected && (
          <div className="fx-menu" ref={menuRef}>
            {busyAction && (
              <span className="fx-busy" role="status">
                {busyAction}
              </span>
            )}
            <button
              type="button"
              className="dcx-btn dcx-btn-ghost dcx-btn-sm"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={t("forum.view.actions")}
              onClick={() => setMenuOpen((value) => !value)}
            >
              ⋯
            </button>
            {menuOpen && (
              <div className="fx-menu-pop" role="menu">
                {canModerate && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() =>
                      void runPatch(
                        { pinned: !selected.pinned },
                        selected.pinned ? t("forum.view.busy.unpinning") : t("forum.view.busy.pinning"),
                      )
                    }
                  >
                    {selected.pinned ? t("forum.view.unpin") : t("forum.view.pin")}
                  </button>
                )}
                {canModerate && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() =>
                      void runPatch(
                        { locked: !selected.locked },
                        selected.locked ? t("forum.view.busy.unlocking") : t("forum.view.busy.locking"),
                      )
                    }
                  >
                    {selected.locked ? t("forum.view.unlock") : t("forum.view.lock")}
                  </button>
                )}
                {canSolve && selected.solvedReplyId && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => void runPatch({ solvedReplyId: null }, t("forum.view.busy.updating"))}
                  >
                    {t("forum.view.unmarkSolved")}
                  </button>
                )}
                {selected.message.userId !== viewer.userId && (
                  <button
                    type="button"
                    role="menuitem"
                    className="danger"
                    onClick={() => {
                      setMenuOpen(false);
                      props.onReport(selected.message, selected);
                    }}
                  >
                    {t("forum.view.reportPost")}
                  </button>
                )}
                {!canModerate && !(canSolve && selected.solvedReplyId) && selected.message.userId === viewer.userId && (
                  <span className="fx-menu-empty">{t("forum.view.noActions")}</span>
                )}
              </div>
            )}
          </div>
        )}
      </header>
      <div className="fx-thread-scroll">
        {threadError && (
          <div className="fx-inline-error" role="alert">
            {threadError}
          </div>
        )}
        {!selected && !threadError && <div className="fx-thread-root fx-skeleton tall" aria-hidden="true" />}
        {selected && (
          <article className="fx-thread-root">
            <div className="fx-badges">
              <TypeBadge type={postTypeOf(selected.payload)} />
              {selected.pinned && <span className="fx-badge pin">{t("forum.view.pinned")}</span>}
              {selected.solvedReplyId && <span className="fx-badge solved">{t("forum.view.solved")}</span>}
              {selected.locked && <span className="fx-badge lock">{t("forum.view.locked")}</span>}
              {selected.payload.tags.map((item) => (
                <TagChip key={item} tag={item} />
              ))}
            </div>
            <h2>{selected.payload.title}</h2>
            <div className="fx-author">
              <span className="fx-avatar-sm" aria-hidden="true">
                {messageBotFields(selected.message).bot
                  ? messageBotFields(selected.message).bot!.avatarEmoji || "🤖"
                  : props.renderAvatar(selected.message.username, selected.message.avatarUrl)}
              </span>
              <span>
                <strong>{authorName(selected.message)}</strong> <ForumBotBadge message={selected.message} />
                <small>
                  {props.formatTimestamp(selected.message.timestamp)}
                  {selected.message.editedAt ? t("forum.view.edited") : ""}
                </small>
              </span>
            </div>
            {props.resolveIconUrl(selected.payload.iconUrl) && (
              <img className="fx-thread-icon" src={props.resolveIconUrl(selected.payload.iconUrl)!} alt="" />
            )}
            {selected.payload.lfg && <LfgBlock lfg={selected.payload.lfg} />}
            {selected.payload.media && <MediaBlock media={selected.payload.media} resolveUrl={resolveImage} />}
            {selected.payload.poll && (
              <PollBlock
                poll={selected.payload.poll}
                reactions={selected.message.reactions}
                viewerId={viewer.userId}
                onVote={
                  props.onPollVote
                    ? (index) => votePoll(selected.message, index, selected.payload.poll!.multi)
                    : undefined
                }
              />
            )}
            {selected.payload.body && (
              <div className="fx-thread-body">
                {renderForumMarkdown(selected.payload.body, resolveImage, props.roomLink)}
              </div>
            )}
            {selected.message.attachment && attachmentButton(selected.message.attachment)}
            {!props.ownerOnlyPosting && (
              <div className="dc-forum-root-votes">{votes(selected.message, "fx-root-votes")}</div>
            )}
          </article>
        )}

        {solvedReply && (
          <aside className="fx-solution" aria-label={t("forum.view.accepted")}>
            <span className="fx-kicker ok">{t("forum.view.acceptedBy", { name: solvedReply.username })}</span>
            <div className="fx-reply-body">{props.renderReplyBody(solvedReply)}</div>
            <button
              type="button"
              className="dcx-btn dcx-btn-ghost dcx-btn-sm"
              onClick={() =>
                document
                  .getElementById(`fx-reply-${solvedReply.id}`)
                  ?.scrollIntoView({ behavior: "smooth", block: "center" })
              }
            >
              {t("forum.view.jump")}
            </button>
          </aside>
        )}

        {selected && (
          <div className="fx-replies" aria-live="polite">
            <h3>{t("forum.view.replies", { count: selected.replyCount })}</h3>
            {replies.map((reply) => {
              const isSolution = reply.id === selected.solvedReplyId;
              return (
                <article
                  key={reply.id}
                  id={`fx-reply-${reply.id}`}
                  className={`fx-reply${isSolution ? " solution" : ""}`}
                >
                  <span className="fx-avatar-sm" aria-hidden="true">
                    {messageBotFields(reply).bot
                      ? messageBotFields(reply).bot!.avatarEmoji || "🤖"
                      : props.renderAvatar(reply.username, reply.avatarUrl)}
                  </span>
                  <div className="fx-reply-main">
                    <header>
                      <strong>{authorName(reply)}</strong>
                      <ForumBotBadge message={reply} />
                      {selected.message.userId && reply.userId === selected.message.userId && (
                        <span className="fx-badge op">{t("forum.view.author")}</span>
                      )}
                      {isSolution && <span className="fx-badge solved">{t("forum.view.solution")}</span>}
                      <time dateTime={reply.timestamp} title={props.formatTimestamp(reply.timestamp)}>
                        {relativeTime(reply.timestamp)}
                      </time>
                      <span className="fx-reply-actions">
                        {canSolve && (
                          <button
                            type="button"
                            className="dcx-btn dcx-btn-ghost dcx-btn-sm"
                            disabled={Boolean(busyAction)}
                            onClick={() =>
                              void runPatch(
                                { solvedReplyId: isSolution ? null : reply.id },
                                t("forum.view.busy.updating"),
                              )
                            }
                          >
                            {isSolution ? t("forum.view.unmark") : t("forum.view.markSolution")}
                          </button>
                        )}
                        {reply.userId !== viewer.userId && (
                          <button
                            type="button"
                            className="dcx-btn dcx-btn-ghost dcx-btn-sm"
                            onClick={() => props.onReport(reply, null)}
                            aria-label={t("forum.view.reportReply", { name: reply.username })}
                          >
                            {t("forum.view.report")}
                          </button>
                        )}
                      </span>
                    </header>
                    <div className="fx-reply-body">{props.renderReplyBody(reply)}</div>
                    {reply.attachment && attachmentButton(reply.attachment)}
                  </div>
                </article>
              );
            })}
            {repliesLoading && (
              <p className="fx-muted" role="status">
                {t("forum.view.loadingReplies")}
              </p>
            )}
            {!repliesLoading && repliesCursor && (
              <button type="button" className="dcx-btn dcx-btn-sm fx-more" onClick={() => void loadMoreReplies()}>
                {t("forum.view.loadMoreReplies")}
              </button>
            )}
            {!repliesLoading && replies.length === 0 && !threadError && (
              <p className="fx-muted fx-no-replies">
                {canReply ? t("forum.view.noRepliesHelp") : t("forum.view.noReplies")}
              </p>
            )}
          </div>
        )}
      </div>

      {selected &&
        (canReply ? (
          <div className="fx-composer">
            {locked && (
              <p className="fx-lock-note" role="note">
                {t("forum.view.lockedStaff")}
              </p>
            )}
            {(replyAttachment || replyUploading || replyError) && (
              <div className="fx-composer-state">
                {replyUploading ? (
                  <>
                    <span>{t("forum.view.uploading")}</span>
                    <button
                      type="button"
                      className="dcx-btn dcx-btn-ghost dcx-btn-sm"
                      onClick={() => {
                        uploadAbortRef.current?.abort();
                        uploadAbortRef.current = null;
                        setReplyUploading(false);
                      }}
                    >
                      {t("forum.view.cancel")}
                    </button>
                  </>
                ) : replyAttachment ? (
                  <>
                    <span>
                      📎 <strong>{replyAttachment.name}</strong> · {fileSize(replyAttachment.size)}
                    </span>
                    <button
                      type="button"
                      className="dcx-btn dcx-btn-ghost dcx-btn-sm"
                      onClick={() => setReplyAttachment(null)}
                    >
                      {t("forum.view.remove")}
                    </button>
                  </>
                ) : (
                  <span className="fx-error" role="alert">
                    {replyError}
                  </span>
                )}
              </div>
            )}
            <div className="fx-composer-row">
              <input
                ref={replyFileRef}
                type="file"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.currentTarget.value = "";
                  if (file) void uploadReplyFile(file);
                }}
              />
              <button
                type="button"
                className="fx-icon-btn"
                aria-label={t("forum.view.attach")}
                title={t("forum.view.attach")}
                disabled={replyUploading}
                onClick={() => replyFileRef.current?.click()}
              >
                <Icon name="plus" size="sm" />
              </button>
              <textarea
                ref={replyTextRef}
                rows={1}
                value={props.replyInput}
                maxLength={FORUM_REPLY_MAX}
                onChange={(event) => props.onReplyInputChange(event.target.value)}
                onKeyDown={onReplyKeyDown}
                placeholder={t("forum.view.replyTo", { name: selected.message.username })}
                aria-label={t("forum.view.replyLabel")}
              />
              {props.gifSlot}
              {props.emojiSlot}
              <button
                type="button"
                className="fx-send"
                aria-label={t("forum.view.send")}
                disabled={sending || replyUploading || (!props.replyInput.trim() && !replyAttachment)}
                onClick={() => void sendReply()}
              >
                ➤
              </button>
            </div>
            {props.replyInput.length > FORUM_REPLY_MAX - 300 && (
              <small className="fx-counter">
                {props.replyInput.length}/{FORUM_REPLY_MAX}
              </small>
            )}
          </div>
        ) : (
          <p className="fx-composer-locked" role="note">
            {!viewer.canPostInHub ? t("forum.restriction.ownerOnly") : t("forum.view.lockedNote")}
          </p>
        ))}
    </section>
  );

  return (
    <div className={`fx-forum${activePostId ? " has-thread" : ""}`}>
      {feed}
      {thread}
      {banner && (
        <div className="fx-toast" role="alert">
          <span>{banner}</span>
          <button
            type="button"
            className="dcx-btn dcx-btn-ghost dcx-btn-sm"
            aria-label={t("forum.view.dismiss")}
            onClick={() => setBanner("")}
          >
            <Icon name="close" size="sm" />
          </button>
        </div>
      )}
    </div>
  );
}
