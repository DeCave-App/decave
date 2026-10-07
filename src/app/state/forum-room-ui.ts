// The open forum room: which post is open, the new-post composer, the reply
// being written and its emoji picker.

import { useState } from "react";

export function useForumRoomUiState() {
  const [activeForumPostId, setActiveForumPostId] = useState<string | null>(null);
  const [forumPostComposerOpen, setForumPostComposerOpen] = useState(false);
  const [forumReplyInput, setForumReplyInput] = useState("");
  const [showForumEmojiPicker, setShowForumEmojiPicker] = useState(false);

  return {
    activeForumPostId,
    setActiveForumPostId,
    forumPostComposerOpen,
    setForumPostComposerOpen,
    forumReplyInput,
    setForumReplyInput,
    showForumEmojiPicker,
    setShowForumEmojiPicker,
  };
}

export type ForumRoomUiState = ReturnType<typeof useForumRoomUiState>;
