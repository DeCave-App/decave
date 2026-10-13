// Friends' presence from the live user list. The server's USERS_UPDATE lists
// every connected friend (with the status, status text and activity a friend
// may see) and marks invisible users "invisible", which is exactly how
// /api/social decides `online`; so the friends list can follow it without
// another request.

import type { OnlineUser, PresenceStatus, SocialUser } from "../app/types";

export function applyFriendPresence(friends: SocialUser[], users: OnlineUser[]): SocialUser[] {
  let changed = false;
  const next = friends.map((friend) => {
    const live = users.find((user) => user.userId === friend.id && user.status !== "invisible");
    const presence = live
      ? {
          online: true,
          status: live.status ?? friend.status,
          statusText: live.statusText ?? "",
          activityText: live.activityText ?? "",
        }
      : { online: false, status: "invisible" as const, statusText: "", activityText: "" };
    if (
      friend.online === presence.online &&
      friend.status === presence.status &&
      (friend.statusText ?? "") === presence.statusText &&
      (friend.activityText ?? "") === presence.activityText
    )
      return friend;
    changed = true;
    return { ...friend, ...presence };
  });
  return changed ? next : friends;
}

/** One account's presence as this viewer may see it (USERS_DIFF `presence`). */
export type PresenceHint = {
  userId: string;
  online: boolean;
  status: PresenceStatus;
  statusText: string;
  activityText: string;
};

export type UsersDiff = { upsert: OnlineUser[]; remove: string[]; presence: PresenceHint[] };

export function parseUsersDiff(data: { upsert?: unknown; remove?: unknown; presence?: unknown }): UsersDiff {
  return {
    upsert: Array.isArray(data.upsert) ? (data.upsert as OnlineUser[]) : [],
    remove: Array.isArray(data.remove) ? data.remove.filter((id): id is string => typeof id === "string") : [],
    presence: Array.isArray(data.presence) ? (data.presence as PresenceHint[]) : [],
  };
}

/** Apply a USERS_DIFF to the live roster (entries are keyed by connection id). */
export function applyUsersDiff(users: OnlineUser[], diff: UsersDiff): OnlineUser[] {
  if (!diff.upsert.length && !diff.remove.length) return users;
  const drop = new Set([...diff.remove, ...diff.upsert.map((user) => user.id)]);
  return [...users.filter((user) => !drop.has(user.id)), ...diff.upsert];
}

/** Patch online/status fields on any list keyed by public user id (friends, Hub members). */
export function applyPresenceHints<
  T extends { online?: boolean; status?: PresenceStatus; statusText?: string; activityText?: string },
>(list: T[], hints: PresenceHint[], idOf: (item: T) => string): T[] {
  if (!hints.length) return list;
  const byId = new Map(hints.map((hint) => [hint.userId, hint]));
  let changed = false;
  const next = list.map((item) => {
    const hint = byId.get(idOf(item));
    if (!hint) return item;
    if (
      item.online === hint.online &&
      item.status === hint.status &&
      (item.statusText ?? "") === hint.statusText &&
      (item.activityText ?? "") === hint.activityText
    )
      return item;
    changed = true;
    return {
      ...item,
      online: hint.online,
      status: hint.status,
      statusText: hint.statusText,
      activityText: hint.activityText,
    };
  });
  return changed ? next : list;
}

/**
 * The open Hub's online count from the live roster: distinct visible accounts
 * currently viewing that Hub, the same rule the server's count uses. Keeps the
 * header live without refetching the Hub list on every presence change.
 */
export function liveHubOnlineCount(users: OnlineUser[], hubId: number): number {
  if (!hubId) return 0;
  return new Set(
    users
      .filter((user) => user.serverId === hubId && user.status !== "invisible")
      .map((user) => user.userId ?? user.id),
  ).size;
}
