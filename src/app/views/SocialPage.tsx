// Messages and Friends: conversation list, the open DM or group chat, and the Friends view.

import { useTranslation } from "react-i18next";
import type { Dispatch, SetStateAction, MutableRefObject, JSX } from "react";
import { Fragment } from "react";
import { shouldSend, useChatPrefs } from "../../features/settings/chatPrefs";
import { Icon } from "../../components/Icon";
import {
  DmEncryptionBadge,
  DmEncryptionDivider,
  DmEncryptionNotice,
  GroupEncryptionBadge,
} from "../../e2ee/DmEncryptionUi";
import { dmE2ee } from "../../e2ee/dm-e2ee-client";
import type { SafetyReportTarget } from "../../safety/types";
import { ComposerPlusMenu } from "../../features/hub-sidebar/ComposerPlusMenu";
import type {
  ComposerTarget,
  AccountUser,
  SocialUser,
  DirectMessage,
  DmConversation,
  DmPreference,
  GroupChatMessage,
  GroupChat,
} from "../types";
import { formatTimestamp } from "../../i18n/format";
import { presenceLabel, presenceColor } from "../user-display";
import { UserAvatar } from "../components/UserAvatar";
import { FriendsView } from "./FriendsView";
import type { HubChatActions } from "../actions/hub-chat";
import type { DirectMessageActions } from "../actions/direct-messages";
import { VoiceComposer } from "../../features/voice-notes/VoiceComposer";
import { usePendingPlayedRetry } from "../../features/voice-notes/DmVoiceNote";
import type { MessageRendering } from "../actions/message-rendering";
import type { FriendActions } from "../actions/friends";

type Props = {
  currentUser: AccountUser;
  friends: SocialUser[];
  friendListSearch: string;
  setFriendListSearch: Dispatch<SetStateAction<string>>;
  friendListFilter: "online" | "all" | "offline" | "pending";
  setFriendListFilter: Dispatch<SetStateAction<"online" | "all" | "offline" | "pending">>;
  friendActionsUserId: string | null;
  setFriendActionsUserId: Dispatch<SetStateAction<string | null>>;
  incomingFriendRequests: SocialUser[];
  outgoingFriendRequests: SocialUser[];
  friendIdInput: string;
  setFriendIdInput: Dispatch<SetStateAction<string>>;
  friendIdNotice: string;
  friendIdBusy: boolean;
  setShowSocial: Dispatch<SetStateAction<boolean>>;
  socialView: "dm" | "friends";
  setSocialView: Dispatch<SetStateAction<"dm" | "friends">>;
  activeDmUser: SocialUser | null;
  dmConversations: DmConversation[];
  dmPreferences: Record<string, DmPreference>;
  dmConversationSearch: string;
  setDmConversationSearch: Dispatch<SetStateAction<string>>;
  dmListFilter: "all" | "unread" | "requests" | "archived";
  setDmListFilter: Dispatch<SetStateAction<"all" | "unread" | "requests" | "archived">>;
  dmHeaderMenuOpen: boolean;
  setDmHeaderMenuOpen: Dispatch<SetStateAction<boolean>>;
  groupChats: GroupChat[];
  activeGroupChat: GroupChat | null;
  groupMessages: GroupChatMessage[];
  groupInput: string;
  setGroupInput: Dispatch<SetStateAction<string>>;
  groupReplyingTo: GroupChatMessage | null;
  setGroupReplyingTo: Dispatch<SetStateAction<GroupChatMessage | null>>;
  groupError: string;
  setGroupError: Dispatch<SetStateAction<string>>;
  setShowGroupMembers: Dispatch<SetStateAction<boolean>>;
  dmMessages: DirectMessage[];
  dmInput: string;
  setDmInput: Dispatch<SetStateAction<string>>;
  setDmDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  dmReplyingTo: DirectMessage | null;
  setDmReplyingTo: Dispatch<SetStateAction<DirectMessage | null>>;
  dmAttachmentBusy: boolean;
  dmAttachmentRetryName: string;
  dmError: string;
  dmEditingId: string | null;
  setDmEditingId: Dispatch<SetStateAction<string | null>>;
  dmEditingText: string;
  setDmEditingText: Dispatch<SetStateAction<string>>;
  showDmPlusMenu: boolean;
  setShowDmPlusMenu: Dispatch<SetStateAction<boolean>>;
  setShowDmEmojiPicker: Dispatch<SetStateAction<boolean>>;
  setShowGroupEmojiPicker: Dispatch<SetStateAction<boolean>>;
  setGifPickerTarget: Dispatch<SetStateAction<ComposerTarget | null>>;
  setDmDeleteConfirm: Dispatch<SetStateAction<DirectMessage | null>>;
  setDmConversationDeleteConfirm: Dispatch<SetStateAction<SocialUser | null>>;
  dmUnread: Record<string, number>;
  olderHistory: { channel: boolean; dm: boolean; group: boolean };
  olderHistoryBusy: boolean;
  dmMessageListRef: MutableRefObject<HTMLDivElement | null>;
  dmAttachmentInputRef: MutableRefObject<HTMLInputElement | null>;
  dmAttachmentRetryFileRef: MutableRefObject<File | null>;
  openSafetyReport: (target: SafetyReportTarget) => void;
  loadOlderHistory: (kind: "channel" | "dm" | "group", list: HTMLElement | null) => Promise<void>;
  askToRemoveFriend: (user: SocialUser) => void;
  openDirectMessage: (user: SocialUser) => Promise<void>;
  renderGroupMessageBody: (message: GroupChatMessage) => string | JSX.Element;
  dmUnreadTotal: number;
  visibleFriends: SocialUser[];
  visibleDmConversations: DmConversation[];
  hubChat: HubChatActions;
  directMessages: DirectMessageActions;
  /** Realtime status; voice notes need a live connection to post. */
  connectionStatus?: string;
  messageRendering: MessageRendering;
  friendActions: FriendActions;
};

