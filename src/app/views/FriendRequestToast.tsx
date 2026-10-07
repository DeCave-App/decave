// Toast for a new friend request; opens Friends.

import type { Dispatch, SetStateAction } from "react";
import { Icon } from "../../components/Icon";
import type { SocialUser } from "../types";
import { UserAvatar } from "../components/UserAvatar";

type Props = {
  setShowSocial: Dispatch<SetStateAction<boolean>>;
  setSocialView: Dispatch<SetStateAction<"dm" | "friends">>;
  setActiveDmUser: Dispatch<SetStateAction<SocialUser | null>>;
  friendRequestNotice: SocialUser;
  setFriendRequestNotice: Dispatch<SetStateAction<SocialUser | null>>;
};

export function FriendRequestToast({
  setShowSocial,
  setSocialView,
  setActiveDmUser,
  friendRequestNotice,
  setFriendRequestNotice,
}: Props) {
  return (
    <button
      type="button"
      onClick={() => {
        setFriendRequestNotice(null);
        setShowSocial(true);
        setSocialView("friends");
        setActiveDmUser(null);
      }}
      style={{
        pointerEvents: "auto",
        width: "100%",
        minHeight: "70px",
        display: "grid",
        gridTemplateColumns: "48px 1fr auto",
        alignItems: "center",
        gap: "12px",
        padding: "10px 14px",
        border: "1px solid color-mix(in srgb, var(--ds-accent-2) 45%, transparent)",
        borderRadius: "14px",
        background: "var(--ds-surface-2)",
        boxShadow: "0 18px 48px rgba(0, 0, 0, 0.48), 0 0 28px rgba(92, 219, 255, 0.12)",
        color: "var(--ds-text)",
        textAlign: "left",
        backdropFilter: "blur(18px)",
      }}
    >
      <UserAvatar
        username={friendRequestNotice.username}
        avatarUrl={friendRequestNotice.avatarUrl}
        style={{
          width: "48px",
          height: "48px",
          borderRadius: "50%",
          background: "var(--ds-surface-2)",
        }}
      />
      <span style={{ display: "grid", gap: "2px", minWidth: 0 }}>
        <small style={{ color: "var(--ds-accent-2)", fontSize: "10px", fontWeight: 800, letterSpacing: ".1em" }}>
          NEW FRIEND REQUEST
        </small>
        <strong style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{friendRequestNotice.username}</strong>
        <em style={{ color: "var(--ds-muted)", fontSize: "12px", fontStyle: "normal" }}>Click to review</em>
      </span>
      <b className="ds-text-accent">
        <Icon name="user-plus" size="lg" />
      </b>
    </button>
  );
}
