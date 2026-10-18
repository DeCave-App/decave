import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { decodeWave, formatVoiceDuration, type VoiceNoteMeta } from "../../../shared/voice-note.ts";
import { attachmentDecrypter } from "../../e2ee/dm-e2ee-client";
import { createVoiceSource, loadVoiceNoteBlob, voiceMimeFromName } from "./load-voice-audio.ts";
import {
  createPlayedTracker,
  nextSpeed,
  readSpeed,
  voicePlayback,
  writeSpeed,
  type PlaybackHandlers,
} from "./playback.ts";
import "./voice-notes.css";

export type VoiceNoteBubbleProps = {
  conversationId: string;
  messageId: string;
  meta: VoiceNoteMeta;
  url: string;
  fileKey?: unknown;
  /** Audio MIME type; when absent it is derived from `name`. */
  mime?: string;
  /** Attachment file name, used to derive the MIME type. */
  name?: string;
  mine: boolean;
  played: boolean;
  onPlayed: () => void;
};

export function VoiceNoteBubble({
  conversationId,
  messageId,
  meta,
  url,
  fileKey,
  mime,
  name,
  mine,
  played,
  onPlayed,
}: VoiceNoteBubbleProps) {
  const { t } = useTranslation(["chat"]);
  const levels = useMemo(() => decodeWave(meta.wave), [meta.wave]);
  const durationMs = meta.ms;
  const durationSec = durationMs / 1000;
  const onPlayedRef = useRef(onPlayed);
  onPlayedRef.current = onPlayed;
  const playedRef = useRef(played);
  playedRef.current = played;
  const trackerRef = useRef(
    createPlayedTracker(() => {
      if (!playedRef.current) onPlayedRef.current();
    }),
  );
  const progressRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgressState] = useState(0);
  const [speed, setSpeed] = useState(readSpeed);
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const [failed, setFailed] = useState(false);
  const mimeType = mime || voiceMimeFromName(name);

  const setProgress = (ratio: number) => {
    progressRef.current = ratio;
    setProgressState(ratio);
  };

  const sourceRef = useRef<ReturnType<typeof createVoiceSource> | null>(null);
  const source = () =>
    (sourceRef.current ??= createVoiceSource({
      load: () => loadVoiceNoteBlob({ url, meta, decrypt: attachmentDecrypter({ fileKey }), mime: mimeType }),
    }));

  const handlers = useMemo<PlaybackHandlers>(
    () => ({
      onTime: (seconds) => {
        setProgress(Math.min(1, seconds / durationSec));
        trackerRef.current.update(seconds, durationSec);
      },
      onPlaying: () => setPlaying(true),
      onPaused: () => {
        setPlaying(false);
        trackerRef.current.break();
      },
      onEnded: () => {
        setPlaying(false);
        setProgress(0);
        trackerRef.current.end();
        voicePlayback.onEnded(messageId, () => nextUnplayedId(conversationId, messageId));
      },
      onError: () => {
        setPlaying(false);
        setFailed(true);
      },
    }),
    [conversationId, durationSec, messageId],
  );

  const start = useCallback(async () => {
    voicePlayback.prime(); // synchronously, while the tap still unlocks audio (iOS)
    try {
      const src = await source().ensure();
      if (!src) return; // unmounted while loading
      setFailed(false);
      trackerRef.current.break();
      await voicePlayback.play(messageId, src, progressRef.current * durationSec, speedRef.current, handlers);
    } catch {
      setFailed(true);
    }
  }, [handlers, messageId, durationSec, url, fileKey]);

  const toggle = () => {
    if (!playing) voicePlayback.prime();
    if (playing) voicePlayback.pause(messageId);
    else void start();
  };

  useEffect(() => voicePlayback.subscribe(messageId, () => void start()), [messageId, start]);

  useEffect(
    () => () => {
      voicePlayback.release(messageId);
      sourceRef.current?.dispose();
      sourceRef.current = null;
    },
    [messageId],
  );

  // Seeking never fetches: before the first play it only remembers the position.
  const seekTo = (ratio: number) => {
    const r = Math.min(1, Math.max(0, ratio));
    setProgress(r);
    trackerRef.current.break();
    voicePlayback.seek(messageId, r * durationSec);
  };

  const seekFromPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.type === "pointermove" && e.buttons === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    seekTo((e.clientX - rect.left) / Math.max(1, rect.width));
  };

  const retry = () => {
    sourceRef.current?.reset();
    setFailed(false);
    void start();
  };

  const saveDecrypted = async () => {
    try {
      const blob = await source().blob();
      if (!blob) return;
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = name || "Voice message";
      a.click();
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
    } catch {
      /* still unreachable: the retry button remains */
    }
  };

  const cycleSpeed = () => {
    const s = nextSpeed(speed);
    setSpeed(s);
    writeSpeed(s);
    voicePlayback.setRate(messageId, s);
  };

  const shownMs = playing || progress > 0 ? durationMs * progress : durationMs;
  const unplayed = !mine && !played;

  if (failed) {
    return (
      <div className="vn-bubble is-error" data-conversation={conversationId}>
        <span className="vn-error-text">{t("chat.voice.errorPlay")}</span>
        <button type="button" className="vn-retry" onClick={retry}>
          {t("chat.voice.retry")}
        </button>
        {fileKey ? (
          <button type="button" className="vn-download" onClick={() => void saveDecrypted()}>
            {t("chat.voice.download")}
          </button>
        ) : (
          <a className="vn-download" href={url} download>
            {t("chat.voice.download")}
          </a>
        )}
      </div>
    );
  }

  return (
    <div
      className={`vn-bubble${mine ? " is-mine" : ""}`}
      data-conversation={conversationId}
      data-message-id={messageId}
    >
      <button
        type="button"
        className="vn-play"
        onClick={toggle}
        aria-label={playing ? t("chat.voice.pause") : t("chat.voice.play")}
      >
        {playing ? "❚❚" : "▶"}
      </button>
      <div
        className="vn-scrub"
        role="slider"
        tabIndex={0}
        aria-label={t("chat.voice.scrub")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture?.(e.pointerId);
          seekFromPointer(e);
        }}
        onPointerMove={(e) => seekFromPointer(e)}
        onKeyDown={(e) => {
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
          e.preventDefault();
          seekTo(progress + (e.key === "ArrowRight" ? 0.05 : -0.05));
        }}
      >
        <div className="vn-wave" aria-hidden="true">
          {levels.map((l, i) => (
            <span
              key={i}
              className={`vn-bar${i / levels.length < progress ? " is-played" : ""}`}
              style={{ height: `${Math.max(8, Math.round(l * 100))}%` }}
            />
          ))}
        </div>
      </div>
      <span className="vn-time">{formatVoiceDuration(shownMs)}</span>
      <button type="button" className="vn-speed" onClick={cycleSpeed} aria-label={t("chat.voice.speed")}>
        {speed}×
      </button>
      {unplayed ? <span className="vn-unplayed-dot" aria-label={t("chat.voice.unplayed")} /> : null}
      {mine && played ? <span className="vn-played-label">{t("chat.voice.played")}</span> : null}
    </div>
  );
}

/** Next unplayed voice bubble after this one in the same conversation, read from the DOM. */
function nextUnplayedId(conversationId: string, messageId: string): string | null {
  const bubbles = Array.from(document.querySelectorAll<HTMLElement>(".vn-bubble[data-message-id]")).filter(
    (el) => el.dataset.conversation === conversationId,
  );
  const idx = bubbles.findIndex((el) => el.dataset.messageId === messageId);
  for (const el of bubbles.slice(idx + 1)) {
    if (el.querySelector(".vn-unplayed-dot")) return el.dataset.messageId ?? null;
  }
  return null;
}
