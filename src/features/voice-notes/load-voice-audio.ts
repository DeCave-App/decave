import { unpadVoiceNote, type VoiceNoteMeta } from "../../../shared/voice-note.ts";

export class VoiceLoadError extends Error {}

/** Fetches the audio, decrypts it when the note is end-to-end encrypted, and removes the padding. */
export async function loadVoiceNoteBlob(opts: {
  url: string;
  meta: VoiceNoteMeta;
  decrypt: ((bytes: Uint8Array) => Uint8Array) | null;
  mime: string;
  fetchImpl?: typeof fetch;
}): Promise<Blob> {
  const res = await (opts.fetchImpl ?? fetch)(opts.url, { credentials: "include" });
  if (!res.ok) throw new VoiceLoadError(`HTTP ${res.status}`);
  let bytes: Uint8Array = new Uint8Array(await res.arrayBuffer());
  if (opts.decrypt) bytes = opts.decrypt(bytes);
  if (opts.meta.bytes !== undefined) bytes = unpadVoiceNote(bytes, opts.meta.bytes);
  return new Blob([bytes as BufferSource], { type: opts.mime });
}

export function voiceMimeFromName(name: string | undefined): string {
  const ext = (name ?? "").split(".").pop()?.toLowerCase();
  if (ext === "webm") return "audio/webm";
  if (ext === "m4a" || ext === "mp4") return "audio/mp4";
  if (ext === "ogg") return "audio/ogg";
  return "";
}

/**
 * Lazily loads one voice note into an object URL. If disposed while the load is in flight,
 * the URL is revoked and ensure() resolves null so the caller never starts playback.
 */
export function createVoiceSource(opts: {
  load: () => Promise<Blob>;
  createUrl?: (blob: Blob) => string;
  revokeUrl?: (url: string) => void;
}) {
  const createUrl = opts.createUrl ?? ((b: Blob) => URL.createObjectURL(b));
  const revokeUrl = opts.revokeUrl ?? ((u: string) => URL.revokeObjectURL(u));
  let disposed = false;
  let url: string | null = null;
  let blob: Blob | null = null;
  let pending: Promise<string | null> | null = null;

  function ensure(): Promise<string | null> {
    if (disposed) return Promise.resolve(null);
    if (url) return Promise.resolve(url);
    pending ??= opts.load().then(
      (loaded) => {
        pending = null;
        if (disposed) return null;
        blob = loaded;
        url = createUrl(loaded);
        return url;
      },
      (err) => {
        pending = null;
        throw err;
      },
    );
    return pending;
  }

  return {
    ensure,
    /** The decrypted, unpadded audio (loads it if needed). */
    async blob(): Promise<Blob | null> {
      await ensure();
      return blob;
    },
    reset() {
      if (url) revokeUrl(url);
      url = null;
      blob = null;
    },
    dispose() {
      disposed = true;
      if (url) revokeUrl(url);
      url = null;
      blob = null;
    },
  };
}
