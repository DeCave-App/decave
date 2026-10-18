// A voice note in a Hub room: no receipts, the played state lives on this device.

import { useState } from "react";
import type { VoiceNoteMeta } from "../../../shared/voice-note.ts";
import { HTTP_URL } from "../../app/env";
import { VoiceNoteBubble } from "./VoiceNoteBubble.tsx";
import { isLocallyPlayed, markLocallyPlayed } from "./played-state.ts";

export function HubVoiceNote({
  messageId,
  channelId,
  attachment,
  meta,
  selfId,
  mine,
}: {
  messageId: string;
  channelId: string;
  attachment: { url: string; name?: string; mimeType?: string };
  meta: VoiceNoteMeta;
  selfId: string;
  mine: boolean;
}) {
  const [played, setPlayed] = useState(() => isLocallyPlayed(selfId, messageId));
  return (
    <VoiceNoteBubble
      conversationId={`room:${channelId}`}
      messageId={messageId}
      meta={meta}
      url={`${HTTP_URL}${attachment.url}`}
      name={attachment.name}
      mime={attachment.mimeType}
      mine={mine}
      played={played}
      onPlayed={() => {
        markLocallyPlayed(selfId, messageId);
        setPlayed(true);
      }}
    />
  );
}
