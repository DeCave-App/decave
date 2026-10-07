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
import { HISTORY_PAGE_SIZE } from "../constants";
import { DM_ATTACHMENT_PREFIX } from "../message-payloads";
import type { NewConversationState } from "../state/new-conversation";

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
        setDmError(data.error || "Could not update this conversation.");
      }
    } catch {
      setDmPreferences((current) => ({ ...current, [userId]: previous }));
      setDmError("Could not update this conversation.");
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
    if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
    const days = Math.max(1, Math.floor(age / 86400000));
    if (days < 7) return `${days}d ago`;
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
      setDmConversations(Array.isArray(data.conversations) ? data.conversations : []);
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
      setGroupChats(Array.isArray(data.groups) ? data.groups : []);
    } catch (error) {
      console.error("Could not load group chats:", error);
      setGroupChats([]);
    }
  };

  const openGroupChat = async (group: GroupChat) => {
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
    setGroupInput("");
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
        setGroupError(data.error || "Could not open group chat.");
        return;
      }
      setActiveGroupChat(data.group);
      activeGroupChatRef.current = data.group;
      const firstGroupPage = Array.isArray(data.messages) ? data.messages : [];
      setGroupMessages(firstGroupPage);
      setOlderHistory((current) => ({ ...current, group: firstGroupPage.length >= HISTORY_PAGE_SIZE }));
      void loadGroupChats();
    } catch (error) {
      if (loadGeneration !== groupHistoryLoadGenerationRef.current || activeGroupChatRef.current?.id !== group.id)
        return;
      console.error("Could not load group chat:", error);
      setGroupError("Could not open group chat.");
    }
  };

  const sendGroupMessage = async () => {
    const group = activeGroupChatRef.current;
    const text = groupInput.trim();
    if (!group || !text) return;
    setGroupError("");
    if (sendSocket({ type: "GROUP_MESSAGE", groupId: group.id, text, replyToId: groupReplyingTo?.id ?? null })) {
      setGroupInput("");
      setGroupReplyingTo(null);
      return;
    }
  };

  const deleteGroupMessage = async (message: GroupChatMessage) => {
    const group = activeGroupChatRef.current;
    if (!group) return;
    const canDelete = message.fromUserId === currentUser?.id || group.ownerUserId === currentUser?.id;
    if (!canDelete || !window.confirm("Delete this message? This cannot be undone.")) return;
    setGroupError("");
    try {
      const response = await authorizedFetch(
        `${HTTP_URL}/api/groups/${encodeURIComponent(group.id)}/messages/${encodeURIComponent(message.id)}`,
        { method: "DELETE" },
      );
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setGroupError(data.error || "Could not delete message.");
        return;
      }
      setGroupMessages((current) => current.filter((item) => item.id !== message.id));
      void loadGroupChats();
    } catch (error) {
      console.error("Could not delete group message:", error);
      setGroupError("Could not delete message.");
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
        setGroupError(data.error || "Could not create group chat.");
        return;
      }
      setShowNewConversation(false);
      await loadGroupChats();
      await openGroupChat(data.group);
    } catch (error) {
      console.error("Could not create group chat:", error);
      setGroupError("Could not create group chat.");
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
        setGroupError(data.error || "Could not add member.");
        return;
      }
      setActiveGroupChat(data.group);
      activeGroupChatRef.current = data.group;
      await loadGroupChats();
    } catch {
      setGroupError("Could not add member.");
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
        setGroupError(data.error || "Could not remove member.");
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
      setGroupError("Could not remove member.");
    }
  };

  const deleteActiveGroup = async () => {
    const group = activeGroupChatRef.current;
    if (!group || group.ownerUserId !== currentUser?.id) return;
    if (!window.confirm(`Delete “${group.name}” for everyone? This cannot be undone.`)) return;
    setGroupError("");
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/groups/${encodeURIComponent(group.id)}`, {
        method: "DELETE",
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setGroupError(data.error || "Could not delete group.");
        return;
      }
      setShowGroupMembers(false);
      setActiveGroupChat(null);
      activeGroupChatRef.current = null;
      setGroupMessages([]);
      await Promise.all([loadGroupChats(), loadServers()]);
    } catch {
      setGroupError("Could not delete group.");
    }
  };

  const sendDirectMessage = async () => {
    const target = activeDmUserRef.current;
    const text = dmInput.trim();
    if (!target || !text) return;
    setDmError("");
    if (sendSocket({ type: "DM_MESSAGE", targetUserId: target.id, text, replyToId: dmReplyingTo?.id ?? null })) {
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
      const response = await authorizedFetch(`${HTTP_URL}/api/dms/${encodeURIComponent(target.id)}/attachments`, {
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
        setDmError(data.error || "Could not upload attachment.");
        return;
      }
      const text = `${DM_ATTACHMENT_PREFIX}${JSON.stringify(data.attachment)}`;
      if (!sendSocket({ type: "DM_MESSAGE", targetUserId: target.id, text, replyToId: dmReplyingTo?.id ?? null })) {
        setDmError("Realtime is reconnecting. Try the attachment again in a moment.");
        return;
      }
      setDmReplyingTo(null);
      dmAttachmentRetryFileRef.current = null;
      setDmAttachmentRetryName("");
      playUiSound("send");
    } catch (error) {
      setDmError(
        error instanceof DOMException && error.name === "AbortError"
          ? "Upload canceled. You can retry the same file."
          : error instanceof Error
            ? error.message
            : "Could not upload attachment.",
      );
    } finally {
      setDmAttachmentBusy(false);
      if (dmAttachmentAbortRef.current === controller) dmAttachmentAbortRef.current = null;
      if (dmAttachmentInputRef.current) dmAttachmentInputRef.current.value = "";
    }
  };

  const cancelDmAttachmentUpload = () => {
    dmAttachmentAbortRef.current?.abort();
    dmAttachmentAbortRef.current = null;
    setDmAttachmentBusy(false);
    setDmError("Upload canceled. You can retry the same file.");
  };

  const sendDmReaction = async (message: DirectMessage, emoji: string) => {
    try {
      const response = await authorizedFetch(
        `${HTTP_URL}/api/dms/messages/${encodeURIComponent(message.id)}/reactions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ emoji }),
        },
      );
      const data = (await response.json().catch(() => ({}))) as {
        message?: DirectMessage;
        error?: string;
      };
      if (!response.ok || !data.message) {
        setDmError(data.error || "Could not update reaction.");
        return;
      }
      setDmMessages((current) => current.map((item) => (item.id === data.message!.id ? data.message! : item)));
    } catch {
      setDmError("Could not update reaction.");
    }
  };

  const startEditDirectMessage = (message: DirectMessage) => {
    if (message.fromUserId !== currentUser?.id) return;
    setDmReplyingTo(null);
    setDmEditingId(message.id);
    setDmEditingText(message.text);
    setDmError("");
  };

  const saveEditedDirectMessage = async () => {
    const id = dmEditingId;
    const text = dmEditingText.trim();
    if (!id || !text) return;

    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/dms/messages/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        message?: DirectMessage;
        error?: string;
      };
      if (!response.ok || !data.message) {
        setDmError(data.error || "Could not edit message.");
        return;
      }
      setDmMessages((current) => current.map((item) => (item.id === id ? data.message! : item)));
      setDmEditingId(null);
      setDmEditingText("");
      void loadDmConversations();
    } catch (error) {
      setDmError(error instanceof Error ? error.message : "Could not edit message.");
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
        setDmError(data.error || "Could not delete message.");
        return;
      }
      setDmMessages((current) => current.filter((item) => item.id !== message.id));
      setDmDeleteConfirm(null);
      void loadDmConversations();
    } catch {
      setDmError("Could not delete message.");
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
        setDmError(data.error || "Could not delete conversation.");
        return;
      }
      setDmConversationDeleteConfirm(null);
      setDmMessages([]);
      setActiveDmUser(null);
      activeDmUserRef.current = null;
      await loadDmConversations();
    } catch {
      setDmError("Could not delete conversation.");
    }
  };

  return {
    updateDmPreference,
    formatDmSidebarTime,
    loadDmConversations,
    loadGroupChats,
    openGroupChat,
    sendGroupMessage,
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
