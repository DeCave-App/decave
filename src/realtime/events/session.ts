// Realtime session events: the session was revoked, or the server rejected a request.

import type { Dispatch, SetStateAction, MutableRefObject } from "react";
import { failNewestSending, type OutboxItem } from "../../features/outbox/outbox";
import type { AttachmentMeta } from "../../app/types";
import type { RealtimeFrame } from "../connection";
import { i18next } from "../../i18n/index.ts";
import { realtimeErrorMessage } from "../../i18n/apiError.ts";

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
        ? i18next.t("chat.actions.session.signedInElsewhere")
        : i18next.t("chat.actions.session.ended");

    void logout({ signedOutElsewhere: true }).then(() => {
      setAuthError(reason);
    });
    return true;
  }

  if (data.type === "ERROR") {
    console.error("DeCave server error:", data.message);
    // The server's error in the UI language; empty when it sent none.
    const reason = realtimeErrorMessage(data, "");
    if (reason && outboxRef.current.some((item) => item.status === "sending")) {
      setOutbox((current) => failNewestSending(current, reason));
    }
    pendingForumPublishRef.current?.settle(new Error(reason || i18next.t("chat.actions.message.postRejected")));
  }

  return false;
}
