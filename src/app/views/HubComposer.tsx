// Message composer for Hub rooms: attachments, replies, emoji, GIFs, polls and events.

import type { Dispatch, SetStateAction, MutableRefObject } from "react";
import { ComposerPlusMenu } from "../../features/hub-sidebar/ComposerPlusMenu";
import type { Channel, ComposerTarget, Server } from "../types";
import type { ComposerState } from "../state/composer";
import type { HubChatActions } from "../actions/hub-chat";

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
  } = hubChat;
  const {
    messageInput,
    pendingAttachment,
    setPendingAttachment,
    attachmentBusy,
    attachmentError,
    showComposerPlusMenu,
    setShowComposerPlusMenu,
  } = composer;
  return (
    <div className="composer-shell">
      {(pendingAttachment || attachmentBusy || attachmentError) && (
        <div className="attachment-composer-state">
          {attachmentBusy ? (
            <>
              <span>Uploading attachment…</span>
              <button type="button" onClick={cancelAttachmentUpload}>
                Cancel
              </button>
            </>
          ) : pendingAttachment ? (
            <>
              <span>
                📎 <strong>{pendingAttachment.name}</strong> · {(pendingAttachment.size / 1024 / 1024).toFixed(2)} MB
              </span>
              <button type="button" onClick={() => setPendingAttachment(null)}>
                Remove
              </button>
            </>
          ) : (
            <>
              <span className="attachment-error">{attachmentError}</span>
              {attachmentRetryFileRef.current && (
                <button type="button" onClick={() => void uploadAttachment(attachmentRetryFileRef.current!)}>
                  Retry upload
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
            title="Add to message"
            aria-label="Add to message"
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
                  label: "Upload a file",
                  hint: "Images, video or documents",
                  onSelect: () => attachmentInputRef.current?.click(),
                },
                {
                  id: "poll",
                  icon: "poll",
                  label: "Create poll",
                  hint: "Ask the room to vote",
                  onSelect: () => openPollComposer("hub"),
                },
                {
                  id: "gif",
                  icon: "gif",
                  label: "Send a GIF",
                  hint: "Search the GIF library",
                  onSelect: () => openGifPicker("hub"),
                },
                ...(canCreateEventsIn(currentServer.id)
                  ? [
                      {
                        id: "event",
                        icon: "calendar" as const,
                        label: "Schedule event",
                        hint: "Add it to the Hub calendar",
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
          rows={1}
          placeholder={
            canPostInCurrentHub ? `Message #${currentChannel.name}` : "Only the Hub owner can post in this Hub"
          }
          value={messageInput}
          onChange={(event) => handleComposerChange(event.target.value)}
          onKeyDown={handleMessageKeyDown}
          disabled={!canPostInCurrentHub || connectionStatus !== "Connected"}
        />
        <span className="dc-composer-popover-anchor" data-composer-popover="true">
          <button
            type="button"
            className="dc-dm-composer-btn gif-pill"
            title="GIF"
            onClick={() => openGifPicker("hub")}
            disabled={!canPostInCurrentHub}
          >
            GIF
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
            title="Emoji"
            aria-label="Emoji"
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
          title="Send message"
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
