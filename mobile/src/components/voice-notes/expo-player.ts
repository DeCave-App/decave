// The shared expo-audio player behind every voice-note bubble (one plays at a time).

import { AppState } from "react-native";
import { createAudioPlayer } from "expo-audio";
import { createPlaybackQueue, type PlayerStatus, type SharedPlayer } from "./playback.ts";

function createExpoSharedPlayer(): SharedPlayer {
  const player = createAudioPlayer(null, { updateInterval: 100 });
  let listener: ((status: PlayerStatus) => void) | null = null;
  player.addListener("playbackStatusUpdate", (status) => {
    listener?.({
      currentTime: status.currentTime,
      playing: status.playing,
      didJustFinish: status.didJustFinish,
      loaded: status.isLoaded,
      error: !!status.error,
    });
  });
  return {
    load(uri) {
      player.replace({ uri });
    },
    play() {
      player.play();
    },
    pause() {
      player.pause();
    },
    seek(seconds) {
      void player.seekTo(seconds).catch(() => undefined);
    },
    setRate(rate) {
      player.shouldCorrectPitch = true;
      player.setPlaybackRate(rate);
    },
    onStatus(fn) {
      listener = fn;
    },
  };
}

// Going to the background pauses the note.
export const voicePlayback = createPlaybackQueue(createExpoSharedPlayer, (listener) => {
  const sub = AppState.addEventListener("change", listener);
  return () => sub.remove();
});
