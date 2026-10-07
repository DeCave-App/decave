// Camera effect and screen share audio options in the voice controls.

import { useState } from "react";
import type { CameraEffect } from "../types";

export function useCameraShareOptionsState() {
  const [shareSystemAudio, setShareSystemAudio] = useState(true);
  const [cameraEffect, setCameraEffect] = useState<CameraEffect>("none");
  const [cameraEffectNotice, setCameraEffectNotice] = useState("");

  return {
    shareSystemAudio,
    setShareSystemAudio,
    cameraEffect,
    setCameraEffect,
    cameraEffectNotice,
    setCameraEffectNotice,
  };
}

export type CameraShareOptionsState = ReturnType<typeof useCameraShareOptionsState>;
