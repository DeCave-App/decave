// Sending a recorded voice note: upload the clip (padded and encrypted for
// end-to-end encrypted conversations), then post it as an attachment message.
// Kept free of React and DOM state so it can be tested directly.

import { encryptAttachment, type DmFileKey } from "../../../shared/dm-e2ee.ts";
import { padVoiceNote, parseVoiceNoteMeta, voiceNoteFileName, type VoiceNoteMeta } from "../../../shared/voice-note.ts";
import type { VoiceNoteDraft } from "./useVoiceRecorder.ts";

export type VoiceNoteTarget = { kind: "dm" | "group" | "room"; id: string; encrypted: boolean };

type UploadedAttachment = { id: string; name: string; mimeType: string; size: number; url: string };
export type VoiceAttachment = UploadedAttachment & { fileKey?: DmFileKey; voice: VoiceNoteMeta };

export type VoiceNoteSenderDeps = {
  baseUrl: string;
  fetch: (url: string, init: RequestInit & { headers: Record<string, string> }) => Promise<Response>;
  /** Send a DM text (sealed when the conversation is encrypted). Rejects when it could not be sent. */
  sendDmText: (peerId: string, text: string) => Promise<void>;
  /** Post a Hub room message carrying only the attachment. */
  sendRoomAttachment: (channelId: string, attachment: VoiceAttachment) => Promise<void>;
};

export const DM_ATTACHMENT_PREFIX = "__DECAVE_DM_ATTACHMENT__";

/** The `voice` field of an attachment when it is valid, else null (shown as a normal attachment). */
export function voiceAttachmentMeta(attachment: unknown): VoiceNoteMeta | null {
  if (!attachment || typeof attachment !== "object") return null;
  return parseVoiceNoteMeta((attachment as { voice?: unknown }).voice);
}

/** The mic button replaces nothing: it shows beside send only while there is no text to send. */
export function micButtonVisible(text: string, hasOtherContent = false): boolean {
  return !hasOtherContent && text.trim() === "";
}

export class VoiceNoteSendError extends Error {
  constructor(readonly body: { code?: string; error?: string }) {
    super(body.error || "Voice message upload failed");
  }
}

export function createVoiceNoteSender(deps: VoiceNoteSenderDeps) {
  async function upload(path: string, headers: Record<string, string>, body: Blob): Promise<UploadedAttachment> {
    const response = await deps.fetch(`${deps.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream", ...headers },
      body,
    });
    const data = (await response.json().catch(() => ({}))) as {
      attachment?: UploadedAttachment;
      code?: string;
      error?: string;
    };
    if (!response.ok || !data.attachment) throw new VoiceNoteSendError(data);
    return data.attachment;
  }

  async function sendVoiceNote(target: VoiceNoteTarget, draft: VoiceNoteDraft): Promise<void> {
    const mime = draft.mime.split(";")[0].trim().toLowerCase() || "audio/webm";
    const name = voiceNoteFileName(draft.mime);
    const voice: VoiceNoteMeta = { ms: draft.meta.ms, wave: draft.meta.wave };

    if (target.kind === "room") {
      const uploaded = await upload(
        `/api/channels/${encodeURIComponent(target.id)}/attachments`,
        { "X-File-Name": encodeURIComponent(name), "X-File-Type": mime, "X-Voice-Note": "1" },
        draft.blob,
      );
      await deps.sendRoomAttachment(target.id, { ...uploaded, voice });
      return;
    }
    if (target.kind === "group") {
      // Group chats have no attachment upload route yet.
      throw new VoiceNoteSendError({ code: "VOICE_NOTE_GROUP_UNSUPPORTED" });
    }

    let attachment: VoiceAttachment;
    if (target.encrypted) {
      // Pad to 128 KB steps before encrypting so the ciphertext size hides the clip length.
      const plain = new Uint8Array(await draft.blob.arrayBuffer());
      const { fileKey, ciphertext } = encryptAttachment(padVoiceNote(plain));
      const uploaded = await upload(
        `/api/dms/${encodeURIComponent(target.id)}/attachments`,
        { "X-File-Name": "encrypted", "X-File-Type": "application/octet-stream" },
        new Blob([ciphertext as BufferSource]),
      );
      attachment = {
        ...uploaded,
        name,
        mimeType: mime,
        size: plain.length,
        fileKey,
        voice: { ...voice, bytes: plain.length },
      };
    } else {
      const uploaded = await upload(
        `/api/dms/${encodeURIComponent(target.id)}/attachments`,
        { "X-File-Name": encodeURIComponent(name), "X-File-Type": mime },
        draft.blob,
      );
      attachment = { ...uploaded, voice };
    }
    await deps.sendDmText(target.id, `${DM_ATTACHMENT_PREFIX}${JSON.stringify(attachment)}`);
  }

  return { sendVoiceNote };
}
