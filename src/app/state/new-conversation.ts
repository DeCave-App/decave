// The new group conversation dialog: chosen members, name and progress.

import { useState } from "react";

export function useNewConversationState() {
  const [newGroupMemberIds, setNewGroupMemberIds] = useState<string[]>([]);
  const [newGroupName, setNewGroupName] = useState("");
  const [groupCreating, setGroupCreating] = useState(false);

  return {
    newGroupMemberIds,
    setNewGroupMemberIds,
    newGroupName,
    setNewGroupName,
    groupCreating,
    setGroupCreating,
  };
}

export type NewConversationState = ReturnType<typeof useNewConversationState>;
