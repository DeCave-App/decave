// Friends' presence from the live user list. The server's USERS_UPDATE lists
// every connected friend (with the status, status text and activity a friend
// may see) and marks invisible users "invisible", which is exactly how
// /api/social decides `online`; so the friends list can follow it without
// another request.

import type { OnlineUser, SocialUser } from "../app/types";

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
