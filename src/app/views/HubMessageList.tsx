// Message list of a Hub text room.

import type { MouseEvent as ReactMouseEvent, Dispatch, SetStateAction, MutableRefObject } from "react";
import { Icon } from "../../components/Icon";
import type { SafetyReportTarget } from "../../safety/types";
import { removeItem, type OutboxItem } from "../../features/outbox/outbox";
import { InlineImage, canShowInline } from "../../features/media/InlineImage";
import type {
  Channel,
  Server,
  AccountUser,
  AttachmentMeta,
  ChatMessage,
  ServerMemberView,
  UserContextTarget,
} from "../types";
import { HTTP_URL } from "../env";
import { formatTimestamp } from "../locale";
import { memberRoleIcons } from "../user-display";
import { UserAvatar } from "../components/UserAvatar";
import type { ComposerState } from "../state/composer";
import type { HubChatActions } from "../actions/hub-chat";
import type { MessageRendering } from "../actions/message-rendering";

type Props = {
  currentUser: AccountUser;
  setChatAtBottom: Dispatch<SetStateAction<boolean>>;
  selectedChannel: number;
  messages: ChatMessage[];
  hubMembers: ServerMemberView[];
  outbox: OutboxItem<AttachmentMeta>[];
  setOutbox: Dispatch<SetStateAction<OutboxItem<AttachmentMeta>[]>>;
  messagesEndRef: MutableRefObject<HTMLDivElement | null>;
  messageListRef: MutableRefObject<HTMLDivElement | null>;
  currentServer: Server;
  currentChannel: Channel;
  authorizedFetch: (url: string, init?: RequestInit) => Promise<Response>;
  openSafetyReport: (target: SafetyReportTarget) => void;
  openUserContextMenu: (event: ReactMouseEvent, target: UserContextTarget) => void;
  composer: ComposerState;
  hubChat: HubChatActions;
  messageRendering: MessageRendering;
};

