// Voice-note format shared by the web app, the Worker and the mobile app.
// Pure TypeScript: no DOM or Node APIs, so it runs in browsers, Workers and Hermes.
// mobile/src/lib/voice-note.ts is a byte-identical copy (node scripts/dev/sync-dm-e2ee.mjs).

export type VoiceNoteMeta = { ms: number; wave: string; bytes?: number };

export const VOICE_NOTE_MAX_MS = 120_000;
export const VOICE_NOTE_MIN_MS = 500;
export const VOICE_NOTE_MAX_BYTES = 3 * 1024 * 1024;
export const VOICE_NOTE_PAD_STEP = 128 * 1024;
export const VOICE_NOTE_BARS = 64;

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : "=";
    out += i + 2 < bytes.length ? B64[n & 63] : "=";
  }
  return out;
}

function base64ToBytes(text: string): Uint8Array | null {
  if (text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) return null;
  const pad = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
  const out = new Uint8Array((text.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < text.length; i += 4) {
    let n = 0;
    for (let j = 0; j < 4; j++) {
      const ch = text[i + j];
      n = (n << 6) | (ch === "=" ? 0 : B64.indexOf(ch));
    }
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

export function parseVoiceNoteMeta(raw: unknown): VoiceNoteMeta | null {
  if (!raw || typeof raw !== "object") return null;
  const { ms, wave, bytes } = raw as Record<string, unknown>;
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 1 || ms > VOICE_NOTE_MAX_MS) return null;
  if (typeof wave !== "string") return null;
  const decoded = base64ToBytes(wave);
  if (!decoded || decoded.length !== VOICE_NOTE_BARS) return null;
  if (bytes === undefined) return { ms, wave };
  if (typeof bytes !== "number" || !Number.isInteger(bytes) || bytes < 1 || bytes > VOICE_NOTE_MAX_BYTES) return null;
  return { ms, wave, bytes };
}

/** Zero-pads to the next multiple of 128 KB so ciphertext size doesn't leak clip length. */
export function padVoiceNote(bytes: Uint8Array): Uint8Array {
  const size = Math.max(1, Math.ceil(bytes.length / VOICE_NOTE_PAD_STEP)) * VOICE_NOTE_PAD_STEP;
  const out = new Uint8Array(size);
  out.set(bytes);
  return out;
}

export function unpadVoiceNote(bytes: Uint8Array, length: number): Uint8Array {
  if (!Number.isInteger(length) || length < 0 || length > bytes.length) {
    throw new Error("Voice note length is invalid");
  }
  return bytes.slice(0, length);
}

/** Levels 0..1 of any count, averaged into 64 bars of one byte each, base64. */
export function encodeWave(levels: readonly number[]): string {
  const bars = new Uint8Array(VOICE_NOTE_BARS);
  const n = levels.length;
  if (n > 0) {
    for (let i = 0; i < VOICE_NOTE_BARS; i++) {
      const start = Math.floor((i * n) / VOICE_NOTE_BARS);
      const end = Math.max(start + 1, Math.floor(((i + 1) * n) / VOICE_NOTE_BARS));
      let sum = 0;
      let count = 0;
      for (let j = start; j < end && j < n; j++) {
        const v = Number.isFinite(levels[j]) ? Math.min(1, Math.max(0, levels[j])) : 0;
        sum += v;
        count++;
      }
      bars[i] = Math.round((count ? sum / count : 0) * 255);
    }
  }
  return bytesToBase64(bars);
}

export function decodeWave(wave: string): number[] {
  const bytes = base64ToBytes(wave);
  const out: number[] = [];
  for (let i = 0; i < VOICE_NOTE_BARS; i++) out.push(bytes && i < bytes.length ? bytes[i] / 255 : 0);
  return out;
}

export function voiceNoteFileName(mime: string): string {
  const lower = mime.toLowerCase();
  const base = lower.split(";")[0].trim();
  if (base === "audio/mp4" && lower.includes("mp4a")) return "Voice message.m4a";
  if (base === "audio/webm") return "Voice message.webm";
  if (base === "audio/mp4") return "Voice message.mp4";
  if (base === "audio/m4a" || base === "audio/x-m4a" || base === "audio/aac") return "Voice message.m4a";
  if (base === "audio/ogg") return "Voice message.ogg";
  return "Voice message.m4a";
}

export function formatVoiceDuration(ms: number): string {
  const total = Math.max(0, Math.ceil((Number.isFinite(ms) ? ms : 0) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}
