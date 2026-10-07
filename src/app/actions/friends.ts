// Friends: applying the friends/requests state from the server, accepting,
// rejecting and removing friends, adding by DeCave ID, copying your own ID.

import type { Dispatch, SetStateAction, MutableRefObject } from "react";
import type { AccountUser, SocialUser, DirectMessage, ApiError, NotificationSettings, UiSoundEvent } from "../types";
import { HTTP_URL } from "../env";

export type FriendActionsDeps = {
  authToken: string;
  currentUser: AccountUser | null;
  setFriends: Dispatch<SetStateAction<SocialUser[]>>;
  friends: SocialUser[];
  setIncomingFriendRequests: Dispatch<SetStateAction<SocialUser[]>>;
  incomingFriendRequests: SocialUser[];
  setOutgoingFriendRequests: Dispatch<SetStateAction<SocialUser[]>>;
  outgoingFriendRequests: SocialUser[];
  friendIdInput: string;
  setFriendIdInput: Dispatch<SetStateAction<string>>;
  setFriendIdNotice: Dispatch<SetStateAction<string>>;
  friendRequestSentToRef: MutableRefObject<string | null>;
  setFriendIdBusy: Dispatch<SetStateAction<boolean>>;
  setActiveDmUser: Dispatch<SetStateAction<SocialUser | null>>;
  setDmMessages: Dispatch<SetStateAction<DirectMessage[]>>;
  setDmError: Dispatch<SetStateAction<string>>;
  setFriendRequestNotice: Dispatch<SetStateAction<SocialUser | null>>;
  notificationSettingsRef: MutableRefObject<NotificationSettings>;
  activeDmUserRef: MutableRefObject<SocialUser | null>;
  incomingFriendIdsRef: MutableRefObject<Set<string>>;
  socialStateInitializedRef: MutableRefObject<boolean>;
  friendRequestNoticeTimerRef: MutableRefObject<number | null>;
  desktopNotify: (
    title: string,
    body: string,
    kind?: "friend" | "dm" | "voice",
    soundEvent?: UiSoundEvent | null,
    quietKind?: "dm" | "mention" | "other",
  ) => void;
  authorizedFetch: (url: string, init?: RequestInit) => Promise<Response>;
};

