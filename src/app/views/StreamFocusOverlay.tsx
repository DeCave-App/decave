// Full-size view of one video or screen-share tile; click outside to close.

import type { Dispatch, SetStateAction } from "react";
import { Icon } from "../../components/Icon";
import { ScreenVideo } from "../components/ScreenVideo";
import type { CallMediaState } from "../state/call-media";

type Props = {
  callMedia: CallMediaState;
  focusedVideo: { title: string; stream: MediaStream; connectionId?: string };
  setFocusedVideo: Dispatch<SetStateAction<{ title: string; stream: MediaStream; connectionId?: string } | null>>;
  setScreenPlaybackMuted: (connectionId: string, muted: boolean) => void;
  popOutStream: (title: string, stream: MediaStream) => void;
};

export function StreamFocusOverlay({
  callMedia,
  focusedVideo,
  setFocusedVideo,
  setScreenPlaybackMuted,
  popOutStream,
}: Props) {
  return (
    <div className="stream-focus-overlay" onClick={() => setFocusedVideo(null)}>
      <div className="stream-focus-shell" onClick={(event) => event.stopPropagation()}>
        <div className="stream-focus-head">
          <strong>{focusedVideo.title}</strong>
          <button
            type="button"
            className="ds-btn ds-btn-ghost ds-icon-btn"
            aria-label="Close stream"
            title="Close"
            onClick={() => setFocusedVideo(null)}
          >
            <Icon name="close" />
          </button>
        </div>
        <ScreenVideo
          stream={focusedVideo.stream}
          muted={focusedVideo.connectionId ? callMedia.screenAudioMuted[focusedVideo.connectionId] === true : false}
          onMutedChange={
            focusedVideo.connectionId ? (muted) => setScreenPlaybackMuted(focusedVideo.connectionId!, muted) : undefined
          }
        />
        <div className="stream-focus-actions">
          <button
            type="button"
            className="ds-btn"
            onClick={() => popOutStream(focusedVideo.title, focusedVideo.stream)}
          >
            <Icon name="external" />
            Pop Out
          </button>
          <button
            type="button"
            className="ds-btn"
            onClick={() => {
              const video = document.querySelector(".stream-focus-shell video") as HTMLVideoElement | null;
              void video?.requestFullscreen?.();
            }}
          >
            <Icon name="maximize" />
            Browser Fullscreen
          </button>
        </div>
      </div>
    </div>
  );
}
