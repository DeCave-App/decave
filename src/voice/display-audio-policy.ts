/** Browsers must not add an unapproved audio track to protected screen video. */
export function discardUnapprovedDisplayAudio(
  stream: Pick<MediaStream, "getAudioTracks" | "removeTrack">,
  captureSystemAudio: boolean,
): void {
  if (captureSystemAudio) return;
  for (const track of stream.getAudioTracks()) {
    stream.removeTrack(track);
    track.stop();
  }
}

/** Loopback devices that record the whole system mix, DeCave's voice playback included. */
const UNRESTRICTED_LOOPBACK_DEVICES = new Set(["loopback", "loopbackWithMute", "loopbackAllDevices"]);

type DisplayAudioSettings = MediaTrackSettings & {
  restrictOwnAudio?: boolean;
  suppressLocalAudioPlayback?: boolean;
};

/**
 * Whether a captured system-audio track provably leaves out DeCave's own
 * playback (remote voices, sounds). Without that, sharing it sends everyone's
 * voice back to them as an echo.
 *
 * The device Chromium actually opened is the proof: "loopbackWithoutChrome"
 * is the process-excluding capture. Windows only has that from build 20348
 * (Windows 11 / Server 2022); on Windows 10 Chromium quietly falls back to
 * plain "loopback", even though restrictOwnAudio was requested, so a requested
 * or reported restriction alone is not enough.
 */
export function displayAudioExcludesOwnPlayback(settings: DisplayAudioSettings): boolean {
  const deviceId = settings.deviceId ?? "";
  if (deviceId === "loopbackWithoutChrome") return true;
  if (UNRESTRICTED_LOOPBACK_DEVICES.has(deviceId)) return false;
  return settings.restrictOwnAudio === true || settings.suppressLocalAudioPlayback === true;
}
