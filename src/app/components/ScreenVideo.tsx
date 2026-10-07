import { useEffect, useRef } from "react";
import { screenVideoStyle } from "../inline-styles";

export function ScreenVideo({
  stream,
  muted = false,
  onMutedChange,
}: {
  stream: MediaStream;
  muted?: boolean;
  onMutedChange?: (muted: boolean) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.muted = muted;
    videoRef.current.srcObject = stream;
    void videoRef.current.play().catch(() => {
      // Playback will retry after the next user interaction if needed.
    });
    return () => {
      if (videoRef.current?.srcObject === stream) videoRef.current.srcObject = null;
    };
  }, [muted, stream]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted={muted}
      controls
      onVolumeChange={(event) => onMutedChange?.(event.currentTarget.muted)}
      style={screenVideoStyle}
    />
  );
}
