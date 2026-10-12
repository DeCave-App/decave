// The Content-Type stored for an uploaded file comes from its bytes, never from
// the client's X-File-Type header: a file that claims to be an image but holds
// HTML or script must not be stored (and later served) as one.

/** PNG, JPEG, GIF, WebP or AVIF from the file's magic number, or null. */
export function sniffRasterImageMime(bytes: Uint8Array): string | null {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6 && (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a")) return "image/gif";
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (bytes.length >= 12 && ascii(4, 8) === "ftyp" && ascii(8, Math.min(bytes.length, 16)).includes("avif"))
    return "image/avif";
  return null;
}

/** A small set of passive image, audio and video formats, recognised from bytes. */
export function sniffSafeMediaMime(bytes: Uint8Array): string | null {
  const raster = sniffRasterImageMime(bytes);
  if (raster) return raster;
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return "audio/wav";
  if (bytes.length >= 4 && ascii(0, 4) === "OggS") return "audio/ogg";
  if (bytes.length >= 4 && ascii(0, 4) === "fLaC") return "audio/flac";
  if (bytes.length >= 3 && ascii(0, 3) === "ID3") return "audio/mpeg";
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0) return "audio/mpeg";
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3)
    return "video/webm";
  if (bytes.length >= 12 && ascii(4, 8) === "ftyp") {
    const brand = ascii(8, Math.min(bytes.length, 16));
    if (brand.includes("qt  ")) return "video/quicktime";
    if (/^(isom|iso[2-9]|mp4|avc1|M4V)/.test(brand)) return "video/mp4";
  }
  return null;
}

export class UploadTypeError extends Error {}

const OPAQUE = "application/octet-stream";

/**
 * The Content-Type to store for an uploaded attachment. Recognised media keeps
 * its real type; anything else is stored as an opaque download. A declared
 * image that is not image data is refused.
 *
 * An upload declared as application/octet-stream (or with no type) is kept
 * opaque without looking at it: end-to-end encrypted DM attachments are
 * ciphertext, and random bytes can look like a media header by chance.
 */
export function safeUploadedContentType(declaredMime: string, bytes: Uint8Array): string {
  const declared = declaredMime.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!declared || declared === OPAQUE) return OPAQUE;
  if (declared.startsWith("image/") && !sniffRasterImageMime(bytes)) {
    throw new UploadTypeError("Images must be PNG, JPG, GIF, WebP or AVIF image data.");
  }
  return sniffSafeMediaMime(bytes) ?? OPAQUE;
}

/** For image-only uploads: the sniffed type if it is one of `allowed`, else null. */
export function sniffedImageMime(bytes: Uint8Array, allowed: readonly string[]): string | null {
  const mime = sniffRasterImageMime(bytes);
  return mime && allowed.includes(mime) ? mime : null;
}
