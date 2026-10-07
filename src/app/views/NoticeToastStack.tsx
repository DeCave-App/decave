// Stack of short notices (Hub sharing, invites, errors) pinned to the top of the window.

import type { Dispatch, SetStateAction } from "react";
import { Icon } from "../../components/Icon";
import type { SocialUser, DmNotice } from "../types";
import { DmNoticeToast } from "./DmNoticeToast";
import { FriendRequestToast } from "./FriendRequestToast";

type Props = {
  hubShareNotice: string;
  setHubShareNotice: Dispatch<SetStateAction<string>>;
  friends: SocialUser[];
  setShowSocial: Dispatch<SetStateAction<boolean>>;
  setSocialView: Dispatch<SetStateAction<"dm" | "friends">>;
  setActiveDmUser: Dispatch<SetStateAction<SocialUser | null>>;
  friendRequestNotice: SocialUser | null;
  setFriendRequestNotice: Dispatch<SetStateAction<SocialUser | null>>;
  dmNotice: DmNotice | null;
  setDmNotice: Dispatch<SetStateAction<DmNotice | null>>;
  openDirectMessage: (user: SocialUser) => Promise<void>;
};

export function NoticeToastStack({
  hubShareNotice,
  setHubShareNotice,
  friends,
  setShowSocial,
  setSocialView,
  setActiveDmUser,
  friendRequestNotice,
  setFriendRequestNotice,
  dmNotice,
  setDmNotice,
  openDirectMessage,
}: Props) {
  return (
    <div
      style={{
        position: "fixed",
        top: "74px",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 100000,
        width: "min(430px, calc(100vw - 28px))",
        display: "grid",
        gap: "10px",
        pointerEvents: "none",
      }}
    >
      {hubShareNotice && (
        <button type="button" onClick={() => setHubShareNotice("")} className="dc-hub-share-notice">
          <span>
            <Icon name="link" size="sm" />
          </span>
          <strong>{hubShareNotice}</strong>
          <b>
            <Icon name="close" size="sm" />
          </b>
        </button>
      )}
      {friendRequestNotice && (
        <FriendRequestToast
          setShowSocial={setShowSocial}
          setSocialView={setSocialView}
          setActiveDmUser={setActiveDmUser}
          friendRequestNotice={friendRequestNotice}
          setFriendRequestNotice={setFriendRequestNotice}
        />
      )}

      {dmNotice && (
        <DmNoticeToast
          friends={friends}
          setShowSocial={setShowSocial}
          setActiveDmUser={setActiveDmUser}
          dmNotice={dmNotice}
          setDmNotice={setDmNotice}
          openDirectMessage={openDirectMessage}
        />
      )}
    </div>
  );
}
