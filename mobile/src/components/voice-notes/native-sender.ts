// The phone's voice-note sender: reads the recording file and uploads with the
// session token. The screens supply how the final message is posted.

import { fetch as expoFetch } from "expo/fetch";
import { t } from "i18next";
import { API_BASE, apiErrorText } from "@/src/lib/api";
import { readVoiceFileBytes } from "./audio-file";
import { createVoiceNoteSender, type UploadedVoiceFile, type VoiceAttachment } from "./send";

export function nativeVoiceNoteSender(opts: {
  token: string;
  sendDm?: (peerId: string, text: string) => Promise<void>;
  sendRoom?: (channelId: string, attachment: VoiceAttachment) => Promise<void>;
}) {
  return createVoiceNoteSender({
    readBytes: readVoiceFileBytes,
    upload: async (path, headers, body) => {
      const response = await expoFetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${opts.token}`, "Content-Type": "application/octet-stream", ...headers },
        body: body as Uint8Array<ArrayBuffer>,
      });
      const data = (await response.json().catch(() => ({}))) as { attachment?: UploadedVoiceFile; code?: unknown; error?: unknown };
      if (!response.ok || !data.attachment) throw new Error(apiErrorText(data, t("chat.voice.sendFailed")));
      return data.attachment;
    },
    sendDm: opts.sendDm ?? (async () => undefined),
    sendRoom: opts.sendRoom ?? (async () => undefined),
  });
}
