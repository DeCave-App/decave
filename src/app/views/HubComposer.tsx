// Message composer for Hub rooms: attachments, replies, emoji, GIFs, polls and events.

import { useTranslation } from "react-i18next";
import type { Dispatch, SetStateAction, MutableRefObject } from "react";
import { ComposerPlusMenu } from "../../features/hub-sidebar/ComposerPlusMenu";
import type { Channel, ComposerTarget, Server } from "../types";
import type { ComposerState } from "../state/composer";
import type { HubChatActions } from "../actions/hub-chat";
import { HTTP_URL } from "../env";
import { useChatPrefs } from "../../features/settings/chatPrefs";
import { VoiceComposer } from "../../features/voice-notes/VoiceComposer";
import { BotCommandSuggestions, commandInsertText, useBotCommands } from "../../features/bot-cards";

type Props = {
  setShowEmojiPicker: Dispatch<SetStateAction<boolean>>;
  connectionStatus: string;
  setGifPickerTarget: Dispatch<SetStateAction<ComposerTarget | null>>;
  messageInputRef: MutableRefObject<HTMLTextAreaElement | null>;
  attachmentInputRef: MutableRefObject<HTMLInputElement | null>;
  attachmentRetryFileRef: MutableRefObject<File | null>;
  currentServer: Server;
  currentChannel: Channel;
  canPostInCurrentHub: boolean;
  handleComposerChange: (value: string) => void;
  canCreateEventsIn: (hubId: number) => boolean;
  composer: ComposerState;
  hubChat: HubChatActions;
};

