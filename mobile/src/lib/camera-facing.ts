import type { MediaStreamTrack } from "react-native-webrtc";

export type CameraFacing = "user" | "environment";

type FacingTrack = Pick<MediaStreamTrack, "applyConstraints" | "getSettings">;

export function trackFacing(track: FacingTrack | null | undefined): CameraFacing {
  try {
    return track?.getSettings()?.facingMode === "environment" ? "environment" : "user";
  } catch {
    return "user";
  }
}

/**
 * Switches a local camera track between the front and back camera in place.
 * The native capturer restarts on the other device; the track (and every peer
 * connection sending it) stays the same, so no renegotiation is needed.
 * Resolves with the facing the camera actually ended up on.
 */
export async function flipCameraTrack(track: FacingTrack): Promise<CameraFacing> {
  const settings = track.getSettings() ?? {};
  const next: CameraFacing = trackFacing(track) === "user" ? "environment" : "user";
  await track.applyConstraints({
    width: settings.width,
    height: settings.height,
    frameRate: settings.frameRate,
    facingMode: next,
  });
  return trackFacing(track);
}

/** Only the front camera is mirrored, like the system Camera app. */
export function mirrorForFacing(facing: CameraFacing): boolean {
  return facing === "user";
}
