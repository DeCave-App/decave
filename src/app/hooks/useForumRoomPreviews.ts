// Loads the latest posts of forum rooms for their sidebar previews.

import { type Dispatch, type SetStateAction, useEffect } from "react";
import type { ForumPreview } from "../../features/hub-sidebar/HubRoomBoxes";
import { fetchForumPosts, loadSeen, isUnread } from "../../features/forum";
import type { AccountUser } from "../types";
import { HTTP_URL } from "../env";

export type ForumRoomPreviewsDeps = {
  currentUser: AccountUser | null;
  selectedChannel: number;
  setForumPreviews: Dispatch<SetStateAction<Record<number, ForumPreview | null>>>;
  authorizedFetch: (url: string, init?: RequestInit) => Promise<Response>;
  forumRoomKey: string;
};

export function useForumRoomPreviews(deps: ForumRoomPreviewsDeps): void {
  const { currentUser, selectedChannel, setForumPreviews, authorizedFetch, forumRoomKey } = deps;

  // Newest thread per forum for the sidebar Forums box. Refreshes when the room
  // changes so "new" clears after visiting a forum.
  useEffect(() => {
    const roomIds = forumRoomKey
      ? forumRoomKey
          .split(",")
          .map(Number)
          .filter((id) => id > 0)
          .slice(0, 12)
      : [];
    const viewerId = currentUser?.id;
    if (!roomIds.length || !viewerId) return;
    const controller = new AbortController();
    void Promise.all(
      roomIds.map(async (roomId): Promise<readonly [number, ForumPreview | null | undefined]> => {
        try {
          const { posts } = await fetchForumPosts(
            authorizedFetch,
            HTTP_URL,
            roomId,
            { sort: "active", tag: null, q: "", cursor: null, limit: 3 },
            controller.signal,
          );
          const entry = posts.find((post) => !post.pinned) ?? posts[0];
          if (!entry) return [roomId, null];
          return [
            roomId,
            {
              title: entry.payload.title,
              replyCount: entry.replyCount,
              lastActivityAt: entry.lastActivityAt,
              unread: isUnread(loadSeen(roomId), entry, viewerId),
              solved: entry.solvedReplyId !== null,
            },
          ];
        } catch {
          return [roomId, undefined];
        }
      }),
    ).then((results) => {
      if (controller.signal.aborted) return;
      setForumPreviews((current) => {
        const next = { ...current };
        for (const [roomId, preview] of results) if (preview !== undefined) next[roomId] = preview;
        return next;
      });
    });
    return () => controller.abort();
  }, [forumRoomKey, currentUser?.id, selectedChannel]);
}
