// The Hub room composer: the message being written, the message it replies to
// or edits, the attachment being uploaded, and the + menu.

import { useState } from "react";
import type { ChatMessage, AttachmentMeta } from "../types";

export function useComposerState() {
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);
  const [messageInput, setMessageInput] = useState("");
  const [pendingAttachment, setPendingAttachment] = useState<AttachmentMeta | null>(null);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [attachmentError, setAttachmentError] = useState("");
  const [showComposerPlusMenu, setShowComposerPlusMenu] = useState(false);

  return {
    replyingTo,
    setReplyingTo,
    editingMessage,
    setEditingMessage,
    messageInput,
    setMessageInput,
    pendingAttachment,
    setPendingAttachment,
    attachmentBusy,
    setAttachmentBusy,
    attachmentError,
    setAttachmentError,
    showComposerPlusMenu,
    setShowComposerPlusMenu,
  };
}

export type ComposerState = ReturnType<typeof useComposerState>;
