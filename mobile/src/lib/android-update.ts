import * as Application from "expo-application";
import { Platform } from "react-native";

// Published last by website/scripts/upload-release-android.mjs, after the APK
// it points to has finished uploading. EXPO_PUBLIC_DECAVE_ANDROID_UPDATE_MANIFEST
// lets a local test build read a manifest from this machine instead.
export const ANDROID_UPDATE_MANIFEST_URL =
  process.env.EXPO_PUBLIC_DECAVE_ANDROID_UPDATE_MANIFEST || "https://downloads.de-cave.com/updates/android/latest.json";
const DOWNLOAD_ORIGIN = "https://downloads.de-cave.com/";

export type AndroidUpdate = { versionCode: number; versionName: string; url: string };

/** The installed build's versionCode, or null off Android (and in Expo Go). */
export function installedVersionCode(): number | null {
  if (Platform.OS !== "android") return null;
  const code = Number(Application.nativeBuildVersion);
  return Number.isInteger(code) && code > 0 ? code : null;
}

/** Validates the manifest; only download links on downloads.de-cave.com are offered. */
export function parseAndroidUpdate(value: unknown): AndroidUpdate | null {
  if (!value || typeof value !== "object") return null;
  const { versionCode, versionName, url } = value as Record<string, unknown>;
  if (typeof versionCode !== "number" || !Number.isInteger(versionCode) || versionCode < 1) return null;
  if (typeof versionName !== "string" || !versionName || versionName.length > 40) return null;
  if (typeof url !== "string" || !url.startsWith(DOWNLOAD_ORIGIN)) return null;
  return { versionCode, versionName, url };
}

/** The newer published APK, or null when this build is current or the check fails. */
export async function fetchAndroidUpdate(): Promise<AndroidUpdate | null> {
  const installed = installedVersionCode();
  if (installed == null) return null;
  try {
    // Android's HTTP cache revalidates and can hand back a stale manifest, so bust it.
    const response = await fetch(`${ANDROID_UPDATE_MANIFEST_URL}?t=${Date.now()}`, {
      headers: { "Cache-Control": "no-cache" },
    });
    if (!response.ok) return null;
    const update = parseAndroidUpdate(await response.json());
    return update && update.versionCode > installed ? update : null;
  } catch {
    return null;
  }
}
