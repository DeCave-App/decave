// Hub room message history: loading a room and older pages.

import type { Dispatch, SetStateAction, MutableRefObject } from "react";
import { isCurrentChannelLoad } from "../../voice/desktop-voice-reliability";
import type { ChatMessage, SocialUser, DirectMessage, GroupChatMessage, GroupChat, ApiError } from "../types";
import { HTTP_URL } from "../env";
import { HISTORY_PAGE_SIZE } from "../constants";
import type { ComposerState } from "../state/composer";

export type MessageHistoryActionsDeps = {
  authToken: string;
  messages: ChatMessage[];
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  groupMessages: GroupChatMessage[];
  setGroupMessages: Dispatch<SetStateAction<GroupChatMessage[]>>;
  dmMessages: DirectMessage[];
  setDmMessages: Dispatch<SetStateAction<DirectMessage[]>>;
  messageLoadGenerationRef: MutableRefObject<number>;
  activeChannelRef: MutableRefObject<number>;
  setOlderHistory: Dispatch<SetStateAction<{ channel: boolean; dm: boolean; group: boolean }>>;
  olderHistoryBusy: boolean;
  setOlderHistoryBusy: Dispatch<SetStateAction<boolean>>;
  prependingHistoryRef: MutableRefObject<boolean>;
  activeDmUserRef: MutableRefObject<SocialUser | null>;
  activeGroupChatRef: MutableRefObject<GroupChat | null>;
  authorizedFetch: (url: string, init?: RequestInit) => Promise<Response>;
  composer: ComposerState;
};

