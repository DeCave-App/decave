// Realtime session events: the session was revoked, or the server rejected a request.

import type { Dispatch, SetStateAction, MutableRefObject } from "react";
import { failNewestSending, type OutboxItem } from "../../features/outbox/outbox";
import type { AttachmentMeta } from "../../app/types";
import type { RealtimeFrame } from "../connection";

export type SessionEventContext = {
  setAuthError: Dispatch<SetStateAction<string>>;
  setOutbox: Dispatch<SetStateAction<OutboxItem<AttachmentMeta>[]>>;
  outboxRef: MutableRefObject<OutboxItem<AttachmentMeta>[]>;
  realtimeReconnectEnabledRef: MutableRefObject<boolean>;
  voiceReconnectChannelRef: MutableRefObject<number | null>;
  pendingForumPublishRef: MutableRefObject<{
    channelId: number;
    text: string;
    settle: (error: Error | null) => void;
  } | null>;
  logout: (options?: { signedOutElsewhere?: boolean }) => Promise<void>;
};

/** Returns true when the frame was handled. */
export function handleSessionEvent(data: RealtimeFrame, context: SessionEventContext): boolean {
  const {
    setAuthError,
    setOutbox,
    outboxRef,
    realtimeReconnectEnabledRef,
    voiceReconnectChannelRef,
    pendingForumPublishRef,
    logout,
  } = context;

  if (data.type === "SESSION_REVOKED") {
    realtimeReconnectEnabledRef.current = false;
    voiceReconnectChannelRef.current = null;
    const reason =
      data.reason === "signed_in_elsewhere"
        ? "Your DeCave account was signed in on another browser or desktop app."
        : "Your session was ended.";

    void logout({ signedOutElsewhere: true }).then(() => {
      setAuthError(reason);
    });
    return true;
  }

  if (data.type === "ERROR") {
    console.error("DeCave server error:", data.message);
    if (
      typeof data.message === "string" &&
      data.message &&
      outboxRef.current.some((item) => item.status === "sending")
    ) {
      const reason = data.message;
      setOutbox((current) => failNewestSending(current, reason));
    }
    pendingForumPublishRef.current?.settle(
      new Error(typeof data.message === "string" && data.message ? data.message : "The server rejected the post."),
    );
  }

  return false;
}
