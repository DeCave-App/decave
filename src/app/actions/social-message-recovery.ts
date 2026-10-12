export type PendingSocialMessage = {
  clientMessageId: string;
  kind: "dm" | "group";
  conversationId: string;
  senderUserId: string;
  text: string;
  draftRevision: number;
};

export type SocialMessage = { id: string; timestamp: string };

/** Keep realtime messages received while a history request was in flight. */
export function mergeConversationHistory<T extends SocialMessage>(
  history: T[],
  current: T[],
  belongsToConversation: (message: T) => boolean,
): T[] {
  const messages = new Map<string, { message: T; order: number }>();
  let order = 0;
  for (const message of history) {
    if (!belongsToConversation(message)) continue;
    messages.set(message.id, { message, order: order++ });
  }
  for (const message of current) {
    if (!belongsToConversation(message)) continue;
    messages.set(message.id, { message, order: order++ });
  }
  return [...messages.values()]
    .sort((left, right) => {
      const leftTime = Date.parse(left.message.timestamp);
      const rightTime = Date.parse(right.message.timestamp);
      if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime)
        return leftTime - rightTime;
      return left.order - right.order;
    })
    .map(({ message }) => message);
}

export function restoreDraftIfUnchanged(
  currentDraft: string | undefined,
  currentRevision: number | undefined,
  sentRevision: number,
  failedText: string,
): { restored: true; value: string } | { restored: false; value: string | undefined } {
  if ((currentRevision ?? 0) !== sentRevision || currentDraft?.trim()) {
    return { restored: false, value: currentDraft };
  }
  return { restored: true, value: failedText };
}