/** Called once per render with that render's values. */
export function createMessageHistoryActions(deps: MessageHistoryActionsDeps) {
  const {
    authToken,
    messages,
    setMessages,
    groupMessages,
    setGroupMessages,
    dmMessages,
    setDmMessages,
    messageLoadGenerationRef,
    activeChannelRef,
    setOlderHistory,
    olderHistoryBusy,
    setOlderHistoryBusy,
    prependingHistoryRef,
    activeDmUserRef,
    activeGroupChatRef,
    authorizedFetch,
    composer,
  } = deps;
  const { setAttachmentError } = composer;

  const normalizeChannelMessage = (item: unknown, channelId: number): ChatMessage => {
    const value = item as Partial<ChatMessage>;
    return {
      id: typeof value.id === "string" ? value.id : crypto.randomUUID(),
      userId: typeof value.userId === "string" ? value.userId : undefined,
      username: typeof value.username === "string" ? value.username : "Unknown",
      avatarUrl: typeof value.avatarUrl === "string" ? value.avatarUrl : null,
      avatarUpdatedAt: typeof value.avatarUpdatedAt === "string" ? value.avatarUpdatedAt : null,
      text: typeof value.text === "string" ? value.text : "",
      timestamp: typeof value.timestamp === "string" ? value.timestamp : new Date().toISOString(),
      channelId: typeof value.channelId === "number" ? value.channelId : channelId,
      role: value.role === "owner" || value.role === "admin" || value.role === "member" ? value.role : null,
      editedAt: typeof value.editedAt === "string" ? value.editedAt : null,
      replyToId: typeof value.replyToId === "string" ? value.replyToId : null,
      reactions: value.reactions && typeof value.reactions === "object" ? value.reactions : {},
      pinned: value.pinned === true,
      attachment: value.attachment ?? null,
    };
  };

  const loadOlderHistory = async (kind: "channel" | "dm" | "group", list: HTMLElement | null) => {
    if (olderHistoryBusy) return;
    const scrollFromBottom = list ? list.scrollHeight - list.scrollTop : 0;
    const restoreScroll = () =>
      window.requestAnimationFrame(() => {
        if (list) list.scrollTop = list.scrollHeight - scrollFromBottom;
      });
    const prepend = <T extends { id: string }>(older: T[], current: T[]) => {
      const known = new Set(current.map((message) => message.id));
      return [...older.filter((message) => !known.has(message.id)), ...current];
    };
    setOlderHistoryBusy(true);
    try {
      if (kind === "channel") {
        const channelId = activeChannelRef.current;
        const before = messages[0]?.id;
        if (!channelId || !before) return;
        const response = await authorizedFetch(
          `${HTTP_URL}/api/channels/${channelId}/messages?before=${encodeURIComponent(before)}`,
        );
        if (!response.ok) throw new Error(`Older messages failed to load (${response.status}).`);
        const data: unknown = await response.json();
        if (!Array.isArray(data) || activeChannelRef.current !== channelId) return;
        const page = data.map((item: unknown) => normalizeChannelMessage(item, channelId));
        prependingHistoryRef.current = true;
        setMessages((current) => prepend(page, current));
        setOlderHistory((current) => ({ ...current, channel: page.length >= HISTORY_PAGE_SIZE }));
      } else if (kind === "dm") {
        const target = activeDmUserRef.current;
        const before = dmMessages[0]?.id;
        if (!target || !before) return;
        const response = await authorizedFetch(
          `${HTTP_URL}/api/dms/${encodeURIComponent(target.id)}?before=${encodeURIComponent(before)}`,
        );
        const data = (await response.json().catch(() => ({}))) as { messages?: DirectMessage[] } & ApiError;
        if (!response.ok) throw new Error(data.error || "Older messages failed to load.");
        if (activeDmUserRef.current?.id !== target.id) return;
        const page = Array.isArray(data.messages) ? data.messages : [];
        prependingHistoryRef.current = true;
        setDmMessages((current) => prepend(page, current));
        setOlderHistory((current) => ({ ...current, dm: page.length >= HISTORY_PAGE_SIZE }));
      } else {
        const group = activeGroupChatRef.current;
        const before = groupMessages[0]?.id;
        if (!group || !before) return;
        const response = await authorizedFetch(
          `${HTTP_URL}/api/groups/${encodeURIComponent(group.id)}?before=${encodeURIComponent(before)}`,
        );
        const data = (await response.json().catch(() => ({}))) as { messages?: GroupChatMessage[]; error?: string };
        if (!response.ok) throw new Error(data.error || "Older messages failed to load.");
        if (activeGroupChatRef.current?.id !== group.id) return;
        const page = Array.isArray(data.messages) ? data.messages : [];
        prependingHistoryRef.current = true;
        setGroupMessages((current) => prepend(page, current));
        setOlderHistory((current) => ({ ...current, group: page.length >= HISTORY_PAGE_SIZE }));
      }
      restoreScroll();
    } catch (error) {
      console.error("Could not load older messages:", error);
      setAttachmentError(error instanceof Error ? error.message : "Older messages failed to load.");
    } finally {
      setOlderHistoryBusy(false);
    }
  };

  const loadMessages = async (channelId: number) => {
    if (!authToken) return;
    const generation = ++messageLoadGenerationRef.current;
    const isCurrent = () =>
      isCurrentChannelLoad(channelId, activeChannelRef.current, generation, messageLoadGenerationRef.current);

    try {
      if (!isCurrent()) return;
      const response = await authorizedFetch(`${HTTP_URL}/api/channels/${channelId}/messages`);
      if (!response.ok) {
        console.error("Failed to load messages:", response.status);
        return;
      }

      const data: unknown = await response.json();
      if (!Array.isArray(data)) return;
      if (!isCurrent()) return;

      const loadedMessages: ChatMessage[] = data.map((item: unknown) => normalizeChannelMessage(item, channelId));

      if (isCurrent()) {
        setMessages(loadedMessages);
        setOlderHistory((current) => ({ ...current, channel: loadedMessages.length >= HISTORY_PAGE_SIZE }));
      }
    } catch (error) {
      console.error("Could not load messages:", error);
    }
  };

  return {
    loadOlderHistory,
    loadMessages,
  };
}
