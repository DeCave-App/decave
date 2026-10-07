// Required artwork dimensions for Hub media, shared by the web client (pre-upload
// validation + Manage Hub hints) and the worker (authoritative upload check).
//
// Banner: painted full-height behind the left Hub sidebar with background-size:
// cover. The sidebar is 240-300 CSS px wide and ~800-1400 px tall, i.e. an aspect
// of roughly 0.24-0.35, so a 1:3 portrait image (600x1800 = 300x900 @2x) covers
// every layout while cropping at most ~28% of the width on very tall windows.
// Chat background: painted behind the message list (landscape, 16:9 desktop).

export type HubMediaKind = "icon" | "banner" | "chat-background";

export type HubMediaSpec = {
  /** Recommended (ideal) size in pixels. */
  width: number;
  height: number;
  /** Smallest accepted size in pixels (same aspect). */
  minWidth: number;
  minHeight: number;
  orientation: "portrait" | "landscape";
  label: string;
};

/** Accepted deviation from the required aspect ratio (±5%). */
export const HUB_MEDIA_ASPECT_TOLERANCE = 0.05;

export const HUB_MEDIA_SPECS: Record<Exclude<HubMediaKind, "icon">, HubMediaSpec> = {
  banner: { width: 600, height: 1800, minWidth: 400, minHeight: 1200, orientation: "portrait", label: "Banner" },
  "chat-background": {
    width: 1920,
    height: 1080,
    minWidth: 1280,
    minHeight: 720,
    orientation: "landscape",
    label: "Chat background",
  },
};

export function hubMediaHint(kind: Exclude<HubMediaKind, "icon">): string {
  const spec = HUB_MEDIA_SPECS[kind];
  return `Recommended: ${spec.width}×${spec.height} px, ${spec.orientation} (minimum ${spec.minWidth}×${spec.minHeight})`;
}

/** Returns a user-facing error, or null when the size is acceptable. */
export function validateHubMediaDimensions(kind: HubMediaKind, width: number, height: number): string | null {
  if (kind === "icon") return null;
  const spec = HUB_MEDIA_SPECS[kind];
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return `${spec.label} image size could not be read. Use a PNG, JPG, WebP or GIF of ${spec.width}×${spec.height} px.`;
  }
  const required = spec.width / spec.height;
  const actual = width / height;
  const deviation = Math.abs(actual - required) / required;
  const shape = `${spec.width}×${spec.height} px ${spec.orientation}`;
  if (deviation > HUB_MEDIA_ASPECT_TOLERANCE) {
    return `${spec.label} is ${width}×${height} px. It must be ${shape} (aspect ${aspectLabel(spec)}, ±5%).`;
  }
  if (width < spec.minWidth || height < spec.minHeight) {
    return `${spec.label} is ${width}×${height} px, which is too small. Use ${shape} (at least ${spec.minWidth}×${spec.minHeight}).`;
  }
  return null;
}

function aspectLabel(spec: HubMediaSpec): string {
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const d = gcd(spec.width, spec.height);
  return `${spec.width / d}:${spec.height / d}`;
}

/** Cheap header-only dimension sniffing for PNG, GIF, JPEG and WebP. */
export function readImageDimensions(input: ArrayBuffer | Uint8Array): { width: number; height: number } | null {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  const u16be = (o: number) => (b[o] << 8) | b[o + 1];
  const u16le = (o: number) => b[o] | (b[o + 1] << 8);
  const u24le = (o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
  const u32be = (o: number) => ((b[o] << 24) >>> 0) + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { width: u32be(16), height: u32be(20) };
  }
  if (b.length >= 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
    return { width: u16le(6), height: u16le(8) };
  }
  if (
    b.length >= 30 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  ) {
    const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (chunk === "VP8X") return { width: u24le(24) + 1, height: u24le(27) + 1 };
    if (chunk === "VP8 ") return { width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff };
    if (chunk === "VP8L") {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    return null;
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let o = 2;
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) {
        o += 1;
        continue;
      }
      const marker = b[o + 1];
      if (marker === 0xff) {
        o += 1;
        continue;
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        o += 2;
        continue;
      }
      const length = u16be(o + 2);
      if (length < 2) return null;
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) return { width: u16be(o + 7), height: u16be(o + 5) };
      o += 2 + length;
    }
    return null;
  }
  return null;
}
