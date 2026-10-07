// Members of a group chat: add a friend, remove members, leave or delete the group.

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
  const { addGroupMember, removeGroupMember, deleteActiveGroup } = directMessages;
  return (
    <div className="modal-overlay" onClick={() => setShowGroupMembers(false)}>
      <div className="modal dc-social-modal" onClick={(event) => event.stopPropagation()}>
        <div className="ds-modal-head">
          <div>
            <span className="ds-kicker">Group members</span>
            <h2>{activeGroupChat.name}</h2>
          </div>
          <button
            type="button"
            className="ds-btn ds-btn-ghost ds-icon-btn"
            aria-label="Close"
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
                    {isMe ? " · You" : ""}
                  </span>
                  <span className={`ds-row-sub${isOwner ? " ds-text-accent" : ""}`}>
                    {isOwner ? (
                      <>
                        <Icon name="crown" size="sm" /> Group owner
                      </>
                    ) : (
                      "Member"
                    )}
                  </span>
                </div>
                {amOwner && !isMe ? (
                  <button
                    type="button"
                    className="ds-btn ds-btn-sm ds-btn-danger"
                    onClick={() => void removeGroupMember(member)}
                  >
                    Remove
                  </button>
                ) : isMe && !isOwner ? (
                  <button
                    type="button"
                    className="ds-btn ds-btn-sm ds-btn-danger"
                    onClick={() => void removeGroupMember(member)}
                  >
                    <Icon name="log-out" />
                    Leave
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>

        <span className="ds-section-label">Add a friend</span>
        <div className="ds-list">
          {friends.filter((friend) => !activeGroupChat.members.some((member) => member.id === friend.id)).length ===
          0 ? (
            <div className="ds-row-sub dc-social-modal-empty">No other friends are available to add.</div>
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
                    Add
                  </button>
                </div>
              ))
          )}
        </div>

        {activeGroupChat.ownerUserId === currentUser.id && activeGroupChat.memberCount > 1 && (
          <p className="ds-text-muted dc-social-modal-note">
            As owner, remove the other members before leaving the group.
          </p>
        )}
        {activeGroupChat.ownerUserId === currentUser.id && (
          <div className="ds-modal-actions dc-social-modal-danger">
            <button type="button" className="ds-btn ds-btn-danger" onClick={() => void deleteActiveGroup()}>
              <Icon name="trash" />
              Delete group
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
