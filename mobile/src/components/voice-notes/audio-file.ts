// Voice-note audio files on this phone. The native player needs a file, so a
// downloaded note is decrypted (E2EE DMs), unpadded, and written to the cache
// directory; the file is deleted when the bubble goes away.

import { Directory, File, Paths } from "expo-file-system";
import { fetch as expoFetch } from "expo/fetch";
import { API_BASE } from "@/src/lib/api";
import { unpadVoiceNote, type VoiceNoteMeta } from "@/src/lib/voice-note";

const PREFIX = "decave-voice-";

function extensionFor(name: string | undefined, mime: string | undefined): string {
  const fromName = (name ?? "").split(".").pop()?.toLowerCase();
  if (fromName && /^(m4a|mp4|webm|ogg|aac)$/.test(fromName)) return fromName;
  const base = (mime ?? "").split(";")[0].trim().toLowerCase();
  if (base === "audio/webm") return "webm";
  if (base === "audio/ogg") return "ogg";
  return "m4a";
}

function randomId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Downloads, decrypts and unpads a voice note; resolves the uri of a playable cache file. */
export async function loadVoiceNoteFile(opts: {
  url: string;
  token: string | null;
  meta: VoiceNoteMeta;
  decrypt: ((bytes: Uint8Array) => Uint8Array) | null;
  name?: string;
  mimeType?: string;
}): Promise<string> {
  sweepVoiceFiles();
  const href = /^https?:/i.test(opts.url) ? opts.url : `${API_BASE}${opts.url.startsWith("/") ? "" : "/"}${opts.url}`;
  const response = await expoFetch(href, {
    headers: opts.token ? { Authorization: `Bearer ${opts.token}` } : {},
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  let bytes: Uint8Array = new Uint8Array(await response.arrayBuffer());
  if (opts.decrypt) bytes = opts.decrypt(bytes);
  if (opts.meta.bytes !== undefined) bytes = unpadVoiceNote(bytes, opts.meta.bytes);
  const file = new File(Paths.cache, `${PREFIX}${randomId()}.${extensionFor(opts.name, opts.mimeType)}`);
  file.create();
  file.write(bytes);
  return file.uri;
}

export async function readVoiceFileBytes(uri: string): Promise<Uint8Array> {
  return new File(uri).bytes();
}

export function deleteVoiceFile(uri: string | null | undefined) {
  if (!uri) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    /* already gone */
  }
}

let swept = false;

/** Once per launch: remove decrypted notes left behind by a crash or a killed app. */
export function sweepVoiceFiles() {
  if (swept) return;
  swept = true;
  try {
    for (const entry of new Directory(Paths.cache).list()) {
      if (entry instanceof File && entry.name.startsWith(PREFIX)) entry.delete();
    }
  } catch {
    /* best effort */
  }
}
