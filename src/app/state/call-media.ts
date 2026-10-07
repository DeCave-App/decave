// Screens and cameras in the voice call: your own share and camera, remote
// streams, which ones you watch, the gallery layout and the share/camera menus.

import { useState } from "react";
import type { ScreenQuality, RemoteScreen } from "../types";

export function useCallMediaState() {
  const [watchedScreenConnections, setWatchedScreenConnections] = useState<Record<string, boolean>>({});
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [screenQuality, setScreenQuality] = useState<ScreenQuality>("1080p60");
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [cameraSettingsOpen, setCameraSettingsOpen] = useState(false);
  const [screenShareSettingsOpen, setScreenShareSettingsOpen] = useState(false);
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null);
  const [localCameraStream, setLocalCameraStream] = useState<MediaStream | null>(null);
  const [remoteScreens, setRemoteScreens] = useState<Record<string, RemoteScreen>>({});
  const [screenAudioMuted, setScreenAudioMuted] = useState<Record<string, boolean>>({});
  const [remoteCameras, setRemoteCameras] = useState<Record<string, RemoteScreen>>({});
  const [screenGalleryLayout, setScreenGalleryLayout] = useState<"grid" | "focus">("grid");

  return {
    watchedScreenConnections,
    setWatchedScreenConnections,
    isScreenSharing,
    setIsScreenSharing,
    screenQuality,
    setScreenQuality,
    isCameraOn,
    setIsCameraOn,
    cameraSettingsOpen,
    setCameraSettingsOpen,
    screenShareSettingsOpen,
    setScreenShareSettingsOpen,
    localScreenStream,
    setLocalScreenStream,
    localCameraStream,
    setLocalCameraStream,
    remoteScreens,
    setRemoteScreens,
    screenAudioMuted,
    setScreenAudioMuted,
    remoteCameras,
    setRemoteCameras,
    screenGalleryLayout,
    setScreenGalleryLayout,
  };
}

export type CallMediaState = ReturnType<typeof useCallMediaState>;
