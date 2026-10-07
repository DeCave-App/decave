// A forum room in a Hub: the forum view with your permissions and its composer.

import type { Dispatch, SetStateAction } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../../components/Icon";
import type { SafetyReportTarget } from "../../safety/types";
import {
  ForumView,
  ForumComposeModal,
  isForumStaff,
  postRestriction,
  roomForumTags,
  type ForumViewer,
} from "../../features/forum";
import type {
  CustomRoleView,
  Channel,
  ComposerTarget,
  Server,
  AccountUser,
  ChatMessage,
  ServerMemberView,
  UiSoundEvent,
} from "../types";
import { HTTP_URL } from "../env";
import { formatTimestamp } from "../locale";
import { safeForumIconUrl } from "../message-payloads";
import { UserAvatar } from "../components/UserAvatar";
import type { ForumRoomUiState } from "../state/forum-room-ui";
import type { HubChatActions } from "../actions/hub-chat";
import type { MessageRendering } from "../actions/message-rendering";

type Props = {
  currentUser: AccountUser;
  hubMembers: ServerMemberView[];
  customRoles: CustomRoleView[];
  setGifPickerTarget: Dispatch<SetStateAction<ComposerTarget | null>>;
  playUiSound: (event: UiSoundEvent, preview?: boolean, quietChecked?: boolean) => void;
  currentServer: Server;
  currentChannel: Channel;
  canPostInCurrentHub: boolean;
  authorizedFetch: (url: string, init?: RequestInit) => Promise<Response>;
  openSafetyReport: (target: SafetyReportTarget) => void;
  forumRoomUi: ForumRoomUiState;
  hubChat: HubChatActions;
  messageRendering: MessageRendering;
};

export function HubForumRoom({
  currentUser,
  hubMembers,
  customRoles,
  setGifPickerTarget,
  playUiSound,
  currentServer,
  currentChannel,
  canPostInCurrentHub,
  authorizedFetch,
  openSafetyReport,
  forumRoomUi,
  hubChat,
  messageRendering,
}: Props) {
  const { renderForumRichText, downloadLegacyAttachment, renderHubMessageBody, roomLink } = messageRendering;
  const {
    publishForumText,
    publishForumPostAwaitingAck,
    openGifPicker,
    renderComposerEmojiPicker,
    renderGifPicker,
    voteOnForumPost,
    sendReaction,
  } = hubChat;
  const {
    activeForumPostId,
    setActiveForumPostId,
    forumPostComposerOpen,
    setForumPostComposerOpen,
    forumReplyInput,
    setForumReplyInput,
    setShowForumEmojiPicker,
  } = forumRoomUi;
  const forumMe = hubMembers.find((member) => member.userId === currentUser?.id);
  const forumViewer: ForumViewer = {
    userId: currentUser?.id ?? "",
    hubRole: currentServer.myRole,
    customRoles: forumMe?.customRoles ?? [],
    canPostInHub: canPostInCurrentHub,
  };
  const forumRoleNames = Object.fromEntries(customRoles.map((role) => [role.id, role.name]));
  const forumRoom = currentChannel as Channel & { forumTags?: unknown };
  return (
    <section className="fx-forum-host">
      <ForumView
        key={currentChannel.id}
        apiBase={HTTP_URL}
        fetcher={authorizedFetch}
        room={forumRoom}
        viewer={forumViewer}
        roleNames={forumRoleNames}
        ownerOnlyPosting={currentServer.ownerOnlyPosting === true}
        activePostId={activeForumPostId}
        onOpenPost={setActiveForumPostId}
        onNewPost={() => setForumPostComposerOpen(true)}
        roomLink={roomLink}
        replyInput={forumReplyInput}
        onReplyInputChange={setForumReplyInput}
        publishReply={(text, postId, attachment) => publishForumText(text, postId, attachment)}
        onSent={() => {
          setShowForumEmojiPicker(false);
          setGifPickerTarget(null);
          playUiSound("send");
        }}
        onVote={(message, direction) => void voteOnForumPost(message as ChatMessage, direction)}
        onPollVote={(message, optionIndex, multi) =>
          void (async () => {
            const pollMessage = message as ChatMessage;
            const viewerId = currentUser?.id;
            if (!viewerId) return;
            const key = `poll_${optionIndex}`;
            if (!multi)
              for (const [other, users] of Object.entries(pollMessage.reactions ?? {}))
                if (other.startsWith("poll_") && other !== key && users.includes(viewerId))
                  await sendReaction(pollMessage, other);
            await sendReaction(pollMessage, key);
          })()
        }
        onReport={(message, post) =>
          openSafetyReport({
            targetType: message.attachment ? "attachment" : "message",
            targetId: message.id,
            subjectUserId: message.userId,
            subjectUsername: message.username,
            contextType: "forum",
            contextId: String(currentChannel.id),
            contextLabel: `#${currentChannel.name}`,
            hubId: currentServer.id,
            roomId: currentChannel.id,
            evidenceType: message.attachment ? "attachment" : "message",
            evidenceText: post
              ? `${post.payload.title}

${post.payload.body}`
              : message.text,
            evidenceLabel: post ? `${message.username}'s forum post` : `${message.username}'s forum reply`,
          })
        }
        onDownload={(attachment) => void downloadLegacyAttachment(attachment)}
        renderReplyBody={(message) => renderHubMessageBody(message as ChatMessage)}
        renderRichText={renderForumRichText}
        renderAvatar={(username, avatarUrl) => <UserAvatar username={username} avatarUrl={avatarUrl} />}
        resolveIconUrl={safeForumIconUrl}
        formatTimestamp={formatTimestamp}
        gifSlot={
          <span className="dc-composer-popover-anchor" data-composer-popover="true">
            <button
              type="button"
              className="fx-icon-btn"
              aria-label="Send a GIF"
              title="GIF"
              onClick={() => openGifPicker("forum")}
            >
              <small>GIF</small>
            </button>
            {renderGifPicker("forum")}
          </span>
        }
        emojiSlot={
          <span className="dc-composer-popover-anchor" data-composer-popover="true">
            <button
              type="button"
              className="fx-icon-btn"
              aria-label="Emoji"
              title="Emoji"
              onClick={() => {
                setGifPickerTarget(null);
                setShowForumEmojiPicker((value) => !value);
              }}
            >
              <Icon name="smile" />
            </button>
            {renderComposerEmojiPicker("forum")}
          </span>
        }
      />
      {forumPostComposerOpen &&
        createPortal(
          <ForumComposeModal
            key={`${currentUser?.id ?? "anonymous"}:${currentChannel.id}`}
            className="dc-forum-compose-host"
            apiBase={HTTP_URL}
            fetcher={authorizedFetch}
            roomId={currentChannel.id}
            roomName={currentChannel.name}
            guidelines={currentChannel.forumGuidelines}
            roomTags={roomForumTags(forumRoom)}
            restriction={postRestriction(forumRoom, forumViewer, forumRoleNames)}
            canLockReplies={isForumStaff(forumViewer)}
            viewerId={currentUser?.id}
            resolveIconUrl={safeForumIconUrl}
            publish={(text, attachment) => publishForumPostAwaitingAck(text, attachment)}
            onPublished={() => {
              setForumPostComposerOpen(false);
              playUiSound("send");
            }}
            onClose={() => setForumPostComposerOpen(false)}
          />,
          document.body,
        )}
    </section>
  );
}
