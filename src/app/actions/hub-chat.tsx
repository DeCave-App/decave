// Hub room chat: attachments, sending (with the outbox), forum posts, GIF and emoji
// pickers, polls and events, reactions, pins, edits, message search and deletion.

import type {
  MutableRefObject,
  Dispatch,
  SetStateAction,
  CSSProperties,
  KeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { setStatus, type OutboxItem } from "../../features/outbox/outbox";
import { createVoiceNoteSender } from "../../features/voice-notes/send";
import type { VoiceNoteDraft } from "../../features/voice-notes/useVoiceRecorder";
import {
  apiEventToItem,
  type CalendarItem,
  type EventComposerSeed,
  type HubEvent as ApiHubEvent,
  type HubEventsStore,
} from "../../features/events";
import type {
  Channel,
  HubAsset,
  PollPayload,
  EventInviteMode,
  EventPayload,
  ComposerTarget,
  GiphyGif,
  GifPayload,
  Server,
  AccountUser,
  AttachmentMeta,
  ChatMessage,
  ServerMemberView,
  SocialUser,
  DirectMessage,
  GroupChatMessage,
  GroupChat,
  ApiError,
  UiSoundEvent,
} from "../types";
import { HTTP_URL } from "../env";
import { discardDmSend, discardGroupSend, dmSocketFrame, groupSocketFrame } from "../../e2ee/dm-e2ee-client";
import { messageBotFields } from "../../../shared/bots/card-view";
import { EMOJI_GROUPS } from "../constants";
import {
  POLL_PREFIX,
  EVENT_PREFIX,
  STICKER_PREFIX,
  GIF_PREFIX,
  giphyMediaProxyUrl,
  safeGiphyUrl,
} from "../message-payloads";
import { i18next } from "../../i18n/index.ts";
import { apiErrorMessage, type ErrorCode } from "../../i18n/apiError.ts";
import type { GifSearchState } from "../state/gif-search";
import type { HubPanelsState } from "../state/hub-panels";
import type { ComposerState } from "../state/composer";
import type { ForumRoomUiState } from "../state/forum-room-ui";
import { getChatPrefs, shouldSend } from "../../features/settings/chatPrefs";

/** The picker heading for one of the EMOJI_GROUPS. */
function emojiGroupLabel(name: string): string {
  switch (name) {
    case "Smileys":
      return i18next.t("chat.actions.emoji.groups.smileys");
    case "Hands":
      return i18next.t("chat.actions.emoji.groups.hands");
    case "Gaming":
      return i18next.t("chat.actions.emoji.groups.gaming");
    case "Hearts":
      return i18next.t("chat.actions.emoji.groups.hearts");
    case "Objects":
      return i18next.t("chat.actions.emoji.groups.objects");
    case "Nature":
      return i18next.t("chat.actions.emoji.groups.nature");
    default:
      return name;
  }
}

export type HubChatActionsDeps = {
  currentUser: AccountUser | null;
  messagesRef: MutableRefObject<ChatMessage[]>;
  messageSearchQuery: string;
  setMessageSearchResults: Dispatch<SetStateAction<ChatMessage[]>>;
  servers: Server[];
  selectedChannel: number;
  setMessageDrafts: Dispatch<SetStateAction<Record<number, string>>>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  hubMembers: ServerMemberView[];
  setShowEmojiPicker: Dispatch<SetStateAction<boolean>>;
  showEmojiPicker: boolean;
  reactionPickerMessageId: string | null;
  setReactionPickerMessageId: Dispatch<SetStateAction<string | null>>;
  setReactionPickerPosition: Dispatch<
    SetStateAction<{ top: number; left: number; width: number; maxHeight: number } | null>
  >;
  reactionPickerPosition: { top: number; left: number; width: number; maxHeight: number } | null;
  setOutbox: Dispatch<SetStateAction<OutboxItem<AttachmentMeta>[]>>;
  hubAssets: HubAsset[];
  setGroupInput: Dispatch<SetStateAction<string>>;
  groupReplyingTo: GroupChatMessage | null;
  setGroupReplyingTo: Dispatch<SetStateAction<GroupChatMessage | null>>;
  setDmInput: Dispatch<SetStateAction<string>>;
  dmReplyingTo: DirectMessage | null;
  setDmReplyingTo: Dispatch<SetStateAction<DirectMessage | null>>;
  setShowPollComposer: Dispatch<SetStateAction<"hub" | "dm" | null>>;
  showPollComposer: "hub" | "dm" | null;
  setShowDmPlusMenu: Dispatch<SetStateAction<boolean>>;
  setShowDmEmojiPicker: Dispatch<SetStateAction<boolean>>;
  showDmEmojiPicker: boolean;
  setShowGroupEmojiPicker: Dispatch<SetStateAction<boolean>>;
  showGroupEmojiPicker: boolean;
  gifPickerTarget: ComposerTarget | null;
  setGifPickerTarget: Dispatch<SetStateAction<ComposerTarget | null>>;
  setShowEventComposer: Dispatch<SetStateAction<boolean>>;
  eventInviteMode: EventInviteMode;
  setEventInviteMode: Dispatch<SetStateAction<EventInviteMode>>;
  eventInviteMemberIds: string[];
  setEventInviteMemberIds: Dispatch<SetStateAction<string[]>>;
  setPollQuestion: Dispatch<SetStateAction<string>>;
  pollQuestion: string;
  setPollOptions: Dispatch<SetStateAction<string[]>>;
  pollOptions: string[];
  activeChannelRef: MutableRefObject<number>;
  pendingForumPublishRef: MutableRefObject<{
    channelId: number;
    text: string;
    settle: (error: Error | null) => void;
  } | null>;
  messageInputRef: MutableRefObject<HTMLTextAreaElement | null>;
  attachmentInputRef: MutableRefObject<HTMLInputElement | null>;
  attachmentAbortRef: MutableRefObject<AbortController | null>;
  attachmentRetryFileRef: MutableRefObject<File | null>;
  activeDmUserRef: MutableRefObject<SocialUser | null>;
  activeGroupChatRef: MutableRefObject<GroupChat | null>;
  recordSessionMessageActions: (text: string) => void;
  playUiSound: (event: UiSoundEvent, preview?: boolean, quietChecked?: boolean) => void;
  currentServer: Server;
  currentChannel: Channel;
  canPostInCurrentHub: boolean;
  authorizedFetch: (url: string, init?: RequestInit) => Promise<Response>;
  hubEvents: HubEventsStore;
  setEventDrawerItem: Dispatch<SetStateAction<CalendarItem | null>>;
  setEventComposerSeed: Dispatch<SetStateAction<EventComposerSeed>>;
  setEventComposerHubId: Dispatch<SetStateAction<number>>;
  sendSocket: (payload: unknown) => boolean;
  sendDmReaction: (message: DirectMessage, emoji: string) => Promise<void>;
  changeChannel: (channelId: number) => void;
  loadHubMembers: (serverId: number) => Promise<void>;
  loadCustomRoles: (serverId?: number) => Promise<void>;
  gifSearch: GifSearchState;
  hubPanels: HubPanelsState;
  composer: ComposerState;
  forumRoomUi: ForumRoomUiState;
};

/** Called once per render with that render's values. */
export function createHubChatActions(deps: HubChatActionsDeps) {
  const {
    currentUser,
    messagesRef,
    messageSearchQuery,
    setMessageSearchResults,
    servers,
    selectedChannel,
    setMessageDrafts,
    setMessages,
    hubMembers,
    setShowEmojiPicker,
    showEmojiPicker,
    reactionPickerMessageId,
    setReactionPickerMessageId,
    setReactionPickerPosition,
    reactionPickerPosition,
    setOutbox,
    hubAssets,
    setGroupInput,
    groupReplyingTo,
    setGroupReplyingTo,
    setDmInput,
    dmReplyingTo,
    setDmReplyingTo,
    setShowPollComposer,
    showPollComposer,
    setShowDmPlusMenu,
    setShowDmEmojiPicker,
    showDmEmojiPicker,
    setShowGroupEmojiPicker,
    showGroupEmojiPicker,
    gifPickerTarget,
    setGifPickerTarget,
    setShowEventComposer,
    eventInviteMode,
    setEventInviteMode,
    eventInviteMemberIds,
    setEventInviteMemberIds,
    setPollQuestion,
    pollQuestion,
    setPollOptions,
    pollOptions,
    activeChannelRef,
    pendingForumPublishRef,
    messageInputRef,
    attachmentInputRef,
    attachmentAbortRef,
    attachmentRetryFileRef,
    activeDmUserRef,
    activeGroupChatRef,
    recordSessionMessageActions,
    playUiSound,
    currentServer,
    currentChannel,
    canPostInCurrentHub,
    authorizedFetch,
    hubEvents,
    setEventDrawerItem,
    setEventComposerSeed,
    setEventComposerHubId,
    sendSocket,
    sendDmReaction,
    changeChannel,
    loadHubMembers,
    loadCustomRoles,
    gifSearch,
    hubPanels,
    composer,
    forumRoomUi,
  } = deps;
  const { activeForumPostId, setForumReplyInput, setShowForumEmojiPicker, showForumEmojiPicker } = forumRoomUi;
  const {
    replyingTo,
    setReplyingTo,
    editingMessage,
    setEditingMessage,
    messageInput,
    setMessageInput,
    setPendingAttachment,
    pendingAttachment,
    setAttachmentBusy,
    setAttachmentError,
    setShowComposerPlusMenu,
  } = composer;
  const { setShowHubHome, setShowStreamerOverview, setShowHubCalendarPanel } = hubPanels;
  const { setGifQuery, gifQuery, setGifResults, gifResults, setGifLoading, gifLoading, setGifError, gifError } =
    gifSearch;

  const uploadAttachment = async (file: File) => {
    if (!file || currentChannel.type !== "text") return;
    attachmentRetryFileRef.current = file;
    if (file.size > 25 * 1024 * 1024) {
      setAttachmentError(i18next.t("chat.actions.message.attachmentTooLarge"));
      return;
    }

    attachmentAbortRef.current?.abort();
    const controller = new AbortController();
    attachmentAbortRef.current = controller;
    setAttachmentBusy(true);
    setAttachmentError("");
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/channels/${currentChannel.id}/attachments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-File-Name": encodeURIComponent(file.name),
          "X-File-Type": file.type || "application/octet-stream",
        },
        signal: controller.signal,
        body: file,
      });
      const data = (await response.json()) as { attachment?: AttachmentMeta; error?: string };
      if (!response.ok || !data.attachment) {
        setAttachmentError(apiErrorMessage(data, "client.message.uploadAttachment"));
        return;
      }
      setPendingAttachment(data.attachment);
      attachmentRetryFileRef.current = null;
    } catch (error) {
      setAttachmentError(
        error instanceof DOMException && error.name === "AbortError"
          ? i18next.t("chat.actions.message.uploadCanceled")
          : error instanceof Error
            ? error.message
            : i18next.t("errors.client.message.uploadAttachment"),
      );
    } finally {
      setAttachmentBusy(false);
      if (attachmentAbortRef.current === controller) attachmentAbortRef.current = null;
      if (attachmentInputRef.current) attachmentInputRef.current.value = "";
    }
  };

  const cancelAttachmentUpload = () => {
    attachmentAbortRef.current?.abort();
    attachmentAbortRef.current = null;
    setAttachmentBusy(false);
    setAttachmentError(i18next.t("chat.actions.message.uploadCanceledRetry"));
  };

  const publishForumText = async (
    text: string,
    replyToMessageId: string | null = null,
    attachment: AttachmentMeta | null = null,
  ): Promise<boolean> => {
    if (!canPostInCurrentHub) throw new Error(i18next.t("chat.actions.message.ownerOnly"));
    return sendSocket({
      type: "CHAT_MESSAGE",
      text,
      channelId: selectedChannel,
      replyToId: replyToMessageId,
      attachment,
    });
  };

  /** Sends a new forum post and resolves only once the server echoes it back.
      Rejects with the server's ERROR message (slow mode, permissions) or on timeout. */
  const publishForumPostAwaitingAck = (text: string, attachment: AttachmentMeta | null): Promise<boolean> => {
    if (!canPostInCurrentHub) return Promise.reject(new Error(i18next.t("chat.actions.message.ownerOnly")));
    if (pendingForumPublishRef.current)
      return Promise.reject(new Error(i18next.t("chat.actions.message.previousPostPending")));
    const channelId = selectedChannel;
    return new Promise<boolean>((resolve, reject) => {
      const timer = window.setTimeout(
        () => pending.settle(new Error(i18next.t("chat.actions.message.postUnconfirmed"))),
        12_000,
      );
      const pending = {
        channelId,
        text,
        settle: (error: Error | null) => {
          if (pendingForumPublishRef.current !== pending) return;
          pendingForumPublishRef.current = null;
          window.clearTimeout(timer);
          if (error) reject(error);
          else resolve(true);
        },
      };
      pendingForumPublishRef.current = pending;
      if (!sendSocket({ type: "CHAT_MESSAGE", text, channelId, replyToId: null, attachment })) {
        pendingForumPublishRef.current = null;
        window.clearTimeout(timer);
        resolve(false);
      }
    });
  };

  const sendOutboxItem = (item: OutboxItem<AttachmentMeta>) => {
    const sent = sendSocket({
      type: "CHAT_MESSAGE",
      text: item.text,
      channelId: item.channelId,
      replyToId: item.replyToId,
      attachment: item.attachment,
    });
    setOutbox((current) => setStatus(current, item.localId, sent ? "sending" : "queued", Date.now()));
  };

  const sendMessage = async () => {
    if (!canPostInCurrentHub) {
      setAttachmentError(i18next.t("chat.actions.message.ownerOnly"));
      return;
    }
    const text = messageInput.trim();
    if (!text && !pendingAttachment) return;

    if (editingMessage) {
      try {
        const response = await authorizedFetch(
          `${HTTP_URL}/api/channels/${editingMessage.channelId}/messages/${editingMessage.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
          },
        );
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) {
          setAttachmentError(apiErrorMessage(data, "client.message.edit"));
          return;
        }
      } catch (error) {
        setAttachmentError(error instanceof Error ? error.message : i18next.t("errors.client.message.edit"));
        return;
      }
      setEditingMessage(null);
      setMessageInput("");
      setMessageDrafts((current) => {
        const next = { ...current };
        delete next[activeChannelRef.current];
        return next;
      });
      return;
    }

    // Every message goes through the outbox: it shows as "Sending…" until the
    // server echoes it, waits while offline, and can be retried if it fails.
    const item: OutboxItem<AttachmentMeta> = {
      localId: crypto.randomUUID(),
      channelId: selectedChannel,
      text: text.slice(0, 4000),
      replyToId: replyingTo?.id ?? null,
      attachment: pendingAttachment,
      status: "sending",
      sentAt: Date.now(),
    };
    const sent = sendSocket({
      type: "CHAT_MESSAGE",
      text: item.text,
      channelId: item.channelId,
      replyToId: item.replyToId,
      attachment: item.attachment,
    });
    setOutbox((current) => [...current, sent ? item : { ...item, status: "queued" }]);

    setMessageInput("");
    if (text) recordSessionMessageActions(text);
    setMessageDrafts((current) => {
      const next = { ...current };
      delete next[activeChannelRef.current];
      return next;
    });
    setPendingAttachment(null);
    playUiSound("send");
    setAttachmentError("");
    setShowEmojiPicker(false);
    setReplyingTo(null);
  };

  /** Record-and-send from the Hub composer: upload, then post through the outbox. */
  const sendRoomVoiceNote = async (draft: VoiceNoteDraft) => {
    if (!canPostInCurrentHub || currentChannel.type !== "text") {
      throw new Error(i18next.t("chat.actions.message.ownerOnly"));
    }
    const channelId = currentChannel.id;
    const replyToId = replyingTo?.id ?? null;
    const { sendVoiceNote } = createVoiceNoteSender({
      baseUrl: HTTP_URL,
      fetch: authorizedFetch,
      sendDmText: async () => undefined,
      sendRoomAttachment: async (_channel, attachment) => {
        const item: OutboxItem<AttachmentMeta> = {
          localId: crypto.randomUUID(),
          channelId,
          text: "",
          replyToId,
          attachment,
          status: "sending",
          sentAt: Date.now(),
        };
        const sent = sendSocket({ type: "CHAT_MESSAGE", text: "", channelId, replyToId, attachment });
        setOutbox((current) => [...current, sent ? item : { ...item, status: "queued" }]);
        setReplyingTo(null);
        playUiSound("send");
      },
    });
    await sendVoiceNote({ kind: "room", id: String(channelId), encrypted: false }, draft);
  };

  const loadGiphy = async (query: string) => {
    setGifLoading(true);
    setGifError("");
    try {
      const trimmed = query.trim().slice(0, 80);
      const response = await authorizedFetch(
        `${HTTP_URL}/api/giphy${trimmed ? `?q=${encodeURIComponent(trimmed)}` : ""}`,
        { cache: "no-store" },
      );
      const data = (await response.json().catch(() => ({}))) as { gifs?: GiphyGif[]; error?: string };
      if (!response.ok) {
        setGifResults([]);
        setGifError(apiErrorMessage(data, "client.gif.load"));
        return;
      }
      setGifResults(Array.isArray(data.gifs) ? data.gifs : []);
    } catch {
      setGifResults([]);
      setGifError(i18next.t("errors.client.gif.load"));
    } finally {
      setGifLoading(false);
    }
  };

  const openGifPicker = (target: ComposerTarget) => {
    if (gifPickerTarget === target) {
      setGifPickerTarget(null);
      return;
    }
    setShowComposerPlusMenu(false);
    setShowDmPlusMenu(false);
    setShowEmojiPicker(false);
    setShowDmEmojiPicker(false);
    setShowGroupEmojiPicker(false);
    setShowForumEmojiPicker(false);
    setGifPickerTarget(target);
    setGifQuery("");
    setGifResults([]);
    setGifError("");
    void loadGiphy("");
  };

  const sendRichComposerText = async (
    target: ComposerTarget,
    text: string,
    hubChannelId?: number,
  ): Promise<boolean> => {
    if (target === "forum") return activeForumPostId ? publishForumText(text, activeForumPostId) : false;
    if (target === "hub")
      return sendSocket({
        type: "CHAT_MESSAGE",
        text,
        channelId: hubChannelId ?? selectedChannel,
        replyToId: replyingTo?.id ?? null,
      });
    // Polls and GIFs go through the same sealing as typed messages, so they
    // reach encrypted conversations (the server refuses plaintext there).
    if (target === "dm") {
      const peer = activeDmUserRef.current;
      if (!peer) return false;
      const frame = await dmSocketFrame(peer.id, text, dmReplyingTo?.id ?? null);
      if (sendSocket(frame)) return true;
      discardDmSend(frame.clientMessageId);
      return false;
    }
    const group = activeGroupChatRef.current;
    if (!group) return false;
    const frame = await groupSocketFrame(group, text, groupReplyingTo?.id ?? null);
    if (sendSocket(frame)) return true;
    discardGroupSend(frame.clientMessageId);
    return false;
  };

  const waitForPostedHubMessage = async (
    encodedText: string,
    channelId: number,
    beforeIds: ReadonlySet<string>,
  ): Promise<string> => {
    const deadline = Date.now() + 4_000;
    while (Date.now() < deadline) {
      const posted = messagesRef.current.find(
        (message) =>
          message.channelId === channelId &&
          message.userId === currentUser?.id &&
          message.text === encodedText &&
          !beforeIds.has(message.id),
      );
      if (posted) return posted.id;
      await new Promise<void>((resolve) => window.setTimeout(resolve, 100));
    }
    throw new Error(i18next.t("chat.actions.message.idPending"));
  };

  const sendSelectedGif = async (gif: GiphyGif) => {
    const target = gifPickerTarget;
    const safeUrl = safeGiphyUrl(gif.url);
    if (!target || !safeUrl) {
      setGifError(i18next.t("chat.actions.gif.unsafe"));
      return;
    }
    const text = `${GIF_PREFIX}${JSON.stringify({ id: gif.id, title: gif.title, url: safeUrl } satisfies GifPayload)}`;
    let sent = false;
    try {
      sent = await sendRichComposerText(target, text);
    } catch (error) {
      setGifError(error instanceof Error ? error.message : i18next.t("chat.actions.gif.sendFailed"));
      return;
    }
    if (!sent) {
      setGifError(i18next.t("chat.actions.gif.reconnecting"));
      return;
    }
    playUiSound("send");
    if (target === "hub") setReplyingTo(null);
    else if (target === "dm") setDmReplyingTo(null);
    else if (target === "group") setGroupReplyingTo(null);
    setGifPickerTarget(null);
    setGifQuery("");
    setGifResults([]);
  };

  const toggleMessageReactionPicker = (messageId: string, event: ReactMouseEvent<HTMLButtonElement>) => {
    if (reactionPickerMessageId === messageId) {
      setReactionPickerMessageId(null);
      setReactionPickerPosition(null);
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const edge = 12;
    const gap = 7;
    const width = Math.min(390, window.innerWidth - edge * 2);
    const preferredHeight = Math.min(410, window.innerHeight - edge * 2);
    const roomBelow = window.innerHeight - rect.bottom - edge - gap;
    const roomAbove = rect.top - edge - gap;
    const openBelow = roomBelow >= Math.min(280, preferredHeight) || roomBelow >= roomAbove;
    const availableHeight = Math.max(140, openBelow ? roomBelow : roomAbove);
    const maxHeight = Math.min(preferredHeight, availableHeight);
    const top = openBelow
      ? Math.min(rect.bottom + gap, window.innerHeight - maxHeight - edge)
      : Math.max(edge, rect.top - maxHeight - gap);
    const left = Math.max(edge, Math.min(rect.right - width, window.innerWidth - width - edge));

    setReactionPickerPosition({ top, left, width, maxHeight });
    setReactionPickerMessageId(messageId);
  };

  const renderMessageReactionPicker = (messageId: string, choose: (emoji: string) => void): ReactNode => {
    if (reactionPickerMessageId !== messageId || !reactionPickerPosition) return null;
    const portalStyle = {
      "--reaction-picker-top": `${reactionPickerPosition.top}px`,
      "--reaction-picker-left": `${reactionPickerPosition.left}px`,
      "--reaction-picker-width": `${reactionPickerPosition.width}px`,
      "--reaction-picker-max-height": `${reactionPickerPosition.maxHeight}px`,
    } as CSSProperties;
    return createPortal(
      <div
        className="message-reaction-picker message-reaction-picker-portal"
        data-message-reaction-picker="true"
        style={portalStyle}
        onClick={(event) => event.stopPropagation()}
      >
        {EMOJI_GROUPS.map((group) => (
          <section key={group.name}>
            <h4>{emojiGroupLabel(group.name)}</h4>
            <div>
              {group.items.map((emoji) => (
                <button
                  key={`${messageId}-${group.name}-${emoji}`}
                  type="button"
                  onClick={() => {
                    choose(emoji);
                    setReactionPickerMessageId(null);
                    setReactionPickerPosition(null);
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>,
      document.body,
    );
  };

  const renderComposerEmojiPicker = (target: ComposerTarget): ReactNode => {
    const open =
      target === "hub"
        ? showEmojiPicker
        : target === "dm"
          ? showDmEmojiPicker
          : target === "forum"
            ? showForumEmojiPicker
            : showGroupEmojiPicker;
    if (!open) return null;
    const choose = (emoji: string) => {
      if (target === "hub") setMessageInput((value) => `${value}${emoji}`);
      else if (target === "dm") setDmInput((value) => `${value}${emoji}`);
      else if (target === "forum") setForumReplyInput((value) => `${value}${emoji}`);
      else setGroupInput((value) => `${value}${emoji}`);
      if (target === "hub") setShowEmojiPicker(false);
      else if (target === "dm") setShowDmEmojiPicker(false);
      else if (target === "forum") setShowForumEmojiPicker(false);
      else setShowGroupEmojiPicker(false);
    };
    return (
      <div className="emoji-picker dc-composer-emoji-picker" data-composer-popover="true">
        {EMOJI_GROUPS.map((group) => (
          <section key={group.name}>
            <h4>{emojiGroupLabel(group.name)}</h4>
            <div>
              {group.items.map((emoji) => (
                <button key={`${target}-${group.name}-${emoji}`} type="button" onClick={() => choose(emoji)}>
                  {emoji}
                </button>
              ))}
            </div>
          </section>
        ))}
        {target === "hub" && hubAssets.length > 0 && (
          <section>
            <h4>{i18next.t("chat.actions.emoji.hubAssets")}</h4>
            <div>
              {hubAssets.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  className="dc-custom-asset-button"
                  title={
                    asset.kind === "emote"
                      ? i18next.t("chat.actions.emoji.emoteTitle", { name: asset.name })
                      : i18next.t("chat.actions.emoji.stickerTitle", { name: asset.name })
                  }
                  onClick={() => {
                    if (asset.kind === "emote") setMessageInput((value) => `${value}:${asset.name}:`);
                    else void sendRichComposerText("hub", `${STICKER_PREFIX}${JSON.stringify(asset)}`);
                    setShowEmojiPicker(false);
                  }}
                >
                  <img src={`${HTTP_URL}${asset.url}`} alt={asset.name} />
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    );
  };

  const renderGifPicker = (target: ComposerTarget): ReactNode => {
    if (gifPickerTarget !== target) return null;
    return (
      <div className="dc-gif-picker" data-composer-popover="true">
        <div className="dc-gif-search">
          <input
            value={gifQuery}
            onChange={(event) => setGifQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void loadGiphy(gifQuery);
              }
            }}
            placeholder={i18next.t("chat.actions.gif.searchPlaceholder")}
            maxLength={80}
            autoFocus
          />
          <button type="button" onClick={() => void loadGiphy(gifQuery)}>
            {i18next.t("chat.actions.gif.search")}
          </button>
        </div>
        {gifLoading ? (
          <div className="dc-gif-status">{i18next.t("chat.actions.gif.loading")}</div>
        ) : gifError ? (
          <div className="dc-gif-status">{gifError}</div>
        ) : gifResults.length === 0 ? (
          <div className="dc-gif-status">{i18next.t("chat.actions.gif.empty")}</div>
        ) : (
          <div className="dc-gif-grid">
            {gifResults.flatMap((gif) => {
              const previewSrc = giphyMediaProxyUrl(gif.previewUrl) ?? giphyMediaProxyUrl(gif.url);
              if (!previewSrc) return [];
              return [
                <button
                  key={gif.id}
                  type="button"
                  className="dc-gif-item"
                  title={gif.title || i18next.t("chat.actions.gif.fallbackTitle")}
                  onClick={() => sendSelectedGif(gif)}
                >
                  <img src={previewSrc} alt={gif.title || i18next.t("chat.actions.gif.fallbackTitle")} loading="lazy" />
                </button>,
              ];
            })}
          </div>
        )}
        <div className="dc-gif-attribution">{i18next.t("chat.actions.gif.attribution")}</div>
      </div>
    );
  };

  const openPollComposer = (target: "hub" | "dm") => {
    setPollQuestion("");
    setPollOptions(["", ""]);
    setShowPollComposer(target);
  };

  const openEventComposerWith = (seed: EventComposerSeed, hubId = currentServer.id) => {
    setShowComposerPlusMenu(false);
    setEventDrawerItem(null);
    const restoredInvitees = !seed.editing && eventInviteMode === "selected" ? eventInviteMemberIds : [];
    setEventComposerSeed(
      restoredInvitees.length && !seed.audienceMemberIds ? { ...seed, audienceMemberIds: restoredInvitees } : seed,
    );
    setEventComposerHubId(hubId);
    setShowEventComposer(true);
    if (hubId === currentServer.id) {
      if (hubMembers.length === 0) void loadHubMembers(hubId);
      void loadCustomRoles(hubId);
    }
  };

  const openEventComposer = () =>
    openEventComposerWith({ channelId: currentChannel.type === "text" ? currentChannel.id : undefined });

  const composeAnnouncement = () => {
    const announcements = currentServer.channels.find(
      (channel) => channel.type === "text" && channel.name.trim().toLowerCase() === "announcements",
    );
    if (!announcements) return;
    setShowHubHome(false);
    setShowStreamerOverview(false);
    setShowHubCalendarPanel(false);
    changeChannel(announcements.id);
    window.setTimeout(() => messageInputRef.current?.focus(), 0);
  };

  // Events are created via POST /events (EventComposerSheet). For "everyone" events with an
  // announcement room we also post a legacy-format chat card carrying eventId so older
  // clients still see it; F1: always replyToId null (never attach the composer's reply).
  const handleEventSaved = (event: ApiHubEvent, created: boolean) => {
    hubEvents.applyEvent(event);
    void hubEvents.refreshHub(event.hubId);
    setShowEventComposer(false);
    setEventInviteMode("all");
    setEventInviteMemberIds([]);
    playUiSound("send");
    const hubName = servers.find((hub) => hub.id === event.hubId)?.name ?? "";
    if (created && event.channelId && event.audience === "all") {
      const payload: EventPayload & { eventId: string } = {
        title: event.title,
        startAt: new Date(event.startsAt).toISOString(),
        description: event.description.slice(0, 600),
        inviteMode: "all",
        invitedUserIds: [],
        invitedUsernames: [],
        eventId: event.id,
      };
      sendSocket({
        type: "CHAT_MESSAGE",
        text: `${EVENT_PREFIX}${JSON.stringify(payload)}`,
        channelId: event.channelId,
        replyToId: null,
      });
    }
    setEventDrawerItem(
      created
        ? apiEventToItem(event, hubName)
        : (current) => (current && current.id === event.id ? apiEventToItem(event, hubName) : current),
    );
  };

  const submitPoll = async () => {
    const question = pollQuestion.trim().slice(0, 180);
    const options = pollOptions
      .map((option) => option.trim().slice(0, 100))
      .filter(Boolean)
      .slice(0, 8);
    if (!question || options.length < 2) return;
    const text = `${POLL_PREFIX}${JSON.stringify({ question, options } satisfies PollPayload)}`;
    try {
      if (!(await sendRichComposerText(showPollComposer === "hub" ? "hub" : "dm", text))) return;
    } catch (error) {
      // Sealing failed (keys unavailable); keep the dialog open so nothing is lost.
      console.error("Could not send poll:", error);
      return;
    }
    if (showPollComposer === "hub") setReplyingTo(null);
    else setDmReplyingTo(null);
    setShowPollComposer(null);
    setPollQuestion("");
    setPollOptions(["", ""]);
  };

  const voteInHubPoll = async (message: ChatMessage, optionIndex: number) => {
    if (!currentUser) return;
    const selected = Object.entries(message.reactions ?? {})
      .filter(([key, users]) => key.startsWith("poll_") && users.includes(currentUser.id))
      .map(([key]) => key);
    const next = `poll_${optionIndex}`;
    for (const key of selected) if (key !== next) await sendReaction(message, key);
    if (!selected.includes(next)) await sendReaction(message, next);
  };

  const voteOnForumPost = async (message: ChatMessage, direction: "up" | "down") => {
    if (!currentUser) return;
    const wanted = direction === "up" ? "forum_vote_up" : "forum_vote_down";
    await sendReaction(message, wanted);
  };

  const voteInDmPoll = async (message: DirectMessage, optionIndex: number) => {
    if (!currentUser) return;
    const selected = Object.entries(message.reactions ?? {})
      .filter(([key, users]) => key.startsWith("poll_") && users.includes(currentUser.id))
      .map(([key]) => key);
    const next = `poll_${optionIndex}`;
    // An encrypted vote replaces the earlier one in a single sealed update.
    if (message.envelope) {
      if (!selected.includes(next)) await sendDmReaction(message, next);
      return;
    }
    for (const key of selected) if (key !== next) await sendDmReaction(message, key);
    if (!selected.includes(next)) await sendDmReaction(message, next);
  };

  const handleMessageKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    // Settings → Chat chooses Enter or Ctrl+Enter; Shift+Enter is always a new line.
    if (shouldSend(event, getChatPrefs())) {
      event.preventDefault();
      void sendMessage();
    }
  };

  const canDeleteMessage = (message: ChatMessage): boolean => {
    if (!currentUser) return false;
    // Bot messages are stored under the publisher but are not theirs: only
    // moderators delete them, as with anyone else's message.
    if (message.userId === currentUser.id && !messageBotFields(message).bot) return true;
    return currentServer.myRole === "owner" || currentServer.myRole === "admin";
  };

  /** Run a message action and surface a failure instead of silently dropping it. */
  const runMessageAction = async (request: () => Promise<Response>, failure: ErrorCode) => {
    try {
      const response = await request();
      if (response.ok) return;
      const data = (await response.json().catch(() => ({}))) as ApiError;
      setAttachmentError(apiErrorMessage(data, failure));
    } catch (error) {
      const message = apiErrorMessage(null, failure);
      console.warn(message, error);
      setAttachmentError(message);
    }
  };

  const sendReaction = (message: ChatMessage, emoji: string) =>
    runMessageAction(
      () =>
        authorizedFetch(`${HTTP_URL}/api/channels/${message.channelId}/messages/${message.id}/reactions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ emoji }),
        }),
      "client.message.addReaction",
    );

  const togglePinMessage = (message: ChatMessage) =>
    runMessageAction(
      () =>
        authorizedFetch(`${HTTP_URL}/api/channels/${message.channelId}/messages/${message.id}/pin`, { method: "POST" }),
      "client.message.togglePin",
    );

  const startEditMessage = (message: ChatMessage) => {
    setReplyingTo(null);
    setEditingMessage(message);
    setMessageInput(message.text);
  };

  const searchMessages = async () => {
    if (!messageSearchQuery.trim()) {
      setMessageSearchResults([]);
      return;
    }
    try {
      const response = await authorizedFetch(
        `${HTTP_URL}/api/channels/${selectedChannel}/search?q=${encodeURIComponent(messageSearchQuery.trim())}`,
      );
      if (!response.ok) throw new Error(`Search failed (${response.status}).`);
      setMessageSearchResults((await response.json()) as ChatMessage[]);
    } catch (error) {
      console.warn("Message search failed:", error);
      setMessageSearchResults([]);
      setAttachmentError(i18next.t("chat.actions.message.searchUnavailable"));
    }
  };

  // Title of the in-app confirm dialog; names the role when deleting someone else's message.
  const deleteMessageConfirmTitle = (message: ChatMessage) =>
    message.userId === currentUser?.id
      ? i18next.t("chat.actions.message.confirmDelete")
      : currentServer.myRole === "owner"
        ? i18next.t("chat.actions.message.confirmDeleteAsOwner", { username: message.username })
        : currentServer.myRole === "admin"
          ? i18next.t("chat.actions.message.confirmDeleteAsAdmin", { username: message.username })
          : currentServer.myRole === "member"
            ? i18next.t("chat.actions.message.confirmDeleteAsMember", { username: message.username })
            : i18next.t("chat.actions.message.confirmDeleteAsModerator", { username: message.username });

  // Caller confirms first (HubMessageList shows the dialog).
  const deleteMessage = async (message: ChatMessage) => {
    if (!canDeleteMessage(message)) return;

    try {
      const response = await authorizedFetch(
        `${HTTP_URL}/api/channels/${message.channelId}/messages/${encodeURIComponent(message.id)}`,
        { method: "DELETE" },
      );
      const data = (await response.json()) as ApiError & { success?: boolean };
      if (!response.ok) {
        window.alert(apiErrorMessage(data, "client.message.delete"));
        return;
      }

      setMessages((current) => current.filter((item) => item.id !== message.id));
    } catch (error) {
      console.error("Could not delete message:", error);
      window.alert(i18next.t("chat.actions.message.deleteOffline"));
    }
  };

  return {
    uploadAttachment,
    sendRoomVoiceNote,
    cancelAttachmentUpload,
    publishForumText,
    publishForumPostAwaitingAck,
    sendOutboxItem,
    sendMessage,
    openGifPicker,
    sendRichComposerText,
    waitForPostedHubMessage,
    toggleMessageReactionPicker,
    renderMessageReactionPicker,
    renderComposerEmojiPicker,
    renderGifPicker,
    openPollComposer,
    openEventComposerWith,
    openEventComposer,
    composeAnnouncement,
    handleEventSaved,
    submitPoll,
    voteInHubPoll,
    voteOnForumPost,
    voteInDmPoll,
    handleMessageKeyDown,
    authorizedFetch,
    canDeleteMessage,
    sendReaction,
    togglePinMessage,
    startEditMessage,
    searchMessages,
    deleteMessage,
    deleteMessageConfirmTitle,
  };
}

export type HubChatActions = ReturnType<typeof createHubChatActions>;