export function SocialPage({
  currentUser,
  friends,
  friendListSearch,
  setFriendListSearch,
  friendListFilter,
  setFriendListFilter,
  friendActionsUserId,
  setFriendActionsUserId,
  incomingFriendRequests,
  outgoingFriendRequests,
  friendIdInput,
  setFriendIdInput,
  friendIdNotice,
  friendIdBusy,
  setShowSocial,
  socialView,
  setSocialView,
  activeDmUser,
  dmConversations,
  dmPreferences,
  dmConversationSearch,
  setDmConversationSearch,
  dmListFilter,
  setDmListFilter,
  dmHeaderMenuOpen,
  setDmHeaderMenuOpen,
  groupChats,
  activeGroupChat,
  groupMessages,
  groupInput,
  setGroupInput,
  groupReplyingTo,
  setGroupReplyingTo,
  groupError,
  setGroupError,
  setShowGroupMembers,
  dmMessages,
  dmInput,
  setDmInput,
  setDmDrafts,
  dmReplyingTo,
  setDmReplyingTo,
  dmAttachmentBusy,
  dmAttachmentRetryName,
  dmError,
  dmEditingId,
  setDmEditingId,
  dmEditingText,
  setDmEditingText,
  showDmPlusMenu,
  setShowDmPlusMenu,
  setShowDmEmojiPicker,
  setShowGroupEmojiPicker,
  setGifPickerTarget,
  setDmDeleteConfirm,
  setDmConversationDeleteConfirm,
  dmUnread,
  olderHistory,
  olderHistoryBusy,
  dmMessageListRef,
  dmAttachmentInputRef,
  dmAttachmentRetryFileRef,
  openSafetyReport,
  loadOlderHistory,
  askToRemoveFriend,
  openDirectMessage,
  renderGroupMessageBody,
  dmUnreadTotal,
  visibleFriends,
  visibleDmConversations,
  hubChat,
  directMessages,
  connectionStatus = "Connected",
  messageRendering,
  friendActions,
}: Props) {
  const { t } = useTranslation(["common", "hub", "chat"]);
  const chatPrefs = useChatPrefs();
  usePendingPlayedRetry(currentUser.id, connectionStatus === "Connected", activeDmUser?.id);
  const { loadSocialState, socialAction, addFriendByDecaveId, copyMyDecaveId } = friendActions;
  const { dmPreviewText, replyPreviewText, scrollToMessage, renderDmMessageBody } = messageRendering;
  const {
    updateDmPreference,
    formatDmSidebarTime,
    openGroupChat,
    sendGroupMessage,
    deleteGroupMessage,
    openNewConversationComposer,
    sendDirectMessage,
    sendDmVoiceNote,
    reportDmError,
    uploadDmAttachment,
    cancelDmAttachmentUpload,
    sendDmReaction,
    startEditDirectMessage,
    saveEditedDirectMessage,
  } = directMessages;
  const {
    openGifPicker,
    toggleMessageReactionPicker,
    renderMessageReactionPicker,
    renderComposerEmojiPicker,
    renderGifPicker,
    openPollComposer,
  } = hubChat;
  return (
    <section
      className="dc-workspace-page dc-social-page"
      role="dialog"
      aria-modal="true"
      aria-label={socialView === "dm" ? t("chat.social.dmLabel") : t("chat.social.friendsTitle")}
      data-social-surface={socialView === "dm" ? "dms" : "friends"}
      data-primary-workspace={socialView === "dm" ? "dms" : "secondary"}
    >
      <div className="dc-social-shell social-modal dc-dm-shell-host">
        <div className="dc-dm-reference-shell" data-social-view={socialView}>
          <header className="ds-page-header dc-social-header">
            <div className="ds-page-header-copy">
              <h2>{socialView === "dm" ? t("chat.social.dmTitle") : t("chat.social.friendsTitle")}</h2>
              <p>{socialView === "dm" ? t("chat.social.dmLead") : t("chat.social.friendsLead")}</p>
            </div>
            <div className="ds-page-header-actions">
              <button
                type="button"
                className="ds-btn ds-btn-ghost ds-icon-btn"
                onClick={() => setShowSocial(false)}
                aria-label={t("common.actions.close")}
                title={t("common.actions.close")}
              >
                <Icon name="close" />
              </button>
            </div>
          </header>

          {socialView === "dm" ? (
            <div className="dc-dm-reference-grid">
              <aside className="dc-dm-list-pane ds-social-list">
                <div className="ds-social-list-head">
                  <div className="ds-section-label">
                    <span>{t("chat.social.conversations")}</span>
                  </div>
                  <button
                    type="button"
                    className="ds-btn ds-btn-ghost ds-icon-btn ds-btn-sm"
                    onClick={openNewConversationComposer}
                    title={t("chat.newConversation.kicker")}
                    aria-label={t("chat.newConversation.kicker")}
                  >
                    <Icon name="message-plus" />
                  </button>
                </div>
                <label className="ds-search">
                  <Icon name="search" size="sm" />
                  <input
                    className="ds-input"
                    type="search"
                    value={dmConversationSearch}
                    onChange={(event) => setDmConversationSearch(event.target.value)}
                    placeholder={t("chat.social.searchConversations")}
                    aria-label={t("chat.social.searchConversations")}
                  />
                </label>

                <div className="ds-tabs" role="tablist" aria-label={t("chat.social.filters")}>
                  {(["all", "unread", "requests"] as const).map((filter) => (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={dmListFilter === filter}
                      className="ds-tab"
                      key={filter}
                      onClick={() => setDmListFilter(filter)}
                    >
                      {filter === "all"
                        ? t("chat.social.filterAll")
                        : filter === "unread"
                          ? dmUnreadTotal
                            ? t("chat.social.filterUnreadCount", { number: dmUnreadTotal })
                            : t("chat.social.filterUnread")
                          : filter === "requests"
                            ? incomingFriendRequests.length
                              ? t("chat.social.filterRequestsCount", { number: incomingFriendRequests.length })
                              : t("chat.social.filterRequests")
                            : t("chat.social.archived")}
                    </button>
                  ))}
                </div>

                <div className="dc-dm-scroll ds-list">
                  {dmListFilter === "archived" && (
                    <div className="ds-section-label">
                      <span>{t("chat.social.archived")}</span>
                    </div>
                  )}
                  {visibleDmConversations
                    .slice()
                    .sort(
                      (a, b) =>
                        Number(dmPreferences[b.user.id]?.favorite ?? false) -
                          Number(dmPreferences[a.user.id]?.favorite ?? false) ||
                        Date.parse(b.latestTimestamp) - Date.parse(a.latestTimestamp),
                    )
                    .map((conversation) => {
                      const user = conversation.user;
                      return (
                        <button
                          type="button"
                          className={`ds-row ${activeDmUser?.id === user.id && !activeGroupChat ? "active" : ""}`}
                          key={`dm-${user.id}`}
                          onClick={() => void openDirectMessage(user)}
                        >
                          <span className="ds-avatar-wrap">
                            <UserAvatar username={user.username} avatarUrl={user.avatarUrl} />
                            <span
                              className="ds-presence"
                              style={{ background: presenceColor(user.status, user.online === true) }}
                            />
                          </span>
                          <span className="ds-row-copy">
                            <span className="ds-row-title">
                              {user.username}
                              {(dmPreferences[user.id]?.favorite ?? false) && (
                                <Icon name="star" size="sm" filled className="dc-dm-fav-star" />
                              )}
                            </span>
                            <span className="ds-row-sub">
                              {dmPreviewText(conversation.latestMessage) || t("common.inbox.privateMessage")}
                            </span>
                          </span>
                          <span className="ds-row-meta">
                            <span>{formatDmSidebarTime(conversation.latestTimestamp)}</span>
                            {(dmUnread[user.id] ?? 0) > 0 && <span className="ds-badge">{dmUnread[user.id]}</span>}
                          </span>
                        </button>
                      );
                    })}
                  {dmListFilter === "all" &&
                    groupChats
                      .filter(
                        (group) =>
                          !dmConversationSearch.trim() ||
                          group.name.toLowerCase().includes(dmConversationSearch.trim().toLowerCase()) ||
                          group.latestMessage.toLowerCase().includes(dmConversationSearch.trim().toLowerCase()),
                      )
                      .map((group) => (
                        <button
                          type="button"
                          className={`ds-row ${activeGroupChat?.id === group.id ? "active" : ""}`}
                          key={`group-${group.id}`}
                          onClick={() => void openGroupChat(group)}
                        >
                          <span className="ds-avatar-wrap">
                            <span className="ds-avatar">
                              <Icon name="users" />
                            </span>
                          </span>
                          <span className="ds-row-copy">
                            <span className="ds-row-title">{group.name}</span>
                            <span className="ds-row-sub">
                              {group.latestMessage || t("chat.social.groupMembers", { count: group.memberCount })}
                            </span>
                          </span>
                          <span className="ds-row-meta">
                            <span>{formatDmSidebarTime(group.latestTimestamp)}</span>
                            <span
                              className="ds-badge ds-badge-muted"
                              title={t("chat.social.groupMembers", { count: group.memberCount })}
                            >
                              {group.memberCount}
                            </span>
                          </span>
                        </button>
                      ))}
                  {dmListFilter === "requests" && (
                    <>
                      {incomingFriendRequests.map((user) => (
                        <div className="ds-row" key={`dm-request-in-${user.id}`}>
                          <span className="ds-avatar-wrap">
                            <UserAvatar username={user.username} avatarUrl={user.avatarUrl} />
                          </span>
                          <span className="ds-row-copy">
                            <span className="ds-row-title">{user.username}</span>
                            <span className="ds-row-sub">{t("chat.social.incomingRequest")}</span>
                          </span>
                          <span className="ds-row-actions">
                            <button
                              type="button"
                              className="ds-btn ds-btn-primary ds-icon-btn ds-btn-sm"
                              title={t("common.actions.accept")}
                              aria-label={t("common.friends.acceptUser", { name: user.username })}
                              onClick={() => void socialAction(user.id, "accept")}
                            >
                              <Icon name="check" />
                            </button>
                            <button
                              type="button"
                              className="ds-btn ds-btn-ghost ds-icon-btn ds-btn-sm"
                              title={t("common.actions.decline")}
                              aria-label={t("common.friends.declineUser", { name: user.username })}
                              onClick={() => void socialAction(user.id, "reject")}
                            >
                              <Icon name="close" />
                            </button>
                          </span>
                        </div>
                      ))}
                      {outgoingFriendRequests.map((user) => (
                        <div className="ds-row" key={`dm-request-out-${user.id}`}>
                          <span className="ds-avatar-wrap">
                            <UserAvatar username={user.username} avatarUrl={user.avatarUrl} />
                          </span>
                          <span className="ds-row-copy">
                            <span className="ds-row-title">{user.username}</span>
                            <span className="ds-row-sub">{t("common.friends.requestSent")}</span>
                          </span>
                          <span className="ds-row-meta" />
                        </div>
                      ))}
                      {incomingFriendRequests.length === 0 && outgoingFriendRequests.length === 0 && (
                        <div className="ds-empty">
                          <p>{t("chat.social.noRequests")}</p>
                        </div>
                      )}
                    </>
                  )}
                  {dmListFilter !== "requests" &&
                    visibleDmConversations.length === 0 &&
                    (dmListFilter !== "all" || groupChats.length === 0) && (
                      <div className="ds-empty">
                        <p>
                          {dmListFilter === "unread"
                            ? t("chat.social.noUnread")
                            : dmListFilter === "archived"
                              ? t("chat.social.noArchived")
                              : t("chat.social.noConversations")}
                        </p>
                      </div>
                    )}
                </div>

                <div className="ds-social-list-foot">
                  <button
                    type="button"
                    className="dc-dm-archived-link"
                    onClick={() => setDmListFilter(dmListFilter === "archived" ? "all" : "archived")}
                  >
                    <Icon name={dmListFilter === "archived" ? "chevron-left" : "archive"} size="sm" />
                    <span>
                      {dmListFilter === "archived"
                        ? t("chat.social.backToChats")
                        : t("chat.social.archivedCount", {
                            number: dmConversations.filter(
                              (conversation) => dmPreferences[conversation.user.id]?.archived,
                            ).length,
                          })}
                    </span>
                  </button>
                </div>
              </aside>

              <section className="dc-dm-chat-pane">
                {activeGroupChat ? (
                  <>
                    <div className="dc-dm-chat-head">
                      <span className="ds-avatar-wrap">
                        <span className="ds-avatar">
                          <Icon name="users" />
                        </span>
                      </span>
                      <div className="dc-hub-member-copy">
                        <strong>{activeGroupChat.name}</strong>
                        <small>{t("chat.social.groupChatMeta", { count: activeGroupChat.memberCount })}</small>
                      </div>
                      <div className="dc-dm-head-actions">
                        <GroupEncryptionBadge group={activeGroupChat} />
                        {
                          <button
                            type="button"
                            className="dc-dm-head-action"
                            onClick={() => {
                              setGroupError("");
                              setShowGroupMembers(true);
                              void loadSocialState();
                            }}
                            title={t("chat.social.members")}
                            aria-label={t("chat.social.members")}
                          >
                            <Icon name="users" />
                          </button>
                        }
                      </div>
                    </div>
                    <div className="dc-dm-message-area messages">
                      {olderHistory.group && (
                        <button
                          type="button"
                          className="dc-load-older"
                          disabled={olderHistoryBusy}
                          onClick={(event) => void loadOlderHistory("group", event.currentTarget.parentElement)}
                        >
                          {olderHistoryBusy ? t("common.status.loading") : t("chat.social.loadOlder")}
                        </button>
                      )}
                      <div className="dc-dm-day">{t("chat.social.today")}</div>
                      {groupMessages.length === 0 ? (
                        <div className="dc-dm-empty-reference">
                          {t("chat.social.groupBeginning", { name: activeGroupChat.name })}
                        </div>
                      ) : (
                        groupMessages.map((message, index) => {
                          const mine = message.fromUserId === currentUser?.id;
                          // Where history switches from pre-encryption messages to encrypted ones.
                          const encryptionStarts =
                            index > 0 &&
                            message.e2ee !== undefined &&
                            message.e2ee !== "plaintext" &&
                            groupMessages[index - 1].e2ee === "plaintext";
                          const canDelete = mine || activeGroupChat.ownerUserId === currentUser?.id;
                          const replyTarget = message.replyToId
                            ? groupMessages.find((candidate) => candidate.id === message.replyToId)
                            : null;
                          return (
                            <Fragment key={message.id}>
                              {encryptionStarts && <DmEncryptionDivider />}
                              <div className="chat-message group-chat-message" data-message-id={message.id}>
                                <div className="message-avatar-context">
                                  <UserAvatar
                                    username={
                                      mine ? (currentUser?.username ?? t("chat.messages.you")) : message.username
                                    }
                                    avatarUrl={mine ? currentUser?.avatarUrl : message.avatarUrl}
                                    className="message-avatar"
                                  />
                                </div>
                                <div className="chat-message-content">
                                  <div className="chat-message-header">
                                    <strong>{mine ? t("chat.messages.you") : message.username}</strong>
                                    <span>{formatTimestamp(message.timestamp)}</span>
                                  </div>
                                  {message.replyToId && (
                                    <button
                                      type="button"
                                      className="chat-reply-ref"
                                      onClick={() => scrollToMessage(message.replyToId!)}
                                    >
                                      {replyTarget
                                        ? t("chat.messages.replyTo", {
                                            name: replyTarget.username,
                                            preview: replyPreviewText(replyTarget.text),
                                          })
                                        : t("chat.messages.replyToMessage")}
                                    </button>
                                  )}
                                  <div className="chat-message-text">{renderGroupMessageBody(message)}</div>
                                  <div
                                    className="chat-message-hover-actions group-chat-message-actions"
                                    style={{ display: undefined }}
                                  >
                                    <button
                                      type="button"
                                      title={t("chat.messages.reply")}
                                      aria-label={t("chat.messages.reply")}
                                      onClick={() => setGroupReplyingTo(message)}
                                    >
                                      <Icon name="message" />
                                    </button>
                                    {!mine && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          openSafetyReport({
                                            targetType: "message",
                                            targetId: message.id,
                                            subjectUserId: message.fromUserId,
                                            subjectUsername: message.username,
                                            contextType: "group",
                                            contextId: activeGroupChat.id,
                                            contextLabel: activeGroupChat.name,
                                            evidenceType: "message",
                                            evidenceText: message.text,
                                            evidenceLabel: t("chat.report.groupMessageEvidence", {
                                              name: message.username,
                                            }),
                                            // Lets the safety team check an encrypted message really was sent.
                                            e2eeProof: dmE2ee.reportProof(message, "group") ?? undefined,
                                          })
                                        }
                                        title={t("common.actions.report")}
                                        aria-label={t("chat.messages.reportMessage")}
                                      >
                                        <Icon name="flag" />
                                      </button>
                                    )}
                                    {canDelete && (
                                      <button
                                        type="button"
                                        className="danger"
                                        onClick={() => void deleteGroupMessage(message)}
                                        title={
                                          mine ? t("chat.messages.deleteOwn") : t("chat.social.deleteAsGroupOwner")
                                        }
                                        aria-label={t("chat.messages.deleteMessage")}
                                      >
                                        <Icon name="trash" />
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </Fragment>
                          );
                        })
                      )}
                    </div>
                    {groupError && <div className="dm-error">{groupError}</div>}
                    {groupReplyingTo && (
                      <div className="composer-context">
                        <span>
                          {t("chat.social.replyingToPreview", {
                            name: groupReplyingTo.username,
                            preview: replyPreviewText(groupReplyingTo.text),
                          })}
                        </span>
                        <button
                          type="button"
                          onClick={() => setGroupReplyingTo(null)}
                          aria-label={t("chat.social.cancelReply")}
                        >
                          <Icon name="close" size="sm" />
                        </button>
                      </div>
                    )}
                    <div className="dc-dm-reference-composer" style={{ display: undefined }}>
                      <span className="dc-composer-popover-anchor" data-composer-popover="true">
                        <button
                          type="button"
                          className="dc-dm-composer-btn icon-only"
                          title={t("chat.social.add")}
                          onClick={() => {
                            setShowGroupEmojiPicker(false);
                            setGifPickerTarget(null);
                          }}
                          aria-label={t("chat.social.add")}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path
                              fill="currentColor"
                              d="M11 5a1 1 0 0 1 2 0v6h6a1 1 0 1 1 0 2h-6v6a1 1 0 1 1-2 0v-6H5a1 1 0 1 1 0-2h6V5Z"
                            />
                          </svg>
                        </button>
                      </span>
                      <textarea
                        rows={1}
                        spellCheck={chatPrefs.spellcheck}
                        value={groupInput}
                        onChange={(event) => setGroupInput(event.target.value)}
                        onKeyDown={(event) => {
                          if (shouldSend(event, chatPrefs)) {
                            event.preventDefault();
                            void sendGroupMessage();
                          }
                        }}
                        placeholder={t("chat.social.messagePlaceholder", { name: activeGroupChat.name })}
                        maxLength={4000}
                      />
                      <span className="dc-composer-popover-anchor" data-composer-popover="true">
                        <button
                          type="button"
                          className="dc-dm-composer-btn gif-pill"
                          title={t("chat.composer.gif")}
                          onClick={() => openGifPicker("group")}
                        >
                          {t("chat.composer.gif")}
                        </button>
                        {renderGifPicker("group")}
                      </span>
                      <span className="dc-composer-popover-anchor" data-composer-popover="true">
                        <button
                          type="button"
                          className="dc-dm-composer-btn icon-only"
                          title={t("chat.composer.emoji")}
                          aria-label={t("chat.composer.emoji")}
                          onClick={() => {
                            setGifPickerTarget(null);
                            setShowGroupEmojiPicker((value) => !value);
                          }}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path
                              fill="currentColor"
                              d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-3.25 7.5a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Zm6.5 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5ZM7.5 13h9a4.5 4.5 0 0 1-9 0Z"
                            />
                          </svg>
                        </button>
                        {renderComposerEmojiPicker("group")}
                      </span>
                      <button
                        type="button"
                        className="dc-dm-send"
                        onClick={sendGroupMessage}
                        disabled={!groupInput.trim()}
                        aria-label={t("common.actions.send")}
                      >
                        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                          <path
                            fill="currentColor"
                            d="m3.4 3.2 17.5 8a.9.9 0 0 1 0 1.6l-17.5 8a.9.9 0 0 1-1.2-1.05L4 13l8-1-8-1-1.8-6.75A.9.9 0 0 1 3.4 3.2Z"
                          />
                        </svg>
                      </button>
                    </div>
                  </>
                ) : activeDmUser ? (
                  <>
                    <div className="dc-dm-chat-head">
                      <span className="ds-avatar-wrap">
                        <UserAvatar username={activeDmUser.username} avatarUrl={activeDmUser.avatarUrl} />
                        <span
                          className="ds-presence"
                          style={{ background: presenceColor(activeDmUser.status, activeDmUser.online === true) }}
                        />
                      </span>
                      <div className="dc-hub-member-copy">
                        <strong>{activeDmUser.username}</strong>
                        <small>
                          {presenceLabel(activeDmUser.status, activeDmUser.online === true)}
                          {""}
                        </small>
                      </div>
                      <div className="dc-dm-head-actions">
                        <DmEncryptionBadge peer={activeDmUser} />
                        <button
                          type="button"
                          className={`dc-dm-head-action ${dmPreferences[activeDmUser.id]?.favorite ? "active" : ""}`}
                          title={
                            dmPreferences[activeDmUser.id]?.favorite
                              ? t("chat.social.removeFavorite")
                              : t("chat.social.addFavorite")
                          }
                          onClick={() =>
                            void updateDmPreference(activeDmUser.id, {
                              favorite: !(dmPreferences[activeDmUser.id]?.favorite ?? false),
                            })
                          }
                        >
                          <Icon name="star" filled={dmPreferences[activeDmUser.id]?.favorite ?? false} />
                        </button>
                        <button
                          type="button"
                          className="dc-dm-head-action"
                          title={t("chat.social.voiceCall")}
                          aria-label={t("chat.social.voiceCall")}
                          onClick={() =>
                            window.dispatchEvent(
                              new CustomEvent("decave-direct-call-start", {
                                detail: {
                                  targetUserId: activeDmUser.id,
                                  username: activeDmUser.username,
                                  video: false,
                                },
                              }),
                            )
                          }
                        >
                          <Icon name="phone" />
                        </button>
                        <button
                          type="button"
                          className="dc-dm-head-action"
                          title={t("chat.social.videoCall")}
                          aria-label={t("chat.social.videoCall")}
                          onClick={() =>
                            window.dispatchEvent(
                              new CustomEvent("decave-direct-call-start", {
                                detail: { targetUserId: activeDmUser.id, username: activeDmUser.username, video: true },
                              }),
                            )
                          }
                        >
                          <Icon name="video" />
                        </button>
                        <button
                          type="button"
                          className="dc-dm-head-action"
                          title={t("chat.social.options")}
                          aria-label={t("chat.social.options")}
                          onClick={() => setDmHeaderMenuOpen((value) => !value)}
                        >
                          <Icon name="more-vertical" />
                        </button>
                      </div>
                      {dmHeaderMenuOpen && (
                        <div className="dc-dm-head-menu">
                          <button
                            type="button"
                            onClick={() =>
                              void updateDmPreference(activeDmUser.id, {
                                archived: !(dmPreferences[activeDmUser.id]?.archived ?? false),
                              })
                            }
                          >
                            {dmPreferences[activeDmUser.id]?.archived
                              ? t("chat.social.unarchive")
                              : t("chat.social.archive")}
                          </button>
                          {
                            <button
                              type="button"
                              className="danger"
                              onClick={() => {
                                setDmHeaderMenuOpen(false);
                                setDmConversationDeleteConfirm(activeDmUser);
                              }}
                            >
                              {t("chat.social.deleteConversation")}
                            </button>
                          }
                        </div>
                      )}
                    </div>

                    <DmEncryptionNotice peer={activeDmUser} />

                    <div ref={dmMessageListRef} className="dc-dm-message-area messages">
                      {olderHistory.dm && (
                        <button
                          type="button"
                          className="dc-load-older"
                          disabled={olderHistoryBusy}
                          onClick={(event) => void loadOlderHistory("dm", event.currentTarget.parentElement)}
                        >
                          {olderHistoryBusy ? t("common.status.loading") : t("chat.social.loadOlder")}
                        </button>
                      )}
                      <div className="dc-dm-day">{t("chat.social.today")}</div>
                      {dmMessages.length === 0 ? (
                        <div className="dc-dm-empty-reference">{t("chat.social.dmBeginning")}</div>
                      ) : (
                        dmMessages.map((message, index) => {
                          const mine = message.fromUserId === currentUser?.id;
                          // Where history switches from pre-encryption messages to encrypted ones.
                          const encryptionStarts =
                            index > 0 && message.e2ee !== "plaintext" && dmMessages[index - 1].e2ee === "plaintext";
                          const editing = dmEditingId === message.id;
                          const replyTarget = message.replyToId
                            ? dmMessages.find((candidate) => candidate.id === message.replyToId)
                            : null;
                          const replyTargetName = replyTarget
                            ? replyTarget.fromUserId === currentUser?.id
                              ? t("chat.messages.you")
                              : activeDmUser.username
                            : t("chat.social.messageFallback");
                          return (
                            <Fragment key={message.id}>
                              {encryptionStarts && <DmEncryptionDivider />}
                              <div className="chat-message" data-message-id={message.id}>
                                <div className="message-avatar-context">
                                  <UserAvatar
                                    username={
                                      mine ? (currentUser?.username ?? t("chat.messages.you")) : activeDmUser.username
                                    }
                                    avatarUrl={mine ? currentUser?.avatarUrl : activeDmUser.avatarUrl}
                                    className="message-avatar"
                                  />
                                </div>
                                <div className="chat-message-content">
                                  <div className="chat-message-header">
                                    <strong>{mine ? t("chat.messages.you") : activeDmUser.username}</strong>
                                    <span>{formatTimestamp(message.timestamp)}</span>
                                  </div>
                                  {message.replyToId && (
                                    <button
                                      type="button"
                                      className="chat-reply-ref"
                                      onClick={() => scrollToMessage(message.replyToId!)}
                                    >
                                      {replyTarget
                                        ? t("chat.messages.replyTo", {
                                            name: replyTargetName,
                                            preview: replyPreviewText(replyTarget.text),
                                          })
                                        : t("chat.messages.replyToMessage")}
                                    </button>
                                  )}
                                  {editing ? (
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 6 }}>
                                      <input
                                        className="dc-ref-input"
                                        value={dmEditingText}
                                        onChange={(event) => setDmEditingText(event.target.value)}
                                        onKeyDown={(event) => {
                                          if (event.key === "Enter") void saveEditedDirectMessage();
                                          if (event.key === "Escape") {
                                            setDmEditingId(null);
                                            setDmEditingText("");
                                          }
                                        }}
                                        autoFocus
                                      />
                                      <button
                                        type="button"
                                        className="ds-btn ds-btn-primary ds-icon-btn ds-btn-sm"
                                        title={t("chat.social.saveEdit")}
                                        aria-label={t("chat.social.saveEdit")}
                                        onClick={() => void saveEditedDirectMessage()}
                                      >
                                        <Icon name="check" />
                                      </button>
                                      <button
                                        type="button"
                                        className="ds-btn ds-btn-ghost ds-icon-btn ds-btn-sm"
                                        title={t("chat.social.cancelEdit")}
                                        aria-label={t("chat.social.cancelEdit")}
                                        onClick={() => {
                                          setDmEditingId(null);
                                          setDmEditingText("");
                                        }}
                                      >
                                        <Icon name="close" />
                                      </button>
                                    </div>
                                  ) : (
                                    <div className="chat-message-text">{renderDmMessageBody(message)}</div>
                                  )}
                                  <div className="chat-message-reactions">
                                    {Object.entries(message.reactions ?? {}).map(([emoji, users]) =>
                                      users.length > 0 && !emoji.startsWith("poll_") ? (
                                        <button
                                          key={emoji}
                                          type="button"
                                          className="chat-reaction-pill"
                                          onClick={() => void sendDmReaction(message, emoji)}
                                        >
                                          {emoji} {users.length}
                                        </button>
                                      ) : null,
                                    )}
                                  </div>
                                  {!editing && (
                                    <div
                                      className="chat-message-hover-actions dm-chat-message-actions"
                                      style={{ display: undefined }}
                                    >
                                      <div className="message-reaction-picker-anchor">
                                        <button
                                          type="button"
                                          className="reaction-action-button"
                                          title={t("chat.messages.addReaction")}
                                          aria-label={t("chat.messages.addReaction")}
                                          onClick={(event) => toggleMessageReactionPicker(message.id, event)}
                                        >
                                          <Icon name="smile" />
                                        </button>
                                        {renderMessageReactionPicker(
                                          message.id,
                                          (emoji) => void sendDmReaction(message, emoji),
                                        )}
                                      </div>
                                      <button
                                        type="button"
                                        title={t("chat.messages.reply")}
                                        aria-label={t("chat.messages.reply")}
                                        onClick={() => {
                                          setDmEditingId(null);
                                          setDmEditingText("");
                                          setDmReplyingTo(message);
                                        }}
                                      >
                                        <Icon name="message" />
                                      </button>
                                      {!mine && (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            openSafetyReport({
                                              targetType: "message",
                                              targetId: message.id,
                                              subjectUserId: activeDmUser.id,
                                              subjectUsername: activeDmUser.username,
                                              contextType: "dm",
                                              contextId: [currentUser.id, activeDmUser.id].sort().join(":"),
                                              contextLabel: t("chat.report.dmContext", { name: activeDmUser.username }),
                                              evidenceType: "message",
                                              evidenceText: message.text,
                                              evidenceLabel: t("chat.report.dmEvidence", {
                                                name: activeDmUser.username,
                                              }),
                                              // Lets the safety team check an encrypted message was really sent.
                                              e2eeProof: dmE2ee.reportProof(message) ?? undefined,
                                            })
                                          }
                                          title={t("common.actions.report")}
                                          aria-label={t("chat.messages.reportMessage")}
                                        >
                                          <Icon name="flag" />
                                        </button>
                                      )}
                                      {mine && (
                                        <>
                                          <button
                                            type="button"
                                            title={t("common.actions.edit")}
                                            aria-label={t("chat.messages.editMessage")}
                                            onClick={() => startEditDirectMessage(message)}
                                          >
                                            <Icon name="edit" />
                                          </button>
                                          <button
                                            type="button"
                                            className="danger"
                                            title={t("common.actions.delete")}
                                            aria-label={t("chat.messages.deleteMessage")}
                                            onClick={() => setDmDeleteConfirm(message)}
                                          >
                                            <Icon name="trash" />
                                          </button>
                                        </>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </Fragment>
                          );
                        })
                      )}
                    </div>
                    {dmError && <div className="dm-error">{dmError}</div>}
                    {dmReplyingTo && (
                      <div className="composer-context">
                        <span>
                          {t("chat.social.replyingToPreview", {
                            name:
                              dmReplyingTo.fromUserId === currentUser?.id
                                ? t("chat.messages.you")
                                : activeDmUser.username,
                            preview: replyPreviewText(dmReplyingTo.text),
                          })}
                        </span>
                        <button
                          type="button"
                          onClick={() => setDmReplyingTo(null)}
                          aria-label={t("chat.social.cancelReply")}
                        >
                          <Icon name="close" size="sm" />
                        </button>
                      </div>
                    )}
                    {(dmAttachmentBusy ||
                      dmAttachmentRetryName ||
                      dmError.includes("attachment") ||
                      dmError.includes("Upload")) && (
                      <div className="attachment-composer-state">
                        {dmAttachmentBusy ? (
                          <>
                            <span>
                              {dmAttachmentRetryName
                                ? t("chat.social.uploadingNamed", { name: dmAttachmentRetryName })
                                : t("chat.composer.uploading")}
                            </span>
                            <button type="button" onClick={cancelDmAttachmentUpload}>
                              {t("common.actions.cancel")}
                            </button>
                          </>
                        ) : (
                          <>
                            <span className="attachment-error">
                              {dmError || t("chat.social.attachmentReady", { name: dmAttachmentRetryName })}
                            </span>
                            {dmAttachmentRetryFileRef.current && (
                              <button
                                type="button"
                                onClick={() => void uploadDmAttachment(dmAttachmentRetryFileRef.current!)}
                              >
                                {t("chat.composer.retryUpload")}
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    )}
                    <div
                      className="dc-dm-reference-composer dc-hub-composer dc-dm-hub-composer"
                      style={{ display: undefined }}
                    >
                      <input
                        ref={dmAttachmentInputRef}
                        type="file"
                        hidden
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.currentTarget.value = "";
                          setShowDmPlusMenu(false);
                          if (file) void uploadDmAttachment(file);
                        }}
                      />
                      <span className="dc-composer-plus-anchor" data-composer-popover="true">
                        <button
                          type="button"
                          className="dc-dm-composer-btn icon-only"
                          title={t("chat.social.add")}
                          aria-label={t("chat.social.add")}
                          disabled={dmAttachmentBusy}
                          onClick={() => {
                            setShowDmEmojiPicker(false);
                            setGifPickerTarget(null);
                            setShowDmPlusMenu((value) => !value);
                          }}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path
                              fill="currentColor"
                              d="M11 5a1 1 0 0 1 2 0v6h6a1 1 0 1 1 0 2h-6v6a1 1 0 1 1-2 0v-6H5a1 1 0 1 1 0-2h6V5Z"
                            />
                          </svg>
                        </button>
                        {showDmPlusMenu && (
                          <ComposerPlusMenu
                            onClose={() => setShowDmPlusMenu(false)}
                            actions={[
                              {
                                id: "upload",
                                icon: "paperclip",
                                label: t("chat.roomHero.uploadFile"),
                                hint: t("chat.composer.uploadHint"),
                                onSelect: () => dmAttachmentInputRef.current?.click(),
                              },
                              {
                                id: "poll",
                                icon: "poll",
                                label: t("chat.roomHero.createPoll"),
                                hint: t("chat.social.pollHint"),
                                onSelect: () => openPollComposer("dm"),
                              },
                              {
                                id: "gif",
                                icon: "gif",
                                label: t("chat.composer.sendGif"),
                                hint: t("chat.composer.gifHint"),
                                onSelect: () => openGifPicker("dm"),
                              },
                            ]}
                          />
                        )}
                      </span>
                      <textarea
                        rows={1}
                        spellCheck={chatPrefs.spellcheck}
                        value={dmInput}
                        onChange={(event) => {
                          const value = event.target.value;
                          setDmInput(value);
                          setDmDrafts((current) => ({ ...current, [activeDmUser.id]: value }));
                        }}
                        onKeyDown={(event) => {
                          if (shouldSend(event, chatPrefs)) {
                            event.preventDefault();
                            void sendDirectMessage();
                          }
                        }}
                        placeholder={
                          dmAttachmentBusy
                            ? t("chat.composer.uploading")
                            : t("chat.social.dmPlaceholder", { name: activeDmUser.username })
                        }
                        maxLength={4000}
                      />
                      <span className="dc-composer-popover-anchor" data-composer-popover="true">
                        <button
                          type="button"
                          className="dc-dm-composer-btn gif-pill"
                          title={t("chat.composer.gif")}
                          onClick={() => openGifPicker("dm")}
                        >
                          {t("chat.composer.gif")}
                        </button>
                        {renderGifPicker("dm")}
                      </span>
                      <span className="dc-composer-popover-anchor" data-composer-popover="true">
                        <button
                          type="button"
                          className="dc-dm-composer-btn icon-only"
                          title={t("chat.composer.emoji")}
                          aria-label={t("chat.composer.emoji")}
                          onClick={() => {
                            setShowDmPlusMenu(false);
                            setGifPickerTarget(null);
                            setShowDmEmojiPicker((value) => !value);
                          }}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path
                              fill="currentColor"
                              d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-3.25 7.5a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Zm6.5 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5ZM7.5 13h9a4.5 4.5 0 0 1-9 0Z"
                            />
                          </svg>
                        </button>
                        {renderComposerEmojiPicker("dm")}
                      </span>
                      <VoiceComposer
                        text={dmInput}
                        hasOtherContent={dmAttachmentBusy}
                        disabled={connectionStatus !== "Connected"}
                        onSend={sendDmVoiceNote}
                        onError={reportDmError}
                      />
                      <button
                        type="button"
                        className="dc-dm-send"
                        onClick={sendDirectMessage}
                        disabled={!dmInput.trim()}
                        aria-label={t("common.actions.send")}
                      >
                        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                          <path
                            fill="currentColor"
                            d="m3.4 3.2 17.5 8a.9.9 0 0 1 0 1.6l-17.5 8a.9.9 0 0 1-1.2-1.05L4 13l8-1-8-1-1.8-6.75A.9.9 0 0 1 3.4 3.2Z"
                          />
                        </svg>
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="dc-dm-empty-reference dc-dm-start-panel">
                    <div>
                      <div className="dc-dm-start-icon ds-empty-icon">
                        <Icon name="mail" />
                      </div>
                      <div className="ds-kicker">{t("chat.social.dmLabel")}</div>
                      <h3>{t("chat.social.startTitle")}</h3>
                      <p>{t("chat.social.startBody")}</p>
                      <div className="dc-dm-start-actions">
                        <button type="button" className="ds-btn ds-btn-primary" onClick={openNewConversationComposer}>
                          <Icon name="plus" size="sm" />
                          {t("chat.social.newMessage")}
                        </button>
                        <button
                          type="button"
                          className="ds-btn"
                          onClick={() => {
                            setSocialView("friends");
                            void loadSocialState();
                          }}
                        >
                          <Icon name="user-plus" size="sm" />
                          {t("chat.social.findFriend")}
                        </button>
                      </div>
                      {dmConversations
                        .slice()
                        .sort((a, b) => Date.parse(b.latestTimestamp) - Date.parse(a.latestTimestamp))
                        .slice(0, 3).length > 0 && (
                        <div className="dc-dm-recent-contacts">
                          <small>{t("chat.social.recent")}</small>
                          {dmConversations
                            .slice()
                            .sort((a, b) => Date.parse(b.latestTimestamp) - Date.parse(a.latestTimestamp))
                            .slice(0, 3)
                            .map((conversation) => (
                              <button
                                type="button"
                                key={conversation.user.id}
                                onClick={() => void openDirectMessage(conversation.user)}
                              >
                                <UserAvatar
                                  username={conversation.user.username}
                                  avatarUrl={conversation.user.avatarUrl}
                                />
                                <span>
                                  <strong>{conversation.user.username}</strong>
                                  <small>
                                    {dmPreviewText(conversation.latestMessage) || t("common.home.privateConversation")}
                                  </small>
                                </span>
                                <Icon name="chevron-right" size="sm" />
                              </button>
                            ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </section>
            </div>
          ) : (
            <FriendsView
              currentUser={currentUser}
              friends={friends}
              friendListSearch={friendListSearch}
              setFriendListSearch={setFriendListSearch}
              friendListFilter={friendListFilter}
              setFriendListFilter={setFriendListFilter}
              friendActionsUserId={friendActionsUserId}
              setFriendActionsUserId={setFriendActionsUserId}
              incomingFriendRequests={incomingFriendRequests}
              outgoingFriendRequests={outgoingFriendRequests}
              friendIdInput={friendIdInput}
              setFriendIdInput={setFriendIdInput}
              friendIdNotice={friendIdNotice}
              friendIdBusy={friendIdBusy}
              socialAction={socialAction}
              addFriendByDecaveId={addFriendByDecaveId}
              copyMyDecaveId={copyMyDecaveId}
              askToRemoveFriend={askToRemoveFriend}
              openDirectMessage={openDirectMessage}
              visibleFriends={visibleFriends}
            />
          )}
        </div>
      </div>
    </section>
  );
}
