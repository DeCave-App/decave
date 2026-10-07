import { localMediaPath } from "../../shared/streamer-mode";
/** Explicit host binding: spread ONLY on the existing .channel-sidebar element.
 * Merge style with the host's existing style; never replace its layout properties.
 */
export function streamerSidebarBinding(enabled: boolean, bannerPath: string, mediaUrl: (path: string) => string) {
  let image = "none";
  if (enabled && bannerPath) {
    try {
      image = `url(${JSON.stringify(mediaUrl(localMediaPath(bannerPath)))})`;
    } catch {
      image = "none";
    }
  }
  return {
    "data-streamer-sidebar": enabled ? "true" : undefined,
    style: { "--dc-streamer-sidebar-banner": image },
  };
}
