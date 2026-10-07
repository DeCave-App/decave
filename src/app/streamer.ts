// Streamer Hub capability flags and local media paths.

import { localMediaPath } from "../../shared/streamer-mode";
import type { Server } from "./types";
import { HTTP_URL } from "./env";

const STREAMER_HUBS_ENABLED_FLAG = "STREAMER_HUBS_ENABLED";

function capabilityFlagValue(value: unknown, flag: string): boolean | undefined {
  const normalizedFlag = flag.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;
    return normalized.replace(/[^a-z0-9]/g, "") === normalizedFlag ? true : undefined;
  }
  if (Array.isArray(value)) {
    return value.some((item) => capabilityFlagValue(item, flag) === true) ? true : false;
  }
  if (!value || typeof value !== "object") return undefined;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key.toLowerCase().replace(/[^a-z0-9]/g, "") !== normalizedFlag) continue;
    return capabilityFlagValue(item, flag);
  }
  return undefined;
}

function serverCapabilityFlag(server: Server, flag: string): boolean | undefined {
  const raw = server as unknown as Record<string, unknown>;
  const direct = capabilityFlagValue(raw[flag], flag) ?? capabilityFlagValue(raw.streamerHubsEnabled, flag);
  if (direct !== undefined) return direct;
  for (const key of ["capabilities", "features", "serverCapabilities"]) {
    const nested = capabilityFlagValue(raw[key], flag);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

export function isStreamerServer(server: Server, bootstrapEnabled: boolean): boolean {
  return (
    bootstrapEnabled === true &&
    server.layout === "streamer" &&
    serverCapabilityFlag(server, STREAMER_HUBS_ENABLED_FLAG) !== false
  );
}

/** Adapt the current Hub artwork route to the package's validated media path. */
export function streamerLocalMediaPath(value?: string | null): string {
  const raw = value?.trim() ?? "";
  if (!raw) return "";
  let candidate = raw;
  if (raw.startsWith("/uploads/hub-media/")) {
    const artworkPath = raw.split(/[?#]/, 1)[0];
    let key: string;
    try {
      key = decodeURIComponent(artworkPath.slice("/uploads/".length));
    } catch {
      return "";
    }
    if (!/^[a-zA-Z0-9_./~-]+$/.test(key) || key.split("/").some((part) => !part || part === "." || part === ".."))
      return "";
    candidate = `/api/media/${encodeURIComponent(key)}`;
  }
  if (!candidate.startsWith("/api/media/")) return "";
  try {
    return localMediaPath(candidate);
  } catch {
    return "";
  }
}

/** Resolve only validated, root-relative media paths on the current origin. */
export function streamerMediaUrl(path: string): string {
  if (!path.startsWith("/api/media/")) return "";
  try {
    const base = new URL(HTTP_URL);
    const target = new URL(path, base);
    if (target.origin !== base.origin || target.pathname !== path.split("?", 1)[0]) return "";
    return target.toString();
  } catch {
    return "";
  }
}
