import * as ImagePicker from "expo-image-picker";
import { API_BASE } from "@/src/lib/api";

export const GIF_PREFIX = "__DECAVE_GIF__";
export const DM_ATTACHMENT_PREFIX = "__DECAVE_DM_ATTACHMENT__";

export type GifPayload = { id: string; title?: string; url: string };
export type GiphyGif = { id: string; title: string; url: string; previewUrl: string; width?: number; height?: number };
export type UploadedAttachment = { id?: string; name: string; mimeType: string; size: number; url: string };

/** Only GIPHY-hosted https URLs are rendered or sent, matching the web client. */
export function safeGiphyUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value, `${API_BASE}/`);
    const trusted = (source: URL) => {
      const host = source.hostname.toLowerCase();
      return source.protocol === "https:" && !source.port && !source.username && !source.password &&
        (["media.giphy.com", "media0.giphy.com", "media1.giphy.com", "media2.giphy.com", "media3.giphy.com", "media4.giphy.com"].includes(host) ||
          (host === "giphy.com" && source.pathname.startsWith("/media/")));
    };
    if (parsed.origin === API_BASE && parsed.pathname === "/api/giphy/media") {
      return trusted(new URL(parsed.searchParams.get("url") || "")) ? parsed.toString() : null;
    }
    if (!trusted(parsed)) return null;
    const proxy = new URL(`${API_BASE}/api/giphy/media`);
    proxy.searchParams.set("url", parsed.toString());
    return proxy.toString();
  } catch {
    return null;
  }
}

export function parseGif(text: string): GifPayload | null {
  if (!text.startsWith(GIF_PREFIX)) return null;
  try {
    const payload = JSON.parse(text.slice(GIF_PREFIX.length)) as GifPayload;
    const url = safeGiphyUrl(payload.url);
    return url ? { ...payload, url } : null;
  } catch {
    return null;
  }
}

export function gifMessageText(gif: GiphyGif): string | null {
  const url = safeGiphyUrl(gif.url);
  if (!url) return null;
  return `${GIF_PREFIX}${JSON.stringify({ id: gif.id, title: gif.title, url } satisfies GifPayload)}`;
}

export function isImageMime(mime: string | undefined): boolean {
  return !!mime && /^image\/(png|jpe?g|gif|webp|heic|heif)$/i.test(mime);
}

export function mediaUrl(path: string): string {
  return /^https?:/i.test(path) ? path : `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
}

/**
 * Lets the person choose a photo or video from the library or camera.
 * Returns null when they cancel or deny permission.
 */
export async function pickMedia(source: "library" | "camera"): Promise<ImagePicker.ImagePickerAsset | null> {
  const permission =
    source === "camera"
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error(source === "camera" ? "Camera access is off for DeCave. Turn it on in Settings." : "Photo access is off for DeCave. Turn it on in Settings.");
  }
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images", "videos"], quality: 0.85, exif: false };
  const result = source === "camera" ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || !result.assets?.[0]) return null;
  return result.assets[0];
}

/** Uploads a picked asset to a channel or DM attachment endpoint. */
export async function uploadAsset(
  target: { kind: "channel"; channelId: number } | { kind: "dm"; userId: string },
  asset: ImagePicker.ImagePickerAsset,
  token: string,
): Promise<UploadedAttachment> {
  const name = asset.fileName || `photo-${Date.now()}.${asset.mimeType?.split("/")[1] ?? "jpg"}`;
  const mime = asset.mimeType || (asset.type === "video" ? "video/mp4" : "image/jpeg");
  if (asset.fileSize && asset.fileSize > 25 * 1024 * 1024) throw new Error("Attachments can be up to 25 MB.");

  const fileResponse = await fetch(asset.uri);
  const blob = await fileResponse.blob();
  const path =
    target.kind === "channel"
      ? `/api/channels/${target.channelId}/attachments`
      : `/api/dms/${encodeURIComponent(target.userId)}/attachments`;

  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
      "X-File-Name": encodeURIComponent(name),
      "X-File-Type": mime,
    },
    body: blob,
  });
  const data = (await response.json().catch(() => ({}))) as { attachment?: UploadedAttachment; error?: string };
  if (!response.ok || !data.attachment) throw new Error(data.error || "Could not upload the attachment.");
  return data.attachment;
}
