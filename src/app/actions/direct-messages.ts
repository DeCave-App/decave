// Direct messages and group chats: conversations and their preferences, sending,
// editing, reacting, attachments, deleting, and group membership.

import type { Dispatch, SetStateAction, MutableRefObject } from "react";
import type {
  Server,
  AccountUser,
  AttachmentMeta,
  SocialUser,
  DirectMessage,
  DmConversation,
  DmPreference,
  GroupChatMessage,
  GroupChat,
  ApiError,
  UiSoundEvent,
} from "../types";
import { HTTP_URL } from "../env";
import { localeForLanguage, preferredTimeOptions } from "../locale";
import { i18next } from "../../i18n/index.ts";
import { apiErrorMessage } from "../../i18n/apiError.ts";
import { e2eeErrorText } from "../../e2ee/errorText.ts";
import { HISTORY_PAGE_SIZE } from "../constants";
import { DM_ATTACHMENT_PREFIX } from "../message-payloads";
import { dmPreviewLabels, translatedDmPreview } from "../../i18n/dmPreview.ts";
import type { NewConversationState } from "../state/new-conversation";
import { mergeConversationHistory, type PendingSocialMessage } from "./social-message-recovery";
import {
  dmE2ee,
  discardDmSend,
  discardGroupSend,
  dmReactionBody,
  dmSealedBody,
  dmSocketFrame,
  encryptFileForDm,
  groupPreview,
  groupSocketFrame,
} from "../../e2ee/dm-e2ee-client";
import { createVoiceNoteSender } from "../../features/voice-notes/send";
import type { VoiceNoteDraft } from "../../features/voice-notes/useVoiceRecorder";

export type DirectMessageActionsDeps = {
  currentUser: AccountUser | null;
  setShowSettings: Dispatch<SetStateAction<boolean>>;
  setShowAdminDashboard: Dispatch<SetStateAction<boolean>>;
  setShowHome: Dispatch<SetStateAction<boolean>>;
  setReactionPickerMessageId: Dispatch<SetStateAction<string | null>>;
  setShowServerBrowser: Dispatch<SetStateAction<boolean>>;
  setShowSocial: Dispatch<SetStateAction<boolean>>;
  setSocialView: Dispatch<SetStateAction<"dm" | "friends">>;
  setActiveDmUser: Dispatch<SetStateAction<SocialUser | null>>;
  setDmConversations: Dispatch<SetStateAction<DmConversation[]>>;
  setDmPreferences: Dispatch<SetStateAction<Record<string, DmPreference>>>;
  dmPreferences: Record<string, DmPreference>;
  setDmHeaderMenuOpen: Dispatch<SetStateAction<boolean>>;
  setGroupChats: Dispatch<SetStateAction<GroupChat[]>>;
  setActiveGroupChat: Dispatch<SetStateAction<GroupChat | null>>;
  setGroupMessages: Dispatch<SetStateAction<GroupChatMessage[]>>;
  groupDrafts: Record<string, string>;
  setGroupDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  setGroupInput: Dispatch<SetStateAction<string>>;
  groupInput: string;
  setGroupReplyingTo: Dispatch<SetStateAction<GroupChatMessage | null>>;
  groupReplyingTo: GroupChatMessage | null;
  setGroupError: Dispatch<SetStateAction<string>>;
  setShowNewConversation: Dispatch<SetStateAction<boolean>>;
  setShowGroupMembers: Dispatch<SetStateAction<boolean>>;
  setDmMessages: Dispatch<SetStateAction<DirectMessage[]>>;
  dmInput: string;
  setDmInput: Dispatch<SetStateAction<string>>;
  setDmDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  setDmReplyingTo: Dispatch<SetStateAction<DirectMessage | null>>;
  dmReplyingTo: DirectMessage | null;
  dmAttachmentBusy: boolean;
  setDmAttachmentBusy: Dispatch<SetStateAction<boolean>>;
  setDmAttachmentRetryName: Dispatch<SetStateAction<string>>;
  setDmError: Dispatch<SetStateAction<string>>;
  setDmEditingId: Dispatch<SetStateAction<string | null>>;
  dmEditingId: string | null;
  setDmEditingText: Dispatch<SetStateAction<string>>;
  dmEditingText: string;
  setShowDmPlusMenu: Dispatch<SetStateAction<boolean>>;
  dmDeleteConfirm: DirectMessage | null;
  setDmDeleteConfirm: Dispatch<SetStateAction<DirectMessage | null>>;
  dmConversationDeleteConfirm: SocialUser | null;
  setDmConversationDeleteConfirm: Dispatch<SetStateAction<SocialUser | null>>;
  setOlderHistory: Dispatch<SetStateAction<{ channel: boolean; dm: boolean; group: boolean }>>;
  dmAttachmentInputRef: MutableRefObject<HTMLInputElement | null>;
  dmAttachmentAbortRef: MutableRefObject<AbortController | null>;
  dmAttachmentRetryFileRef: MutableRefObject<File | null>;
  activeDmUserRef: MutableRefObject<SocialUser | null>;
  activeGroupChatRef: MutableRefObject<GroupChat | null>;
  pendingSocialMessagesRef: MutableRefObject<Map<string, PendingSocialMessage>>;
  dmDraftRevisionRef: MutableRefObject<Record<string, number>>;
  groupDraftRevisionRef: MutableRefObject<Record<string, number>>;
  groupHistoryLoadGenerationRef: MutableRefObject<number>;
  playUiSound: (event: UiSoundEvent, preview?: boolean, quietChecked?: boolean) => void;
  authorizedFetch: (url: string, init?: RequestInit) => Promise<Response>;
  loadServers: () => Promise<Server[] | null>;
  loadSocialState: () => Promise<void>;
  sendSocket: (payload: unknown) => boolean;
  newConversation: NewConversationState;
};

