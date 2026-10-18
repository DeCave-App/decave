// A voice note in a DM. "Played" lives inside each account's encrypted reactions
// envelope (`p: true`): the sender sees it when the other person's envelope says
// so; playing someone else's note marks ours (once, retried until accepted).

import { useEffect, useState } from "react";
import { apiFetch } from "@/src/lib/api";
import { attachmentDecrypter, sendPlayed } from "@/src/lib/e2ee/client";
import type { VoiceNoteMeta } from "@/src/lib/voice-note";
import { playedByOthers } from "@/src/lib/voice-played";
import { createPlayedReceipts, receiptRequest } from "./played";
import { isLocallyPlayed, loadPendingReceipts, markLocallyPlayed, savePendingReceipts } from "./store";
import { VoiceNoteBubble } from "./VoiceNoteBubble";

type VoiceMessage = { id: string; fromUserId: string; timestamp: string; envelope?: unknown; playedBy?: string[] };
type VoiceFile = { url: string; name?: string; mimeType?: string; fileKey?: unknown };

/** One queue for the app: marks that failed stay pending and are sent again. */
export const dmPlayedReceipts = createPlayedReceipts({
  send: (message, token, selfId) => sendPlayed(receiptRequest(apiFetch, token), message, selfId),
  markLocal: markLocallyPlayed,
  loadPending: loadPendingReceipts,
  savePending: savePendingReceipts,
});

export function DmVoiceNote({
  message,
  attachment,
  meta,
  selfId,
  token,
  conversationId,
  onSave,
}: {
  message: VoiceMessage;
  attachment: VoiceFile;
  meta: VoiceNoteMeta;
  selfId: string;
  token: string | null;
  conversationId: string;
  onSave?: () => void;
}) {
  const mine = message.fromUserId === selfId;
  const [playedHere, setPlayedHere] = useState(() => isLocallyPlayed(selfId, message.id));
  // A mark that failed earlier is sent again when its note shows up.
  useEffect(() => {
    if (!mine && token) dmPlayedReceipts.retry(selfId, token);
  }, [mine, selfId, token, message.playedBy]);

  const played = mine
    ? playedByOthers(message.playedBy, selfId)
    : playedHere || Boolean(message.playedBy?.includes(selfId));
  return (
    <VoiceNoteBubble
      conversationId={conversationId}
      messageId={message.id}
      order={Date.parse(message.timestamp) || 0}
      meta={meta}
      url={attachment.url}
      token={token}
      decrypt={attachmentDecrypter(attachment)}
      name={attachment.name}
      mimeType={attachment.mimeType}
      mine={mine}
      played={played}
      onSave={onSave}
      onPlayed={() => {
        if (mine) return;
        setPlayedHere(true);
        // Only an encrypted DM can carry the mark; a plaintext one stays on this phone.
        if (message.envelope) dmPlayedReceipts.report(selfId, message, token);
        else markLocallyPlayed(selfId, message.id);
      }}
    />
  );
}