export function HubComposer({
  setShowEmojiPicker,
  connectionStatus,
  setGifPickerTarget,
  messageInputRef,
  attachmentInputRef,
  attachmentRetryFileRef,
  currentServer,
  currentChannel,
  canPostInCurrentHub,
  handleComposerChange,
  canCreateEventsIn,
  composer,
  hubChat,
}: Props) {
  const { t } = useTranslation(["common", "hub", "chat"]);
  const chatPrefs = useChatPrefs();
  const {
    uploadAttachment,
    cancelAttachmentUpload,
    sendMessage,
    openGifPicker,
    renderComposerEmojiPicker,
    renderGifPicker,
    openPollComposer,
    openEventComposer,
    handleMessageKeyDown,
    authorizedFetch,
    sendRoomVoiceNote,
  } = hubChat;
  const {
    messageInput,
    pendingAttachment,
    setPendingAttachment,
    attachmentBusy,
    attachmentError,
    setAttachmentError,
    showComposerPlusMenu,
    setShowComposerPlusMenu,
  } = composer;
  const botCommands = useBotCommands(currentServer.id, messageInput, HTTP_URL, authorizedFetch);
  const chooseCommand = (command: Parameters<typeof commandInsertText>[0]) => {
    handleComposerChange(commandInsertText(command));
    messageInputRef.current?.focus();
  };
  return (
    <div className="composer-shell">
      <BotCommandSuggestions
        suggestions={botCommands.suggestions}
        activeIndex={botCommands.activeIndex}
        onHover={botCommands.setActive}
        onChoose={chooseCommand}
      />
      {(pendingAttachment || attachmentBusy || attachmentError) && (
        <div className="attachment-composer-state">
          {attachmentBusy ? (
            <>
              <span>{t("chat.composer.uploading")}</span>
              <button type="button" onClick={cancelAttachmentUpload}>
                {t("common.actions.cancel")}
              </button>
            </>
          ) : pendingAttachment ? (
            <>
              <span>
                📎 <strong>{pendingAttachment.name}</strong> ·{" "}
                {t("chat.composer.sizeMb", { size: (pendingAttachment.size / 1024 / 1024).toFixed(2) })}
              </span>
              <button type="button" onClick={() => setPendingAttachment(null)}>
                {t("common.actions.remove")}
              </button>
            </>
          ) : (
            <>
              <span className="attachment-error">{attachmentError}</span>
              {attachmentRetryFileRef.current && (
                <button type="button" onClick={() => void uploadAttachment(attachmentRetryFileRef.current!)}>
                  {t("chat.composer.retryUpload")}
                </button>
              )}
            </>
          )}
        </div>
      )}
      <div className="dc-dm-reference-composer dc-hub-composer">
        <input
          ref={attachmentInputRef}
          type="file"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.currentTarget.value = "";
            if (file) void uploadAttachment(file);
          }}
        />
        <span className="dc-composer-plus-anchor" data-composer-popover="true">
          <button
            type="button"
            className="dc-dm-composer-btn icon-only"
            onClick={() => {
              setShowEmojiPicker(false);
              setGifPickerTarget(null);
              setShowComposerPlusMenu((value) => !value);
            }}
            disabled={!canPostInCurrentHub || attachmentBusy || connectionStatus !== "Connected"}
            title={t("chat.composer.addToMessage")}
            aria-label={t("chat.composer.addToMessage")}
          >
            <svg className="dc-composer-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="currentColor"
                d="M11 5a1 1 0 0 1 2 0v6h6a1 1 0 1 1 0 2h-6v6a1 1 0 1 1-2 0v-6H5a1 1 0 1 1 0-2h6V5Z"
              />
            </svg>
          </button>
          {showComposerPlusMenu && (
            <ComposerPlusMenu
              onClose={() => setShowComposerPlusMenu(false)}
              actions={[
                {
                  id: "upload",
                  icon: "paperclip",
                  label: t("chat.roomHero.uploadFile"),
                  hint: t("chat.composer.uploadHint"),
                  onSelect: () => attachmentInputRef.current?.click(),
                },
                {
                  id: "poll",
                  icon: "poll",
                  label: t("chat.roomHero.createPoll"),
                  hint: t("chat.composer.pollHint"),
                  onSelect: () => openPollComposer("hub"),
                },
                {
                  id: "gif",
                  icon: "gif",
                  label: t("chat.composer.sendGif"),
                  hint: t("chat.composer.gifHint"),
                  onSelect: () => openGifPicker("hub"),
                },
                ...(canCreateEventsIn(currentServer.id)
                  ? [
                      {
                        id: "event",
                        icon: "calendar" as const,
                        label: t("chat.roomHero.scheduleEvent"),
                        hint: t("chat.composer.eventHint"),
                        onSelect: openEventComposer,
                      },
                    ]
                  : []),
              ]}
            />
          )}
        </span>
        <textarea
          ref={messageInputRef}
          spellCheck={chatPrefs.spellcheck}
          rows={1}
          placeholder={
            canPostInCurrentHub
              ? t("chat.composer.placeholder", { room: currentChannel.name })
              : currentChannel.canPost === false
                ? t("chat.composer.readOnly", { room: currentChannel.name })
                : t("chat.composer.ownerOnly")
          }
          value={messageInput}
          onChange={(event) => handleComposerChange(event.target.value)}
          onKeyDown={(event) => {
            if (!botCommands.onKeyDown(event, chooseCommand)) handleMessageKeyDown(event);
          }}
          disabled={!canPostInCurrentHub || connectionStatus !== "Connected"}
        />
        <span className="dc-composer-popover-anchor" data-composer-popover="true">
          <button
            type="button"
            className="dc-dm-composer-btn gif-pill"
            title={t("chat.composer.gif")}
            onClick={() => openGifPicker("hub")}
            disabled={!canPostInCurrentHub}
          >
            {t("chat.composer.gif")}
          </button>
          {renderGifPicker("hub")}
        </span>
        <span className="dc-composer-popover-anchor" data-composer-popover="true">
          <button
            type="button"
            className="dc-dm-composer-btn icon-only"
            onClick={() => {
              setShowComposerPlusMenu(false);
              setGifPickerTarget(null);
              setShowEmojiPicker((current) => !current);
            }}
            title={t("chat.composer.emoji")}
            aria-label={t("chat.composer.emoji")}
            disabled={!canPostInCurrentHub}
          >
            <svg className="dc-composer-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="currentColor"
                d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-3.25 7.5a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Zm6.5 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5ZM7.5 13h9a4.5 4.5 0 0 1-9 0Z"
              />
            </svg>
          </button>
          {renderComposerEmojiPicker("hub")}
        </span>
        <VoiceComposer
          text={messageInput}
          hasOtherContent={Boolean(pendingAttachment) || attachmentBusy}
          disabled={!canPostInCurrentHub || connectionStatus !== "Connected"}
          onSend={sendRoomVoiceNote}
          onError={setAttachmentError}
        />
        <button
          type="button"
          className="dc-dm-send"
          onClick={sendMessage}
          disabled={
            !canPostInCurrentHub ||
            (!messageInput.trim() && !pendingAttachment) ||
            attachmentBusy ||
            connectionStatus !== "Connected"
          }
          title={t("chat.composer.send")}
        >
          <svg className="dc-composer-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="currentColor"
              d="m3.4 3.2 17.5 8a.9.9 0 0 1 0 1.6l-17.5 8a.9.9 0 0 1-1.2-1.05L4 13l8-1-8-1-1.8-6.75A.9.9 0 0 1 3.4 3.2Z"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
