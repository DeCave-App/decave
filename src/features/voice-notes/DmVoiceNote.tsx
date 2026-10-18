// A voice note in a DM. "Played" lives inside each account's encrypted reactions
// envelope (`p: true`): the sender sees it when the other person's envelope says
// so; playing someone else's note marks ours (retried until the server has it).

import { useEffect, useState } from "react";
import type { VoiceNoteMeta } from "../../../shared/voice-note.ts";
import { playedByOthers } from "../../../shared/voice-played.ts";
import { sendPlayed } from "../../e2ee/dm-e2ee-client";
import { authorizedFetch } from "../../app/http";
import { HTTP_URL } from "../../app/env";
import { VoiceNoteBubble } from "./VoiceNoteBubble.tsx";
import { createWebPlayedQueue } from "./played-receipts.ts";
import { isLocallyPlayed, markLocallyPlayed } from "./played-state.ts";

type VoiceMessage = { id: string; fromUserId: string; envelope?: unknown; playedBy?: string[] };
type VoiceFile = { url: string; name?: string; mimeType?: string; fileKey?: unknown };

/** One queue for the page: marks that failed stay pending (localStorage) and are sent again. */
export const dmPlayedQueue = createWebPlayedQueue({
  sendPlayed,
  markLocal: markLocallyPlayed,
  request: async (path, init) => {
    try {
      const response = await authorizedFetch(`${HTTP_URL}${path}`, {
        method: init.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(init.body),
      });
      return { ok: response.ok, data: await response.json().catch(() => ({})) };
    } catch {
      return { ok: false };
    }
  },
});

export function DmVoiceNote({
  message,
  attachment,
  meta,
  selfId,
  conversationId,
}: {
  message: VoiceMessage;
  attachment: VoiceFile;
  meta: VoiceNoteMeta;
  selfId: string;
  conversationId: string;
}) {
  const mine = message.fromUserId === selfId;
  const [playedHere, setPlayedHere] = useState(() => isLocallyPlayed(selfId, message.id));
  // A mark that failed earlier is sent again when a note shows up.
  useEffect(() => {
    if (!mine && selfId) dmPlayedQueue.retry(selfId);
  }, [mine, selfId, message.playedBy]);

  const played = mine
    ? playedByOthers(message.playedBy, selfId)
    : playedHere || Boolean(message.playedBy?.includes(selfId));
  return (
    <VoiceNoteBubble
      conversationId={conversationId}
      messageId={message.id}
      meta={meta}
      url={`${HTTP_URL}${attachment.url}`}
      fileKey={attachment.fileKey}
      name={attachment.name}
      mime={attachment.mimeType}
      mine={mine}
      played={played}
      onPlayed={() => {
        if (mine) return;
        setPlayedHere(true);
        // Only an encrypted DM can carry the mark; a plaintext one stays local.
        if (message.envelope) dmPlayedQueue.report(selfId, message);
        else markLocallyPlayed(selfId, message.id);
      }}
    />
  );
}

/** Sends pending Played marks again when a DM opens and when the connection comes back. */
export function usePendingPlayedRetry(selfId: string | undefined, connected: boolean, activeDmId: string | undefined) {
  useEffect(() => {
    if (selfId && connected) dmPlayedQueue.retry(selfId);
  }, [selfId, connected, activeDmId]);
}
