// Start a direct message or a group chat with friends.

import { useTranslation } from "react-i18next";
import type { Dispatch, SetStateAction } from "react";
import { Icon } from "../../components/Icon";
import type { SocialUser } from "../types";
import { UserAvatar } from "../components/UserAvatar";
import type { NewConversationState } from "../state/new-conversation";
import type { DirectMessageActions } from "../actions/direct-messages";

type Props = {
  friends: SocialUser[];
  groupError: string;
  setShowNewConversation: Dispatch<SetStateAction<boolean>>;
  openDirectMessage: (user: SocialUser) => Promise<void>;
  newConversation: NewConversationState;
  directMessages: DirectMessageActions;
};

export function NewConversationDialog({
  friends,
  groupError,
  setShowNewConversation,
  openDirectMessage,
  newConversation,
  directMessages,
}: Props) {
  const { t } = useTranslation(["common", "hub", "chat"]);
  const { toggleNewGroupMember, createGroupChat } = directMessages;
  const { newGroupMemberIds, newGroupName, setNewGroupName, groupCreating } = newConversation;
  return (
    <div className="modal-overlay" onClick={() => setShowNewConversation(false)}>
      <div className="modal dc-social-modal" onClick={(event) => event.stopPropagation()}>
        <div className="ds-modal-head">
          <div>
            <span className="ds-kicker">{t("chat.newConversation.kicker")}</span>
            <h2>{t("chat.newConversation.title")}</h2>
          </div>
          <button
            type="button"
            className="ds-btn ds-btn-ghost ds-icon-btn"
            aria-label={t("common.actions.close")}
            onClick={() => setShowNewConversation(false)}
          >
            <Icon name="close" />
          </button>
        </div>

        <p className="ds-text-muted dc-social-modal-lead">{t("chat.newConversation.lead")}</p>

        <div className="ds-list dc-social-modal-list">
          {friends.length === 0 ? (
            <div className="ds-empty">
              <span className="ds-empty-icon">
                <Icon name="users" />
              </span>
              <p>{t("chat.newConversation.empty")}</p>
            </div>
          ) : (
            friends.map((friend) => {
              const selected = newGroupMemberIds.includes(friend.id);
              return (
                <div key={`new-chat-${friend.id}`} className={`ds-row ds-row-boxed${selected ? " active" : ""}`}>
                  <UserAvatar username={friend.username} avatarUrl={friend.avatarUrl} />
                  <div className="ds-row-copy">
                    <span className="ds-row-title">{friend.username}</span>
                    <span className="ds-row-sub">
                      {friend.online ? t("common.presence.online") : t("common.presence.offline")}
                    </span>
                  </div>
                  <div className="ds-row-actions">
                    <button
                      type="button"
                      className="ds-btn ds-btn-sm"
                      onClick={() => toggleNewGroupMember(friend.id)}
                      aria-pressed={selected}
                    >
                      {selected ? (
                        <>
                          <Icon name="check" />
                          {t("chat.newConversation.selected")}
                        </>
                      ) : (
                        t("chat.newConversation.select")
                      )}
                    </button>
                    <button
                      type="button"
                      className="ds-btn ds-btn-sm ds-btn-primary"
                      onClick={() => {
                        setShowNewConversation(false);
                        void openDirectMessage(friend);
                      }}
                    >
                      <Icon name="message" />
                      {t("chat.newConversation.message")}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="ds-card dc-social-group-create">
          <span className="ds-section-label">{t("chat.newConversation.createTitle")}</span>
          <input
            className="ds-input"
            value={newGroupName}
            onChange={(event) => setNewGroupName(event.target.value)}
            placeholder={t("chat.newConversation.groupName")}
            maxLength={48}
          />
          <div className="dc-social-group-create-row">
            <button
              type="button"
              className="ds-btn ds-btn-primary"
              disabled={newGroupMemberIds.length < 2 || groupCreating}
              onClick={() => void createGroupChat()}
            >
              <Icon name="users" />
              {groupCreating
                ? t("chat.newConversation.creating")
                : t("chat.newConversation.create", { members: newGroupMemberIds.length + 1 })}
            </button>
            <small className="ds-text-muted">{t("chat.newConversation.hint")}</small>
          </div>
          {groupError && (
            <div className="ds-notice danger" role="alert">
              {groupError}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
