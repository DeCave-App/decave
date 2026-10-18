// A voice note in a Hub room: no receipts, the played state lives on this phone.

import { useState } from "react";
import type { VoiceNoteMeta } from "@/src/lib/voice-note";
import { isLocallyPlayed, markLocallyPlayed } from "./store";
import { VoiceNoteBubble } from "./VoiceNoteBubble";

export function HubVoiceNote({
  messageId,
  channelId,
  timestamp,
  attachment,
  meta,
  selfId,
  mine,
  token,
  onSave,
}: {
  messageId: string;
  channelId: number | string;
  timestamp: string;
  attachment: { url: string; name?: string; mimeType?: string };
  meta: VoiceNoteMeta;
  selfId: string;
  mine: boolean;
  token: string | null;
  onSave?: () => void;
}) {
  const [played, setPlayed] = useState(() => isLocallyPlayed(selfId, messageId));
  return (
    <VoiceNoteBubble
      conversationId={`room:${channelId}`}
      messageId={messageId}
      order={Date.parse(timestamp) || 0}
      meta={meta}
      url={attachment.url}
      token={token}
      name={attachment.name}
      mimeType={attachment.mimeType}
      mine={mine}
      played={played}
      onSave={onSave}
      onPlayed={() => {
        markLocallyPlayed(selfId, messageId);
        setPlayed(true);
      }}
    />
  );
}