export function HubMessageList({
  currentUser,
  setChatAtBottom,
  selectedChannel,
  messages,
  hubMembers,
  outbox,
  setOutbox,
  messagesEndRef,
  messageListRef,
  currentServer,
  currentChannel,
  authorizedFetch,
  openSafetyReport,
  openUserContextMenu,
  composer,
  hubChat,
  messageRendering,
}: Props) {
  const { downloadLegacyAttachment, renderHubMessageBody, replyPreviewText, scrollToMessage } = messageRendering;
  const {
    uploadAttachment,
    sendOutboxItem,
    toggleMessageReactionPicker,
    renderMessageReactionPicker,
    canDeleteMessage,
    sendReaction,
    togglePinMessage,
    startEditMessage,
    deleteMessage,
  } = hubChat;
  const { setReplyingTo, setEditingMessage, setMessageInput, setPendingAttachment } = composer;
  return (
    <div
      className="message-list"
      ref={messageListRef}
      style={{ marginLeft: 0, marginRight: "auto" }}
      onScroll={(event) => {
        const element = event.currentTarget;
        setChatAtBottom(element.scrollHeight - element.scrollTop - element.clientHeight < 90);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(event) => {
        event.preventDefault();
        const file = event.dataTransfer.files?.[0];
        if (file) void uploadAttachment(file);
      }}
    >
      {messages.map((item) => (
        <div className="chat-message" key={item.id} data-message-id={item.id}>
          <div
            className="message-avatar-context user-context-target"
            onContextMenu={(event) => {
              if (!item.userId) return;
              openUserContextMenu(event, {
                userId: item.userId,
                username: item.username,
                avatarUrl: item.avatarUrl,
                role: item.role,
              });
            }}
            title={`Right-click ${item.username}`}
          >
            <UserAvatar className="message-avatar" username={item.username} avatarUrl={item.avatarUrl} />
          </div>
          <div className="chat-message-content">
            <div className="chat-message-header">
              <strong
                className={item.userId ? "user-context-target" : undefined}
                onContextMenu={(event) => {
                  if (!item.userId) return;
                  openUserContextMenu(event, {
                    userId: item.userId,
                    username: item.username,
                    avatarUrl: item.avatarUrl,
                    role: item.role,
                  });
                }}
              >
                {hubMembers.find((member) => member.userId === item.userId) ? (
                  <span className="dc-member-role-icons">
                    {memberRoleIcons(hubMembers.find((member) => member.userId === item.userId)!)}
                  </span>
                ) : null}{" "}
                {item.username}
              </strong>
              <span>{formatTimestamp(item.timestamp)}</span>
            </div>
            {item.replyToId &&
              (() => {
                const replyTarget = messages.find((candidate) => candidate.id === item.replyToId);
                return (
                  <button type="button" className="chat-reply-ref" onClick={() => scrollToMessage(item.replyToId!)}>
                    ↳ Reply to{" "}
                    {replyTarget ? `${replyTarget.username}: ${replyPreviewText(replyTarget.text)}` : "message"}
                  </button>
                );
              })()}
            {item.text && <div className="chat-message-text">{renderHubMessageBody(item)}</div>}

            {item.attachment && canShowInline(item.attachment) && (
              <InlineImage
                attachment={item.attachment}
                baseUrl={HTTP_URL}
                authorizedFetch={authorizedFetch}
                onDownload={() => void downloadLegacyAttachment(item.attachment!)}
              />
            )}
            {item.attachment &&
              !canShowInline(item.attachment) &&
              (item.attachment.mimeType.startsWith("image/") || item.attachment.mimeType.startsWith("video/")) && (
                <button
                  type="button"
                  className="chat-media-preview"
                  onClick={() => void downloadLegacyAttachment(item.attachment!)}
                >
                  <span>
                    {item.attachment.mimeType.startsWith("image/") ? "Image" : "Video"} · {item.attachment.name}
                  </span>
                  <small>Tap to download</small>
                </button>
              )}
            {item.attachment &&
              !item.attachment.mimeType.startsWith("image/") &&
              !item.attachment.mimeType.startsWith("video/") && (
                <button
                  type="button"
                  className="chat-attachment-card"
                  onClick={() => void downloadLegacyAttachment(item.attachment!)}
                >
                  <span className="chat-attachment-icon">↥</span>
                  <span>
                    <strong>{item.attachment.name}</strong>
                    <small>
                      {(item.attachment.size / 1024 / 1024).toFixed(item.attachment.size > 1024 * 1024 ? 1 : 2)} MB ·{" "}
                      {item.attachment.mimeType || "File"}
                    </small>
                  </span>
                  <b>Download</b>
                </button>
              )}
            <div className="chat-message-reactions">
              {Object.entries(item.reactions ?? {}).map(
                ([emoji, users]) =>
                  users.length > 0 &&
                  !emoji.startsWith("poll_") && (
                    <button
                      key={emoji}
                      type="button"
                      className="chat-reaction-pill"
                      style={{ pointerEvents: undefined }}
                      onClick={() => void sendReaction(item, emoji)}
                    >
                      {emoji} {users.length}
                    </button>
                  ),
              )}
              {item.pinned && <span className="chat-pinned">PINNED</span>}
            </div>

            <div className="chat-message-hover-actions" style={{ display: undefined }}>
              <div className="message-reaction-picker-anchor">
                <button
                  type="button"
                  title="Add reaction"
                  className="reaction-action-button"
                  onClick={(event) => toggleMessageReactionPicker(item.id, event)}
                >
                  <Icon name="smile" />
                </button>

                {renderMessageReactionPicker(item.id, (emoji) => void sendReaction(item, emoji))}
              </div>

              <button
                type="button"
                title="Reply"
                aria-label="Reply"
                onClick={() => {
                  setEditingMessage(null);
                  setReplyingTo(item);
                }}
              >
                <Icon name="message" />
              </button>

              {item.userId && item.userId !== currentUser.id && (
                <button
                  type="button"
                  onClick={() =>
                    openSafetyReport({
                      targetType: item.attachment ? "attachment" : "message",
                      targetId: item.id,
                      subjectUserId: item.userId,
                      subjectUsername: item.username,
                      contextType: "channel",
                      contextId: String(item.channelId || currentChannel.id),
                      contextLabel: `#${currentChannel.name}`,
                      hubId: currentServer.id,
                      roomId: currentChannel.id,
                      evidenceType: item.attachment ? "attachment" : "message",
                      evidenceText: item.text || item.attachment?.name || "",
                      evidenceLabel: `${item.username}'s message`,
                    })
                  }
                  title="Report"
                  aria-label="Report message"
                >
                  <Icon name="flag" />
                </button>
              )}

              {item.userId === currentUser.id && (
                <button type="button" title="Edit" aria-label="Edit message" onClick={() => startEditMessage(item)}>
                  <Icon name="edit" />
                </button>
              )}

              {(currentServer.myRole === "owner" || currentServer.myRole === "admin") && (
                <button
                  type="button"
                  title={item.pinned ? "Unpin" : "Pin"}
                  aria-label={item.pinned ? "Unpin message" : "Pin message"}
                  aria-pressed={item.pinned}
                  onClick={() => void togglePinMessage(item)}
                >
                  <Icon name="pin" />
                </button>
              )}

              {canDeleteMessage(item) && (
                <button
                  type="button"
                  onClick={() => void deleteMessage(item)}
                  title={item.userId === currentUser.id ? "Delete your message" : "Delete message as moderator"}
                  aria-label="Delete message"
                  className="danger"
                >
                  <Icon name="trash" />
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
      {outbox
        .filter((item) => item.channelId === selectedChannel)
        .map((item) => (
          <div key={item.localId} className={`chat-message dc-outbox-row is-${item.status}`} aria-live="polite">
            <UserAvatar
              className="message-avatar"
              username={currentUser?.username ?? "You"}
              avatarUrl={currentUser?.avatarUrl}
            />
            <div className="chat-message-content">
              <div className="chat-message-header">
                <strong>{currentUser?.username ?? "You"}</strong>
                <span className="dc-outbox-state">
                  {item.status === "sending"
                    ? "Sending…"
                    : item.status === "queued"
                      ? "Waiting for connection…"
                      : "Couldn't send"}
                </span>
              </div>
              {item.text && <div className="chat-message-text">{item.text}</div>}
              {item.attachment && (
                <div className="chat-media-preview">
                  <span>{item.attachment.name}</span>
                </div>
              )}
              {item.status === "failed" && (
                <div className="dc-outbox-actions">
                  {item.error && <small>{item.error}</small>}
                  <button type="button" className="ds-btn ds-btn-sm" onClick={() => sendOutboxItem(item)}>
                    Retry
                  </button>
                  <button
                    type="button"
                    className="ds-btn ds-btn-sm ds-btn-ghost"
                    onClick={() => {
                      setMessageInput(item.text);
                      setPendingAttachment(item.attachment);
                      setOutbox((current) => removeItem(current, item.localId));
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="ds-btn ds-btn-sm ds-btn-ghost"
                    onClick={() => setOutbox((current) => removeItem(current, item.localId))}
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      <div ref={messagesEndRef} />
    </div>
  );
}
