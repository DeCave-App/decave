// Routes a peer's incoming mesh audio track to voice or to their screen tile.
//
// A sharer advertises its display capture's MediaStream id (screenStreamId in
// VOICE_SCREEN_STATE). Senders add tracks with addTrack(track, stream), so the
// id survives as the msid: audio from exactly that stream is screen audio and
// everything else is voice, whatever order the tracks arrive in. Older sharers
// without screenStreamId keep the legacy rule (display audio arrives together
// with mesh video).

export type MeshAudioInfo = {
  streamId: string;
  hasVideo: boolean;
  screenSharing: boolean;
  cameraSharing: boolean;
  /** The sharer's advertised display stream id, if any. */
  screenStreamId: string | null;
};

export function classifyMeshAudio(info: MeshAudioInfo): "voice" | "screen" {
  if (info.screenStreamId) {
    return info.screenSharing && info.streamId === info.screenStreamId ? "screen" : "voice";
  }
  return info.hasVideo && info.screenSharing && !info.cameraSharing ? "screen" : "voice";
}
