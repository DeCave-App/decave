// Toast for a new direct message; opens the conversation.

import type { Dispatch, SetStateAction } from "react";
import { Icon } from "../../components/Icon";
import type { SocialUser, DmNotice } from "../types";
import { UserAvatar } from "../components/UserAvatar";

type Props = {
  friends: SocialUser[];
  setShowSocial: Dispatch<SetStateAction<boolean>>;
  setActiveDmUser: Dispatch<SetStateAction<SocialUser | null>>;
  dmNotice: DmNotice;
  setDmNotice: Dispatch<SetStateAction<DmNotice | null>>;
  openDirectMessage: (user: SocialUser) => Promise<void>;
};

export function DmNoticeToast({
  friends,
  setShowSocial,
  setActiveDmUser,
  dmNotice,
  setDmNotice,
  openDirectMessage,
}: Props) {
  return (
    <button
      type="button"
      onClick={() => {
        const sender = friends.find((friend) => friend.id === dmNotice.userId);
        setDmNotice(null);
        if (sender) void openDirectMessage(sender);
        else {
          setShowSocial(true);
          setActiveDmUser(null);
        }
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
        border: "1px solid color-mix(in srgb, var(--ds-accent) 48%, transparent)",
        borderRadius: "14px",
        background: "var(--ds-surface-2)",
        boxShadow: "0 18px 48px rgba(0, 0, 0, 0.48), 0 0 28px rgba(139, 92, 246, 0.14)",
        color: "var(--ds-text)",
        textAlign: "left",
        backdropFilter: "blur(18px)",
      }}
    >
      <UserAvatar
        username={dmNotice.username}
        avatarUrl={dmNotice.avatarUrl}
        style={{
          width: "48px",
          height: "48px",
          borderRadius: "50%",
          background: "var(--ds-surface-2)",
        }}
      />
      <span style={{ display: "grid", gap: "2px", minWidth: 0 }}>
        <small style={{ color: "var(--ds-accent)", fontSize: "10px", fontWeight: 800, letterSpacing: ".1em" }}>
          NEW PRIVATE MESSAGE
        </small>
        <strong>{dmNotice.username}</strong>
        <em
          style={{
            color: "var(--ds-text-soft)",
            fontSize: "12px",
            fontStyle: "normal",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {dmNotice.text}
        </em>
      </span>
      <b className="ds-text-accent">
        <Icon name="chevron-right" />
      </b>
    </button>
  );
}
