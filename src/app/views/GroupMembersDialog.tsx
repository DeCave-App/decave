// Members of a group chat: add a friend, remove members, leave or delete the group.

import { useTranslation } from "react-i18next";
import type { Dispatch, SetStateAction } from "react";
import { Icon } from "../../components/Icon";
import type { AccountUser, SocialUser, GroupChat } from "../types";
import { UserAvatar } from "../components/UserAvatar";
import type { DirectMessageActions } from "../actions/direct-messages";

type Props = {
  currentUser: AccountUser;
  friends: SocialUser[];
  activeGroupChat: GroupChat;
  groupError: string;
  setShowGroupMembers: Dispatch<SetStateAction<boolean>>;
  directMessages: DirectMessageActions;
};

export function GroupMembersDialog({
  currentUser,
  friends,
  activeGroupChat,
  groupError,
  setShowGroupMembers,
  directMessages,
}: Props) {
  const { t } = useTranslation(["common", "hub", "chat"]);
  const { addGroupMember, removeGroupMember, deleteActiveGroup } = directMessages;
  return (
    <div className="modal-overlay" onClick={() => setShowGroupMembers(false)}>
      <div className="modal dc-social-modal" onClick={(event) => event.stopPropagation()}>
        <div className="ds-modal-head">
          <div>
            <span className="ds-kicker">{t("chat.groupMembers.kicker")}</span>
            <h2>{activeGroupChat.name}</h2>
          </div>
          <button
            type="button"
            className="ds-btn ds-btn-ghost ds-icon-btn"
            aria-label={t("common.actions.close")}
            onClick={() => setShowGroupMembers(false)}
          >
            <Icon name="close" />
          </button>
        </div>

        <div className="ds-list dc-social-modal-list">
          {activeGroupChat.members.map((member) => {
            const isOwner = member.id === activeGroupChat.ownerUserId;
            const amOwner = currentUser.id === activeGroupChat.ownerUserId;
            const isMe = member.id === currentUser.id;
            return (
              <div key={`group-member-${member.id}`} className="ds-row ds-row-boxed">
                <UserAvatar username={member.username} avatarUrl={member.avatarUrl} />
                <div className="ds-row-copy">
                  <span className="ds-row-title">
                    {member.username}
                    {isMe ? t("chat.groupMembers.youSuffix") : ""}
                  </span>
                  <span className={`ds-row-sub${isOwner ? " ds-text-accent" : ""}`}>
                    {isOwner ? (
                      <>
                        <Icon name="crown" size="sm" /> {t("chat.groupMembers.owner")}
                      </>
                    ) : (
                      t("chat.groupMembers.member")
                    )}
                  </span>
                </div>
                {amOwner && !isMe ? (
                  <button
                    type="button"
                    className="ds-btn ds-btn-sm ds-btn-danger"
                    onClick={() => void removeGroupMember(member)}
                  >
                    {t("common.actions.remove")}
                  </button>
                ) : isMe && !isOwner ? (
                  <button
                    type="button"
                    className="ds-btn ds-btn-sm ds-btn-danger"
                    onClick={() => void removeGroupMember(member)}
                  >
                    <Icon name="log-out" />
                    {t("common.actions.leave")}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>

        <span className="ds-section-label">{t("chat.groupMembers.addTitle")}</span>
        <div className="ds-list">
          {friends.filter((friend) => !activeGroupChat.members.some((member) => member.id === friend.id)).length ===
          0 ? (
            <div className="ds-row-sub dc-social-modal-empty">{t("chat.groupMembers.noneToAdd")}</div>
          ) : (
            friends
              .filter((friend) => !activeGroupChat.members.some((member) => member.id === friend.id))
              .map((friend) => (
                <div key={`group-add-${friend.id}`} className="ds-row ds-row-boxed">
                  <UserAvatar username={friend.username} avatarUrl={friend.avatarUrl} />
                  <div className="ds-row-copy">
                    <span className="ds-row-title">{friend.username}</span>
                  </div>
                  <button
                    type="button"
                    className="ds-btn ds-btn-sm ds-btn-primary"
                    disabled={activeGroupChat.memberCount >= 20}
                    onClick={() => void addGroupMember(friend)}
                  >
                    <Icon name="user-plus" />
                    {t("common.actions.add")}
                  </button>
                </div>
              ))
          )}
        </div>

        {activeGroupChat.ownerUserId === currentUser.id && activeGroupChat.memberCount > 1 && (
          <p className="ds-text-muted dc-social-modal-note">{t("chat.groupMembers.ownerNote")}</p>
        )}
        {activeGroupChat.ownerUserId === currentUser.id && (
          <div className="ds-modal-actions dc-social-modal-danger">
            <button type="button" className="ds-btn ds-btn-danger" onClick={() => void deleteActiveGroup()}>
              <Icon name="trash" />
              {t("chat.groupMembers.deleteGroup")}
            </button>
          </div>
        )}
        {groupError && (
          <div className="ds-notice danger" role="alert">
            {groupError}
          </div>
        )}
      </div>
    </div>
  );
}
