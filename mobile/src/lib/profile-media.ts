// Profile photo and banner: pick from the library, check the Worker's limits
// and upload as a data URL (PUT/DELETE /api/profile/avatar|banner).

import * as ImagePicker from "expo-image-picker";
import { Platform } from "react-native";
import { t } from "i18next";
import { apiJson } from "@/src/lib/api";
import type { AccountUser } from "@/src/types";

export type ProfileImageKind = "avatar" | "banner";

// The Worker's limits on the decoded image (worker/routes/profile.ts).
const MAX_BYTES: Record<ProfileImageKind, number> = { avatar: 2 * 1024 * 1024, banner: 3 * 1024 * 1024 };

// No image manipulator is bundled, so size is kept down with the picker's
// JPEG quality and the crop; a crop still over the limit is refused here.
const QUALITY: Record<ProfileImageKind, number> = { avatar: 0.6, banner: 0.7 };

/** The image type from the first bytes of base64 data; only types the Worker stores. */
function sniffImageType(base64: string): "image/jpeg" | "image/png" | "image/webp" | null {
  if (base64.startsWith("/9j/")) return "image/jpeg";
  if (base64.startsWith("iVBORw0KGgo")) return "image/png";
  if (base64.startsWith("UklGR")) return "image/webp";
  return null;
}

function decodedBytes(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/**
 * Lets the person choose and crop a photo for their avatar (square) or banner
 * (3:1, which desktop recommends). Returns a data URL ready to upload, or null
 * when they cancel. Throws a message in the app language when it can't be used.
 */
export async function pickProfileImage(kind: ProfileImageKind): Promise<string | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error(t("chat.mobile.media.photosOff"));
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    // The iOS crop is always square, so a banner is left uncropped there and
    // fills the 3:1 frame when shown.
    allowsEditing: kind === "avatar" || Platform.OS === "android",
    aspect: kind === "avatar" ? [1, 1] : [3, 1],
    quality: QUALITY[kind],
    base64: true,
    exif: false,
  });
  if (result.canceled || !result.assets?.[0]) return null;
  const base64 = result.assets[0].base64;
  if (!base64) throw new Error(t("chat.actions.profile.readImageFailed"));
  const type = sniffImageType(base64);
  if (!type) throw new Error(t("chat.actions.profile.imageType"));
  if (decodedBytes(base64) > MAX_BYTES[kind]) {
    throw new Error(kind === "avatar" ? t("chat.actions.profile.avatarTooLarge") : t("chat.actions.profile.bannerTooLarge"));
  }
  return `data:${type};base64,${base64}`;
}

/** Saves a picked image as the avatar or banner. */
export async function uploadProfileImage(kind: ProfileImageKind, imageDataUrl: string, token: string): Promise<AccountUser> {
  const data = await apiJson<{ user: AccountUser }>(
    `/api/profile/${kind}`,
    { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imageDataUrl }) },
    token,
  );
  return data.user;
}

/** Removes the avatar or banner. */
export async function removeProfileImage(kind: ProfileImageKind, token: string): Promise<AccountUser> {
  const data = await apiJson<{ user: AccountUser }>(`/api/profile/${kind}`, { method: "DELETE" }, token);
  return data.user;
}