/** Called once per render with that render's values. */
export function createDirectMessageActions(deps: DirectMessageActionsDeps) {
  const {
    currentUser,
    setShowSettings,
    setShowAdminDashboard,
    setShowHome,
    setReactionPickerMessageId,
    setShowServerBrowser,
    setShowSocial,
    setSocialView,
    setActiveDmUser,
    setDmConversations,
    setDmPreferences,
    dmPreferences,
    setDmHeaderMenuOpen,
    setGroupChats,
    setActiveGroupChat,
    setGroupMessages,
    groupDrafts,
    setGroupDrafts,
    setGroupInput,
    groupInput,
    setGroupReplyingTo,
    groupReplyingTo,
    setGroupError,
    setShowNewConversation,
    setShowGroupMembers,
    setDmMessages,
    dmInput,
    setDmInput,
    setDmDrafts,
    setDmReplyingTo,
    dmReplyingTo,
    dmAttachmentBusy,
    setDmAttachmentBusy,
    setDmAttachmentRetryName,
    setDmError,
    setDmEditingId,
    dmEditingId,
    setDmEditingText,
    dmEditingText,
    setShowDmPlusMenu,
    dmDeleteConfirm,
    setDmDeleteConfirm,
    dmConversationDeleteConfirm,
    setDmConversationDeleteConfirm,
    setOlderHistory,
    dmAttachmentInputRef,
    dmAttachmentAbortRef,
    dmAttachmentRetryFileRef,
    activeDmUserRef,
    activeGroupChatRef,
    pendingSocialMessagesRef,
    dmDraftRevisionRef,
    groupDraftRevisionRef,
    groupHistoryLoadGenerationRef,
    playUiSound,
    authorizedFetch,
    loadServers,
    loadSocialState,
    sendSocket,
    newConversation,
  } = deps;
  const { setNewGroupMemberIds, newGroupMemberIds, setNewGroupName, newGroupName, groupCreating, setGroupCreating } =
    newConversation;

  const loadDmPreferences = async () => {
    if (!currentUser) return;
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/social/dm-preferences`);
      const data = (await response.json().catch(() => ({}))) as {
        preferences?: Array<{ userId: string; favorite: boolean; archived: boolean }>;
        error?: string;
      };
      if (!response.ok) return;
      const next: Record<string, DmPreference> = {};
      for (const item of data.preferences ?? []) {
        if (!item?.userId) continue;
        next[item.userId] = { favorite: item.favorite === true, archived: item.archived === true };
      }
      setDmPreferences(next);
    } catch {
      // DM preferences are non-critical and can be retried when Messages opens again.
    }
  };

  const updateDmPreference = async (userId: string, patch: Partial<DmPreference>) => {
    const previous = dmPreferences[userId] ?? { favorite: false, archived: false };
    const next = { ...previous, ...patch };
    setDmPreferences((current) => ({ ...current, [userId]: next }));
    setDmHeaderMenuOpen(false);
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/social/dm-preferences/${encodeURIComponent(userId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setDmPreferences((current) => ({ ...current, [userId]: previous }));
        setDmError(apiErrorMessage(data, "client.dm.updateConversation"));
      }
    } catch {
      setDmPreferences((current) => ({ ...current, [userId]: previous }));
      setDmError(i18next.t("errors.client.dm.updateConversation"));
    }
  };

  const formatDmSidebarTime = (timestamp: string) => {
    const value = Date.parse(timestamp);
    if (!Number.isFinite(value)) return "";
    const now = Date.now();
    const age = now - value;
    const date = new Date(value);
    if (age < 24 * 60 * 60 * 1000 && date.toDateString() === new Date(now).toDateString()) {
      return date.toLocaleTimeString(localeForLanguage(), {
        hour: "numeric",
        minute: "2-digit",
        ...preferredTimeOptions(),
      });
    }
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) return i18next.t("chat.actions.dm.yesterday");
    const days = Math.max(1, Math.floor(age / 86400000));
    if (days < 7) return i18next.t("chat.actions.dm.daysAgo", { count: days });
    return date.toLocaleDateString(localeForLanguage(), { month: "short", day: "numeric" });
  };

  const loadDmConversations = async () => {
    void loadDmPreferences();
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/dms`);
      const data = (await response.json().catch(() => ({}))) as {
        conversations?: DmConversation[];
        error?: string;
      };
      if (!response.ok) {
        console.error("Could not load DM conversations:", data.error || response.status);
        setDmConversations([]);
        return;
      }
      const conversations = Array.isArray(data.conversations) ? data.conversations : [];
      // Encrypted previews are decrypted here, so every list shows the real text.
      const previews = await Promise.all(
        conversations.map((conversation) =>
          dmE2ee.open(
            {
              id: conversation.latestMessageId ?? "",
              fromUserId: conversation.latestEnvelope?.from ?? "",
              toUserId: conversation.latestEnvelope?.to ?? "",
              text: conversation.latestMessage,
              envelope: conversation.latestEnvelope ?? null,
            },
            conversation.user.id,
          ),
        ),
      );
      setDmConversations(
        conversations.map((conversation, index) => ({
          ...conversation,
          latestMessage:
            previews[index].e2ee === "encrypted" || !conversation.latestEnvelope
              ? translatedDmPreview(previews[index].text)
              : dmPreviewLabels.encrypted(),
        })),
      );
    } catch (error) {
      console.error("Could not load DM conversations:", error);
      setDmConversations([]);
    }
  };

  const loadGroupChats = async () => {
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/groups`);
      const data = (await response.json().catch(() => ({}))) as {
        groups?: GroupChat[];
        error?: string;
      };
      if (!response.ok) {
        console.error("Could not load group chats:", data.error || response.status);
        setGroupChats([]);
        return;
      }
      const groups = Array.isArray(data.groups) ? data.groups : [];
      // Encrypted previews are decrypted here, like DM previews.
      const previews = await Promise.all(groups.map((group) => groupPreview(group)));
      setGroupChats(groups.map((group, index) => ({ ...group, latestMessage: previews[index] })));
    } catch (error) {
      console.error("Could not load group chats:", error);
      setGroupChats([]);
    }
  };

  const openGroupChat = async (group: GroupChat) => {
    const previousGroup = activeGroupChatRef.current;
    const reopeningSameGroup = previousGroup?.id === group.id;
    if (previousGroup && !reopeningSameGroup) {
      setGroupDrafts((current) => ({ ...current, [previousGroup.id]: groupInput }));
    }
    const loadGeneration = ++groupHistoryLoadGenerationRef.current;
    setShowHome(false);
    setShowSettings(false);
    setShowServerBrowser(false);
    setShowAdminDashboard(false);
    setShowSocial(true);
    setSocialView("dm");
    setActiveDmUser(null);
    activeDmUserRef.current = null;
    setDmMessages([]);
    setDmReplyingTo(null);
    setActiveGroupChat(group);
    activeGroupChatRef.current = group;
    if (!reopeningSameGroup) setGroupMessages([]);
    if (!reopeningSameGroup) setGroupInput(groupDrafts[group.id] ?? "");
    setGroupReplyingTo(null);
    setGroupError("");
    setShowGroupMembers(false);
    setReactionPickerMessageId(null);
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/groups/${encodeURIComponent(group.id)}`);
      const data = (await response.json().catch(() => ({}))) as {
        group?: GroupChat;
        messages?: GroupChatMessage[];
        error?: string;
      };
      if (loadGeneration !== groupHistoryLoadGenerationRef.current || activeGroupChatRef.current?.id !== group.id)
        return;
      if (!response.ok || !data.group) {
        setGroupError(apiErrorMessage(data, "client.dm.openGroup"));
        return;
      }
      setActiveGroupChat(data.group);
      activeGroupChatRef.current = data.group;
      const firstGroupPage = await dmE2ee.openGroupAll(
        Array.isArray(data.messages) ? data.messages : [],
        data.group.id,
      );
      if (loadGeneration !== groupHistoryLoadGenerationRef.current || activeGroupChatRef.current?.id !== group.id)
        return;
      setGroupMessages((current) =>
        mergeConversationHistory(firstGroupPage, current, (message) => message.groupId === group.id),
      );
      setOlderHistory((current) => ({ ...current, group: firstGroupPage.length >= HISTORY_PAGE_SIZE }));
      void loadGroupChats();
    } catch (error) {
      if (loadGeneration !== groupHistoryLoadGenerationRef.current || activeGroupChatRef.current?.id !== group.id)
        return;
      console.error("Could not load group chat:", error);
      setGroupError(i18next.t("errors.client.dm.openGroup"));
    }
  };

  const sendGroupMessage = async () => {
    const group = activeGroupChatRef.current;
    const text = groupInput.trim();
    if (!group || !text) return;
    setGroupError("");
    const draftRevision = groupDraftRevisionRef.current[group.id] ?? 0;
    let frame: Record<string, unknown>;
    try {
      frame = await groupSocketFrame(group, text, groupReplyingTo?.id ?? null);
    } catch (error) {
      setGroupError(e2eeErrorText(error, i18next.t("chat.actions.dm.encryptFailed")));
      return;
    }
    const clientMessageId = frame.clientMessageId;
    if (typeof clientMessageId !== "string") {
      discardGroupSend(clientMessageId);
      setGroupError(i18next.t("chat.actions.dm.prepareFailed"));
      return;
    }
    const pending: PendingSocialMessage = {
      clientMessageId,
      kind: "group",
      conversationId: group.id,
      senderUserId: currentUser?.id ?? "",
      text,
      draftRevision,
    };
    pendingSocialMessagesRef.current.set(clientMessageId, pending);
    if (sendSocket(frame)) {
      setGroupInput("");
      setGroupDrafts((current) => ({ ...current, [group.id]: "" }));
      setGroupReplyingTo(null);
      return;
    }
    pendingSocialMessagesRef.current.delete(clientMessageId);
    discardGroupSend(clientMessageId);
  };

  const deleteGroupMessage = async (message: GroupChatMessage) => {
    const group = activeGroupChatRef.current;
    if (!group) return;
    const canDelete = message.fromUserId === currentUser?.id || group.ownerUserId === currentUser?.id;
    if (!canDelete || !window.confirm(i18next.t("chat.actions.dm.confirmDeleteMessage"))) return;
    setGroupError("");
    try {
      const response = await authorizedFetch(
        `${HTTP_URL}/api/groups/${encodeURIComponent(group.id)}/messages/${encodeURIComponent(message.id)}`,
        { method: "DELETE" },
      );
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setGroupError(apiErrorMessage(data, "client.message.delete"));
        return;
      }
      setGroupMessages((current) => current.filter((item) => item.id !== message.id));
      void loadGroupChats();
    } catch (error) {
      console.error("Could not delete group message:", error);
      setGroupError(i18next.t("errors.client.message.delete"));
    }
  };

  const openNewConversationComposer = () => {
    setNewGroupMemberIds([]);
    setNewGroupName("");
    setGroupError("");
    setShowNewConversation(true);
    void loadSocialState();
  };

  const toggleNewGroupMember = (userId: string) => {
    setNewGroupMemberIds((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId],
    );
  };

  const createGroupChat = async () => {
    if (newGroupMemberIds.length < 2 || groupCreating) return;
    setGroupCreating(true);
    setGroupError("");
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/groups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newGroupName.trim(),
          memberIds: newGroupMemberIds,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        group?: GroupChat;
        error?: string;
      };
      if (!response.ok || !data.group) {
        setGroupError(apiErrorMessage(data, "client.dm.createGroup"));
        return;
      }
      setShowNewConversation(false);
      await loadGroupChats();
      await openGroupChat(data.group);
    } catch (error) {
      console.error("Could not create group chat:", error);
      setGroupError(i18next.t("errors.client.dm.createGroup"));
    } finally {
      setGroupCreating(false);
    }
  };

  const addGroupMember = async (friend: SocialUser) => {
    const group = activeGroupChatRef.current;
    if (!group) return;
    setGroupError("");
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/groups/${encodeURIComponent(group.id)}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: friend.id }),
      });
      const data = (await response.json().catch(() => ({}))) as { group?: GroupChat; error?: string };
      if (!response.ok || !data.group) {
        setGroupError(apiErrorMessage(data, "client.dm.addMember"));
        return;
      }
      setActiveGroupChat(data.group);
      activeGroupChatRef.current = data.group;
      await loadGroupChats();
    } catch {
      setGroupError(i18next.t("errors.client.dm.addMember"));
    }
  };

  const removeGroupMember = async (member: SocialUser) => {
    const group = activeGroupChatRef.current;
    if (!group) return;
    setGroupError("");
    try {
      const response = await authorizedFetch(
        `${HTTP_URL}/api/groups/${encodeURIComponent(group.id)}/members/${encodeURIComponent(member.id)}`,
        { method: "DELETE" },
      );
      const data = (await response.json().catch(() => ({}))) as {
        group?: GroupChat;
        error?: string;
        deleted?: boolean;
      };
      if (!response.ok) {
        setGroupError(apiErrorMessage(data, "client.dm.removeMember"));
        return;
      }
      if (member.id === currentUser?.id || data.deleted) {
        setShowGroupMembers(false);
        setActiveGroupChat(null);
        activeGroupChatRef.current = null;
        setGroupMessages([]);
      } else if (data.group) {
        setActiveGroupChat(data.group);
        activeGroupChatRef.current = data.group;
      }
      await loadGroupChats();
    } catch {
      setGroupError(i18next.t("errors.client.dm.removeMember"));
    }
  };

  const deleteActiveGroup = async () => {
    const group = activeGroupChatRef.current;
    if (!group || group.ownerUserId !== currentUser?.id) return;
    if (!window.confirm(i18next.t("chat.actions.dm.confirmDeleteGroup", { name: group.name }))) return;
    setGroupError("");
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/groups/${encodeURIComponent(group.id)}`, {
        method: "DELETE",
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setGroupError(apiErrorMessage(data, "client.dm.deleteGroup"));
        return;
      }
      setShowGroupMembers(false);
      setActiveGroupChat(null);
      activeGroupChatRef.current = null;
      setGroupMessages([]);
      await Promise.all([loadGroupChats(), loadServers()]);
    } catch {
      setGroupError(i18next.t("errors.client.dm.deleteGroup"));
    }
  };

  const sendDirectMessage = async () => {
    const target = activeDmUserRef.current;
    const text = dmInput.trim();
    if (!target || !text) return;
    setDmError("");
    const draftRevision = dmDraftRevisionRef.current[target.id] ?? 0;
    let frame: Record<string, unknown>;
    try {
      frame = await dmSocketFrame(target.id, text, dmReplyingTo?.id ?? null);
    } catch (error) {
      setDmError(e2eeErrorText(error, i18next.t("chat.actions.dm.encryptFailed")));
      return;
    }
    const clientMessageId = frame.clientMessageId;
    if (typeof clientMessageId !== "string") {
      discardDmSend(clientMessageId);
      setDmError(i18next.t("chat.actions.dm.prepareFailed"));
      return;
    }
    const pending: PendingSocialMessage = {
      clientMessageId,
      kind: "dm",
      conversationId: target.id,
      senderUserId: currentUser?.id ?? "",
      text,
      draftRevision,
    };
    pendingSocialMessagesRef.current.set(clientMessageId, pending);
    if (sendSocket(frame)) {
      setDmInput("");
      setDmDrafts((current) => {
        const next = { ...current };
        delete next[target.id];
        return next;
      });
      setDmReplyingTo(null);
      playUiSound("send");
      return;
    }
    pendingSocialMessagesRef.current.delete(clientMessageId);
    discardDmSend(clientMessageId);
  };

  const uploadDmAttachment = async (file: File) => {
    const target = activeDmUserRef.current;
    if (!target || dmAttachmentBusy) return;
    dmAttachmentRetryFileRef.current = file;
    dmAttachmentAbortRef.current?.abort();
    const controller = new AbortController();
    dmAttachmentAbortRef.current = controller;
    setDmAttachmentRetryName(file.name);
    setDmAttachmentBusy(true);
    setDmError("");
    setShowDmPlusMenu(false);
    try {
      // In an encrypted conversation the file is encrypted first and the server only
      // sees an anonymous blob; its name, type and key travel in the encrypted message.
      const encrypted = (await dmE2ee.peerHasKey(target.id)) ? await encryptFileForDm(file) : null;
      const response = await authorizedFetch(`${HTTP_URL}/api/dms/${encodeURIComponent(target.id)}/attachments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-File-Name": encrypted ? "encrypted" : encodeURIComponent(file.name),
          "X-File-Type": encrypted ? "application/octet-stream" : file.type || "application/octet-stream",
        },
        signal: controller.signal,
        body: encrypted ? encrypted.body : file,
      });
      const data = (await response.json()) as { attachment?: AttachmentMeta; error?: string };
      if (!response.ok || !data.attachment) {
        setDmError(apiErrorMessage(data, "client.message.uploadAttachment"));
        return;
      }
      const attachment: AttachmentMeta = encrypted
        ? {
            ...data.attachment,
            name: file.name.slice(0, 180) || "attachment",
            mimeType: file.type || "application/octet-stream",
            size: file.size,
            fileKey: encrypted.fileKey,
          }
        : data.attachment;
      const text = `${DM_ATTACHMENT_PREFIX}${JSON.stringify(attachment)}`;
      const frame = await dmSocketFrame(target.id, text, dmReplyingTo?.id ?? null);
      if (!sendSocket(frame)) {
        discardDmSend(frame.clientMessageId);
        setDmError(i18next.t("chat.actions.message.attachmentReconnecting"));
        return;
      }
      setDmReplyingTo(null);
      dmAttachmentRetryFileRef.current = null;
      setDmAttachmentRetryName("");
      playUiSound("send");
    } catch (error) {
      setDmError(
        error instanceof DOMException && error.name === "AbortError"
          ? i18next.t("chat.actions.message.uploadCanceledRetry")
          : error instanceof Error
            ? error.message
            : i18next.t("errors.client.message.uploadAttachment"),
      );
    } finally {
      setDmAttachmentBusy(false);
      if (dmAttachmentAbortRef.current === controller) dmAttachmentAbortRef.current = null;
      if (dmAttachmentInputRef.current) dmAttachmentInputRef.current.value = "";
    }
  };

  /** Record-and-send from the DM composer; rejects (keeping the preview) when it could not be sent. */
  const sendDmVoiceNote = async (draft: VoiceNoteDraft) => {
    const target = activeDmUserRef.current;
    if (!target) return;
    setDmError("");
    const { sendVoiceNote } = createVoiceNoteSender({
      baseUrl: HTTP_URL,
      fetch: authorizedFetch,
      sendDmText: async (peerId, text) => {
        const frame = await dmSocketFrame(peerId, text, dmReplyingTo?.id ?? null);
        if (!sendSocket(frame)) {
          discardDmSend(frame.clientMessageId);
          throw new Error(i18next.t("chat.actions.message.attachmentReconnecting"));
        }
        setDmReplyingTo(null);
        playUiSound("send");
      },
      sendRoomAttachment: async () => undefined,
    });
    await sendVoiceNote({ kind: "dm", id: target.id, encrypted: await dmE2ee.peerHasKey(target.id) }, draft);
  };

  const cancelDmAttachmentUpload = () => {
    dmAttachmentAbortRef.current?.abort();
    dmAttachmentAbortRef.current = null;
    setDmAttachmentBusy(false);
    setDmError(i18next.t("chat.actions.message.uploadCanceledRetry"));
  };

  const sendDmReaction = async (message: DirectMessage, emoji: string) => {
    const peerId = activeDmUserRef.current?.id ?? "";
    try {
      // On an encrypted message the whole set of this account's reactions is sealed.
      const send = async (refreshKeys: boolean) => {
        const body = await dmReactionBody(message, currentUser?.id ?? "", peerId, emoji, refreshKeys);
        const response = await authorizedFetch(
          `${HTTP_URL}/api/dms/messages/${encodeURIComponent(message.id)}/reactions`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
        );
        const data = (await response.json().catch(() => ({}))) as {
          message?: DirectMessage;
          error?: string;
          code?: string;
        };
        return { response, data };
      };
      let { response, data } = await send(false);
      if (data.code === "DM_E2EE_STALE_KEY") ({ response, data } = await send(true));
      if (!response.ok || !data.message) {
        setDmError(apiErrorMessage(data, "client.message.reaction"));
        return;
      }
      const updated = await dmE2ee.open(data.message, peerId);
      setDmMessages((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (error) {
      setDmError(
        error instanceof Error && error.name === "DmE2eeUnavailableError"
          ? e2eeErrorText(error, error.message)
          : i18next.t("errors.client.message.reaction"),
      );
    }
  };

  const startEditDirectMessage = (message: DirectMessage) => {
    if (message.fromUserId !== currentUser?.id) return;
    // A message this device can't decrypt has no text to edit.
    if (message.e2ee === "locked" || message.e2ee === "failed") return;
    setDmReplyingTo(null);
    setDmEditingId(message.id);
    setDmEditingText(message.text);
    setDmError("");
  };

  const saveEditedDirectMessage = async () => {
    const id = dmEditingId;
    const text = dmEditingText.trim();
    if (!id || !text) return;

    const target = activeDmUserRef.current;
    if (!target) return;
    try {
      const send = async (refreshKeys: boolean) => {
        const body = await dmSealedBody(target.id, text, { id, refreshKeys });
        const response = await authorizedFetch(`${HTTP_URL}/api/dms/messages/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await response.json().catch(() => ({}))) as {
          message?: DirectMessage;
          error?: string;
          code?: string;
        };
        return { response, data };
      };
      let { response, data } = await send(false);
      if (data.code === "DM_E2EE_STALE_KEY" || data.code === "DM_E2EE_REQUIRED")
        ({ response, data } = await send(true));
      if (!response.ok || !data.message) {
        setDmError(apiErrorMessage(data, "client.message.edit"));
        return;
      }
      const edited = await dmE2ee.open(data.message, target.id);
      setDmMessages((current) => current.map((item) => (item.id === id ? edited : item)));
      setDmEditingId(null);
      setDmEditingText("");
      void loadDmConversations();
    } catch (error) {
      setDmError(e2eeErrorText(error, i18next.t("errors.client.message.edit")));
    }
  };

  const deleteDirectMessage = async () => {
    const message = dmDeleteConfirm;
    if (!message) return;
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/dms/messages/${encodeURIComponent(message.id)}`, {
        method: "DELETE",
      });
      const data = (await response.json().catch(() => ({}))) as ApiError;
      if (!response.ok) {
        setDmError(apiErrorMessage(data, "client.message.delete"));
        return;
      }
      setDmMessages((current) => current.filter((item) => item.id !== message.id));
      setDmDeleteConfirm(null);
      void loadDmConversations();
    } catch {
      setDmError(i18next.t("errors.client.message.delete"));
    }
  };

  const deleteDmConversation = async () => {
    const target = dmConversationDeleteConfirm;
    if (!target) return;
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/dms/${encodeURIComponent(target.id)}`, {
        method: "DELETE",
      });
      const data = (await response.json().catch(() => ({}))) as ApiError;
      if (!response.ok) {
        setDmError(apiErrorMessage(data, "client.dm.deleteConversation"));
        return;
      }
      setDmConversationDeleteConfirm(null);
      setDmMessages([]);
      setActiveDmUser(null);
      activeDmUserRef.current = null;
      await loadDmConversations();
    } catch {
      setDmError(i18next.t("errors.client.dm.deleteConversation"));
    }
  };

  return {
    updateDmPreference,
    formatDmSidebarTime,
    loadDmConversations,
    loadGroupChats,
    openGroupChat,
    sendGroupMessage,
    sendDmVoiceNote,
    reportDmError: (message: string) => setDmError(message),
    deleteGroupMessage,
    openNewConversationComposer,
    toggleNewGroupMember,
    createGroupChat,
    addGroupMember,
    removeGroupMember,
    deleteActiveGroup,
    sendDirectMessage,
    uploadDmAttachment,
    cancelDmAttachmentUpload,
    sendDmReaction,
    startEditDirectMessage,
    saveEditedDirectMessage,
    deleteDirectMessage,
    deleteDmConversation,
  };
}

export type DirectMessageActions = ReturnType<typeof createDirectMessageActions>;
