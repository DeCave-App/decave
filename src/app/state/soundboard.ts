// The voice room soundboard: available sounds, panel visibility and
// playback progress.

import { useState } from "react";
import type { SoundboardSound } from "../types";

export function useSoundboardState() {
  const [soundboardSounds, setSoundboardSounds] = useState<SoundboardSound[]>([]);
  const [soundboardBusy, setSoundboardBusy] = useState(false);
  const [soundboardOpen, setSoundboardOpen] = useState(false);

  return {
    soundboardSounds,
    setSoundboardSounds,
    soundboardBusy,
    setSoundboardBusy,
    soundboardOpen,
    setSoundboardOpen,
  };
}

export type SoundboardState = ReturnType<typeof useSoundboardState>;
