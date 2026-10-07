// Where the client is running and which server it talks to.

import { detectPlatform } from "../features/settings/extraSettings";

/** "windows" | "mac" | "linux" | "other", for platform-specific settings copy. */
export const CLIENT_PLATFORM =
  typeof navigator === "undefined"
    ? "other"
    : detectPlatform(
        navigator.userAgent,
        (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
          navigator.platform ??
          "",
      );

export const HTTP_URL = window.location.origin;
export const WS_URL = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws`;
export const HUB_SHARE_ROUTE_PREFIX = "/join/hub/";

export function hubShareCodeFromLocation(): string {
  const match = window.location.pathname.match(/^\/join\/hub\/([^/]+)\/?$/i);
  if (!match?.[1]) return "";
  try {
    return decodeURIComponent(match[1]).trim();
  } catch {
    return "";
  }
}
