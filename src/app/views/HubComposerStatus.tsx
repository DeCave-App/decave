// Hub chat status around the reply/edit bar and message composer.

import { useTranslation } from "react-i18next";
import type { Dispatch, SetStateAction, MutableRefObject } from "react";
import { Icon } from "../../components/Icon";
import type { Channel, ComposerTarget, Server } from "../types";
import { HubComposer } from "./HubComposer";
import type { ComposerState } from "../state/composer";
import type { HubChatActions } from "../actions/hub-chat";

type Props = {
  typingUsers: Record<string, number>;
  chatAtBottom: boolean;
  composer: ComposerState;
  setShowEmojiPicker: Dispatch<SetStateAction<boolean>>;
  connectionStatus: string;
  setGifPickerTarget: Dispatch<SetStateAction<ComposerTarget | null>>;
  messagesEndRef: MutableRefObject<HTMLDivElement | null>;
  messageInputRef: MutableRefObject<HTMLTextAreaElement | null>;
  attachmentInputRef: MutableRefObject<HTMLInputElement | null>;
  attachmentRetryFileRef: MutableRefObject<File | null>;
  currentServer: Server;
  currentChannel: Channel;
  canPostInCurrentHub: boolean;
  handleComposerChange: (value: string) => void;
  hubChat: HubChatActions;
  canCreateEventsIn: (hubId: number) => boolean;
};

export function HubComposerStatus({
  typingUsers,
  chatAtBottom,
  composer,
  setShowEmojiPicker,
  connectionStatus,
  setGifPickerTarget,
  messagesEndRef,
  messageInputRef,
  attachmentInputRef,
  attachmentRetryFileRef,
  currentServer,
  currentChannel,
  canPostInCurrentHub,
  handleComposerChange,
  hubChat,
  canCreateEventsIn,
}: Props) {
  const { t } = useTranslation(["common", "hub", "chat"]);
  return (
    <>
      {(composer.replyingTo || composer.editingMessage) && (
        <div className="composer-context">
          <span>
            {composer.editingMessage
              ? t("chat.composer.editing")
              : t("chat.composer.replyingTo", { name: composer.replyingTo?.username })}
          </span>
          <button
            type="button"
            onClick={() => {
              composer.setReplyingTo(null);
              composer.setEditingMessage(null);
              if (composer.editingMessage) composer.setMessageInput("");
            }}
          >
            <Icon name="close" size="sm" />
          </button>
        </div>
      )}
      <div className="chat-live-status-row">
        <span>
          {Object.values(typingUsers).some((until) => until > Date.now())
            ? t("chat.composer.typing", {
                names: Object.entries(typingUsers)
                  .filter(([, until]) => until > Date.now())
                  .slice(0, 3)
                  .map(([key]) => key.split(":").slice(1).join(":"))
                  .join(", "),
              })
            : ""}
        </span>
        {!chatAtBottom && (
          <button type="button" onClick={() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })}>
            {t("chat.composer.jumpToLatest")}
          </button>
        )}
      </div>
      {canPostInCurrentHub && (
        <HubComposer
          setShowEmojiPicker={setShowEmojiPicker}
          connectionStatus={connectionStatus}
          setGifPickerTarget={setGifPickerTarget}
          messageInputRef={messageInputRef}
          attachmentInputRef={attachmentInputRef}
          attachmentRetryFileRef={attachmentRetryFileRef}
          currentServer={currentServer}
          currentChannel={currentChannel}
          canPostInCurrentHub={canPostInCurrentHub}
          handleComposerChange={handleComposerChange}
          canCreateEventsIn={canCreateEventsIn}
          composer={composer}
          hubChat={hubChat}
        />
      )}
    </>
  );
}
