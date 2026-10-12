// Per-frame AES-GCM-128 for screen-share video sent through the SFU.
// Layout (LiveKit FrameCryptor compatible):
//   [clear header][ciphertext+tag][12-byte IV][1 byte IV length = 12][1 byte key index]
// Frame key = HKDF-SHA-256(streamKey, salt "DeCaveScreenSfuSalt", info "DeCaveScreenSfuFrameKey") -> AES-GCM 128.
// The clear header is authenticated as AES-GCM additionalData. Pure WebCrypto, safe inside a worker.

export type ScreenCodec = "vp8" | "vp9" | "h264" | "av1";
export type FrameOpts = { codec: ScreenCodec; keyFrame: boolean };

const SALT = new TextEncoder().encode("DeCaveScreenSfuSalt");
const INFO = new TextEncoder().encode("DeCaveScreenSfuFrameKey");
const IV_LEN = 12;
const TRAILER_LEN = IV_LEN + 2;
const TAG_LEN = 16;

export class ScreenFrameKeyring {
  currentIndex: number | null = null;
  private keys = new Map<number, CryptoKey>();

  async setKey(index: number, streamKey: Uint8Array): Promise<void> {
    const base = await crypto.subtle.importKey("raw", streamKey as BufferSource, "HKDF", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey(
      { name: "HKDF", hash: "SHA-256", salt: SALT, info: INFO },
      base,
      { name: "AES-GCM", length: 128 },
      false,
      ["encrypt", "decrypt"],
    );
    const prev = this.currentIndex;
    this.keys.set(index, key);
    this.currentIndex = index;
    // Keep only current + previous.
    for (const k of [...this.keys.keys()]) {
      if (k !== index && k !== prev) this.keys.delete(k);
    }
  }

  get(index: number): CryptoKey | undefined {
    return this.keys.get(index);
  }
}

// Bytes at the start of the frame that must stay readable by the SFU/packetizer.
export function unencryptedBytes(data: Uint8Array, codec: ScreenCodec, keyFrame: boolean): number {
  let n = 0;
  if (codec === "vp8") n = keyFrame ? 10 : 3;
  else if (codec === "h264") n = h264ClearBytes(data);
  return Math.min(n, data.length);
}

// LiveKit rule: find Annex-B NAL units; clear through the header of the first slice NAL (type 1 or 5).
function h264ClearBytes(data: Uint8Array): number {
  let zeros = 0;
  for (let i = 0; i < data.length; i++) {
    const b = data[i];
    if (b === 0) {
      zeros++;
    } else {
      if (b === 1 && zeros >= 2 && i + 1 < data.length) {
        const type = data[i + 1] & 0x1f;
        if (type === 1 || type === 5) return i + 2;
      }
      zeros = 0;
    }
  }
  return 0;
}

export async function encryptFrame(data: ArrayBuffer, opts: FrameOpts, keyring: ScreenFrameKeyring): Promise<ArrayBuffer> {
  const index = keyring.currentIndex;
  const key = index === null ? undefined : keyring.get(index);
  if (index === null || !key) throw new Error("no frame key");
  const src = new Uint8Array(data);
  const clear = unencryptedBytes(src, opts.codec, opts.keyFrame);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const header = src.subarray(0, clear);
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: header, tagLength: 128 }, key, src.subarray(clear)),
  );
  const out = new Uint8Array(clear + cipher.length + TRAILER_LEN);
  out.set(header, 0);
  out.set(cipher, clear);
  out.set(iv, clear + cipher.length);
  out[out.length - 2] = IV_LEN;
  out[out.length - 1] = index & 0xff;
  return out.buffer;
}

// Returns null when the frame can't be authenticated; callers must drop it.
export async function decryptFrame(data: ArrayBuffer, opts: FrameOpts, keyring: ScreenFrameKeyring): Promise<ArrayBuffer | null> {
  const src = new Uint8Array(data);
  const clear = unencryptedBytes(src, opts.codec, opts.keyFrame);
  if (src.length < clear + TAG_LEN + TRAILER_LEN) return null;
  if (src[src.length - 2] !== IV_LEN) return null;
  const key = keyring.get(src[src.length - 1]);
  if (!key) return null;
  const ivStart = src.length - TRAILER_LEN;
  const iv = src.subarray(ivStart, ivStart + IV_LEN);
  try {
    const header = src.subarray(0, clear);
    const plain = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv, additionalData: header, tagLength: 128 },
        key,
        src.subarray(clear, ivStart),
      ),
    );
    const out = new Uint8Array(clear + plain.length);
    out.set(header, 0);
    out.set(plain, clear);
    return out.buffer;
  } catch {
    return null;
  }
}
