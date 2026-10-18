// Sending a recorded voice note from the phone: upload the clip (padded and
// encrypted in end-to-end encrypted DMs), then post it as an attachment message.
// Free of React Native imports so it can be tested directly.

import { encryptAttachment, type DmFileKey } from "../../lib/e2ee/dm-e2ee.ts";
import { padVoiceNote, parseVoiceNoteMeta, voiceNoteFileName, type VoiceNoteMeta } from "../../lib/voice-note.ts";
import type { VoiceNoteDraft } from "./recorder.ts";

/** Group DMs have no attachment upload route, so only DMs and Hub rooms. */
export type VoiceNoteTarget = { kind: "dm" | "room"; id: string; encrypted: boolean };

export type UploadedVoiceFile = { id?: string; name: string; mimeType: string; size: number; url: string };
export type VoiceAttachment = UploadedVoiceFile & { fileKey?: DmFileKey; voice: VoiceNoteMeta };

export type VoiceNoteSenderDeps = {
  readBytes: (uri: string) => Promise<Uint8Array>;
  /** POST the body as application/octet-stream with these extra headers. */
  upload: (path: string, headers: Record<string, string>, body: Uint8Array) => Promise<UploadedVoiceFile>;
  sendDm: (peerId: string, text: string) => Promise<void>;
  sendRoom: (channelId: string, attachment: VoiceAttachment) => Promise<void>;
};

export const DM_ATTACHMENT_PREFIX = "__DECAVE_DM_ATTACHMENT__";

/** The `voice` field of an attachment when valid, else null (shown as a normal file). */
export function voiceAttachmentMeta(attachment: unknown): VoiceNoteMeta | null {
  if (!attachment || typeof attachment !== "object") return null;
  return parseVoiceNoteMeta((attachment as { voice?: unknown }).voice);
}

export function createVoiceNoteSender(deps: VoiceNoteSenderDeps) {
  async function sendVoiceNote(target: VoiceNoteTarget, draft: VoiceNoteDraft): Promise<void> {
    const mime = draft.mime.split(";")[0].trim().toLowerCase() || "audio/mp4";
    const name = voiceNoteFileName(mime);
    const voice: VoiceNoteMeta = { ms: draft.meta.ms, wave: draft.meta.wave };
    const plain = await deps.readBytes(draft.uri);

    if (target.kind === "room") {
      const uploaded = await deps.upload(
        `/api/channels/${encodeURIComponent(target.id)}/attachments`,
        { "X-File-Name": encodeURIComponent(name), "X-File-Type": mime, "X-Voice-Note": "1" },
        plain,
      );
      await deps.sendRoom(target.id, { ...uploaded, voice });
      return;
    }

    let attachment: VoiceAttachment;
    if (target.encrypted) {
      // Pad to 128 KB steps before encrypting so the ciphertext size hides the clip length.
      // The server sees an anonymous blob: no voice headers, name or type.
      const { fileKey, ciphertext } = encryptAttachment(padVoiceNote(plain));
      const uploaded = await deps.upload(
        `/api/dms/${encodeURIComponent(target.id)}/attachments`,
        { "X-File-Name": "encrypted", "X-File-Type": "application/octet-stream" },
        ciphertext,
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
      const uploaded = await deps.upload(
        `/api/dms/${encodeURIComponent(target.id)}/attachments`,
        { "X-File-Name": encodeURIComponent(name), "X-File-Type": mime },
        plain,
      );
      attachment = { ...uploaded, voice };
    }
    await deps.sendDm(target.id, `${DM_ATTACHMENT_PREFIX}${JSON.stringify(attachment)}`);
  }

  return { sendVoiceNote };
}
