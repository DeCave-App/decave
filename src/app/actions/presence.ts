// Changes the user's presence status (online, idle, do not disturb, invisible) and syncs it.

import type { Dispatch, SetStateAction, MutableRefObject } from "react";
import type { PresenceStatus, AccountUser, ServerMemberView, SocialUser } from "../types";
import { HTTP_URL } from "../env";
import { authorizedFetch } from "../http";

export type PresenceActionsDeps = {
  currentUser: AccountUser | null;
  setCurrentUser: Dispatch<SetStateAction<AccountUser | null>>;
  setProfileAvatarError: Dispatch<SetStateAction<string>>;
  profileFields: {
    profileBio: string;
    setProfileBio: Dispatch<SetStateAction<string>>;
    profileStatus: PresenceStatus;
    setProfileStatus: Dispatch<SetStateAction<PresenceStatus>>;
    profileStatusText: string;
    setProfileStatusText: Dispatch<SetStateAction<string>>;
    profileAccent: string;
    setProfileAccent: Dispatch<SetStateAction<string>>;
    profileDisplayName: string;
    setProfileDisplayName: Dispatch<SetStateAction<string>>;
    profilePronouns: string;
    setProfilePronouns: Dispatch<SetStateAction<string>>;
  };
  setHubMembers: Dispatch<SetStateAction<ServerMemberView[]>>;
  setFriends: Dispatch<SetStateAction<SocialUser[]>>;
  activeServerRef: MutableRefObject<number>;
  setCurrentUserFromResponse: (nextUser: AccountUser) => void;
  friendActions: {
    applySocialState: (data: { friends?: SocialUser[]; incoming?: SocialUser[]; outgoing?: SocialUser[] }) => void;
    loadSocialState: () => Promise<void>;
    friendStatusFor: (userId: string) => "friend" | "incoming" | "outgoing" | "none";
    socialAction: (userId: string, action: "request" | "accept" | "reject" | "remove") => Promise<void>;
    addFriendByDecaveId: () => Promise<void>;
    copyMyDecaveId: () => Promise<void>;
  };
  loadServerMembers: (serverId: number) => Promise<void>;
};

/** Called once per render with that render's values. */
export function createPresenceActions(deps: PresenceActionsDeps) {
  const {
    currentUser,
    setCurrentUser,
    setProfileAvatarError,
    profileFields,
    setHubMembers,
    setFriends,
    activeServerRef,
    setCurrentUserFromResponse,
    friendActions,
    loadServerMembers,
  } = deps;

  const changePresenceStatus = async (status: PresenceStatus) => {
    if (!currentUser) return;

    const previousStatus = currentUser.status ?? "online";

    // Update every local surface immediately.
    profileFields.setProfileStatus(status);
    setCurrentUser((current) => (current ? { ...current, status } : current));
    setHubMembers((current) =>
      current.map((member) =>
        member.userId === currentUser.id ? { ...member, status, online: status !== "invisible" } : member,
      ),
    );
    setFriends((current) =>
      current.map((friend) =>
        friend.id === currentUser.id ? { ...friend, status, online: status !== "invisible" } : friend,
      ),
    );

    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/profile/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        user?: AccountUser;
        error?: string;
      };

      if (!response.ok || !data.user) {
        profileFields.setProfileStatus(previousStatus);
        setCurrentUser((current) => (current ? { ...current, status: previousStatus } : current));
        setProfileAvatarError(data.error || "Could not change status.");
        return;
      }

      setCurrentUserFromResponse(data.user);
      profileFields.setProfileStatus(data.user.status ?? status);

      if (activeServerRef.current > 0) {
        void loadServerMembers(activeServerRef.current);
      }
      void friendActions.loadSocialState();
    } catch {
      profileFields.setProfileStatus(previousStatus);
      setCurrentUser((current) => (current ? { ...current, status: previousStatus } : current));
      setProfileAvatarError("Could not change status.");
    }
  };

  return {
    changePresenceStatus,
  };
}