/** Called once per render with that render's values. */
export function createFriendActions(deps: FriendActionsDeps) {
  const {
    authToken,
    currentUser,
    setFriends,
    friends,
    setIncomingFriendRequests,
    incomingFriendRequests,
    setOutgoingFriendRequests,
    outgoingFriendRequests,
    friendIdInput,
    setFriendIdInput,
    setFriendIdNotice,
    friendRequestSentToRef,
    setFriendIdBusy,
    setActiveDmUser,
    setDmMessages,
    setDmError,
    setFriendRequestNotice,
    notificationSettingsRef,
    activeDmUserRef,
    incomingFriendIdsRef,
    socialStateInitializedRef,
    friendRequestNoticeTimerRef,
    desktopNotify,
    authorizedFetch,
  } = deps;

  const applySocialState = (data: { friends?: SocialUser[]; incoming?: SocialUser[]; outgoing?: SocialUser[] }) => {
    const nextFriends = Array.isArray(data.friends) ? data.friends : [];
    const nextIncoming = Array.isArray(data.incoming) ? data.incoming : [];
    const nextOutgoing = Array.isArray(data.outgoing) ? data.outgoing : [];

    if (socialStateInitializedRef.current) {
      const newRequest = nextIncoming.find((user) => !incomingFriendIdsRef.current.has(user.id));
      if (newRequest) {
        if (notificationSettingsRef.current.friendRequests)
          desktopNotify("New friend request", `${newRequest.username} wants to be friends.`, "friend");
        setFriendRequestNotice(newRequest);
        if (friendRequestNoticeTimerRef.current !== null) {
          window.clearTimeout(friendRequestNoticeTimerRef.current);
        }
        friendRequestNoticeTimerRef.current = window.setTimeout(() => {
          setFriendRequestNotice(null);
          friendRequestNoticeTimerRef.current = null;
        }, 6500);
      }
    }

    incomingFriendIdsRef.current = new Set(nextIncoming.map((user) => user.id));
    socialStateInitializedRef.current = true;
    const sentTo = friendRequestSentToRef.current;
    if (sentTo && nextFriends.some((friend) => String(friend.id) === sentTo)) {
      friendRequestSentToRef.current = null;
      setFriendIdNotice((current) => (current === "Friend request sent." ? "" : current));
    }
    setFriends(nextFriends);
    setIncomingFriendRequests(nextIncoming);
    setOutgoingFriendRequests(nextOutgoing);
  };

  const loadSocialState = async () => {
    if (!authToken) return;
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/social`);
      if (!response.ok) return;
      const data = (await response.json()) as {
        friends?: SocialUser[];
        incoming?: SocialUser[];
        outgoing?: SocialUser[];
      };
      applySocialState(data);
    } catch (error) {
      console.error("Could not load friends:", error);
    }
  };

  const friendStatusFor = (userId: string) => {
    if (friends.some((user) => user.id === userId)) return "friend" as const;
    if (incomingFriendRequests.some((user) => user.id === userId)) return "incoming" as const;
    if (outgoingFriendRequests.some((user) => user.id === userId)) return "outgoing" as const;
    return "none" as const;
  };

  const socialAction = async (userId: string, action: "request" | "accept" | "reject" | "remove") => {
    setDmError("");
    try {
      const response = await authorizedFetch(
        action === "remove"
          ? `${HTTP_URL}/api/friends/${encodeURIComponent(userId)}`
          : `${HTTP_URL}/api/friends/${encodeURIComponent(userId)}/${action}`,
        { method: action === "remove" ? "DELETE" : "POST" },
      );
      const data = (await response.json().catch(() => ({}))) as ApiError;
      if (!response.ok) {
        setDmError(data.error || "Could not update friend status.");
        return;
      }
      if (action === "remove" && activeDmUserRef.current?.id === userId) {
        activeDmUserRef.current = null;
        setActiveDmUser(null);
        setDmMessages([]);
      }
      await loadSocialState();
    } catch (error) {
      console.error("Friend action failed:", error);
      setDmError("Could not update friend status.");
    }
  };

  const addFriendByDecaveId = async () => {
    const user = currentUser;
    if (!user) {
      setFriendIdNotice("Your session is not ready yet.");
      return;
    }

    const targetId = friendIdInput.trim();
    setFriendIdNotice("");

    if (!targetId) {
      setFriendIdNotice("Enter a DeCave ID.");
      return;
    }
    if (targetId === user.id) {
      setFriendIdNotice("That is your own DeCave ID.");
      return;
    }
    if (friends.some((friend) => friend.id === targetId)) {
      setFriendIdNotice("You are already friends.");
      return;
    }
    if (outgoingFriendRequests.some((user) => user.id === targetId)) {
      setFriendIdNotice("Friend request already sent.");
      return;
    }

    setFriendIdBusy(true);
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/friends/${encodeURIComponent(targetId)}/request`, {
        method: "POST",
      });
      const data = (await response.json().catch(() => ({}))) as ApiError;
      if (!response.ok) {
        setFriendIdNotice(data.error || "Could not send friend request.");
        return;
      }

      setFriendIdInput("");
      friendRequestSentToRef.current = String(targetId);
      setFriendIdNotice("Friend request sent.");
      await loadSocialState();
    } catch (error) {
      console.error("Friend request by DeCave ID failed:", error);
      setFriendIdNotice("Could not send friend request.");
    } finally {
      setFriendIdBusy(false);
    }
  };

  const copyMyDecaveId = async () => {
    const user = currentUser;
    if (!user) {
      setFriendIdNotice("Your session is not ready yet.");
      return;
    }

    try {
      await navigator.clipboard.writeText(user.id);
      setFriendIdNotice("Your DeCave ID was copied.");
    } catch {
      setFriendIdNotice(`Your DeCave ID: ${user.id}`);
    }
  };

  return {
    applySocialState,
    loadSocialState,
    friendStatusFor,
    socialAction,
    addFriendByDecaveId,
    copyMyDecaveId,
  };
}

export type FriendActions = ReturnType<typeof createFriendActions>;
