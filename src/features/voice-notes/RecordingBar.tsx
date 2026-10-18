import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { VOICE_NOTE_MAX_MS, decodeWave, formatVoiceDuration } from "../../../shared/voice-note.ts";
import type { VoiceNoteDraft, VoiceRecorder } from "./useVoiceRecorder.ts";
import "./voice-notes.css";

type Props = {
  recorder: VoiceRecorder;
  onSend: (draft: VoiceNoteDraft) => void;
  onCancel: () => void;
};

const BARS_SHOWN = 48;

function Bars({ levels, played = 0 }: { levels: number[]; played?: number }) {
  return (
    <div className="vn-wave" aria-hidden="true">
      {levels.map((l, i) => (
        <span
          key={i}
          className={`vn-bar${i / levels.length < played ? " is-played" : ""}`}
          style={{ height: `${Math.max(8, Math.round(l * 100))}%` }}
        />
      ))}
    </div>
  );
}

function Preview({
  draft,
  onSend,
  onDelete,
}: {
  draft: VoiceNoteDraft;
  onSend: Props["onSend"];
  onDelete: () => void;
}) {
  const { t } = useTranslation(["chat"]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);

  useEffect(() => {
    const u = URL.createObjectURL(draft.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [draft.blob]);

  const total = draft.meta.ms;
  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) void a.play().catch(() => setPlaying(false));
    else a.pause();
  };
  const seek = (fraction: number) => {
    const a = audioRef.current;
    const ms = Math.min(total, Math.max(0, fraction * total));
    if (a) a.currentTime = ms / 1000;
    setPos(ms);
  };

  return (
    <div className="vn-bar-root is-preview" role="group" aria-label={t("chat.voice.previewLabel")}>
      <button
        type="button"
        className="vn-icon-btn is-danger"
        onClick={onDelete}
        aria-label={t("chat.voice.delete")}
        title={t("chat.voice.delete")}
      >
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
        </svg>
      </button>
      <button
        type="button"
        className="vn-icon-btn"
        onClick={toggle}
        aria-label={playing ? t("chat.voice.pause") : t("chat.voice.play")}
        title={playing ? t("chat.voice.pause") : t("chat.voice.play")}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
          {playing ? <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /> : <path d="M8 5l11 7-11 7z" />}
        </svg>
      </button>
      <div
        className="vn-scrub"
        role="slider"
        tabIndex={0}
        aria-label={t("chat.voice.scrub")}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={Math.round(pos)}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          seek((e.clientX - r.left) / Math.max(1, r.width));
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") seek((pos + 2000) / total);
          else if (e.key === "ArrowLeft") seek((pos - 2000) / total);
        }}
      >
        <Bars levels={decodeWave(draft.meta.wave)} played={total ? pos / total : 0} />
      </div>
      <span className="vn-timer">{formatVoiceDuration(playing || pos > 0 ? pos : total)}</span>
      <button type="button" className="vn-send" onClick={() => onSend(draft)}>
        {t("chat.voice.send")}
      </button>
      {url ? (
        <audio
          ref={audioRef}
          src={url}
          preload="auto"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setPos(0);
          }}
          onTimeUpdate={(e) => setPos(e.currentTarget.currentTime * 1000)}
        />
      ) : null}
    </div>
  );
}

export function RecordingBar({ recorder, onSend, onCancel }: Props) {
  const { t } = useTranslation(["chat"]);
  const { state, error, elapsedMs, liveLevels, result } = recorder;
  const prevState = useRef(state);
  useEffect(() => {
    // Any return to idle (delete, dismiss, or a too-short stop) closes the bar.
    if (state === "idle" && prevState.current !== "idle") onCancel();
    prevState.current = state;
  }, [state, onCancel]);
  if (state === "idle") return null;

  if (state === "error") {
    const key =
      error === "no-device"
        ? "chat.voice.errorNoDevice"
        : error === "unsupported"
          ? "chat.voice.errorUnsupported"
          : "chat.voice.errorPermission";
    return (
      <div className="vn-bar-root is-error" role="alert">
        <span className="vn-error-text">{t(key)}</span>
        <button
          type="button"
          className="vn-icon-btn"
          onClick={() => {
            recorder.discard();
          }}
          aria-label={t("chat.voice.dismiss")}
          title={t("chat.voice.dismiss")}
        >
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    );
  }

  if (state === "preview" && result) {
    return (
      <Preview
        draft={result}
        onSend={onSend}
        onDelete={() => {
          recorder.discard();
        }}
      />
    );
  }

  const shown = liveLevels.slice(-BARS_SHOWN);
  const padded = shown.length < BARS_SHOWN ? [...Array(BARS_SHOWN - shown.length).fill(0), ...shown] : shown;
  return (
    <div className="vn-bar-root is-recording" role="group" aria-label={t("chat.voice.recording")}>
      <button
        type="button"
        className="vn-icon-btn is-danger"
        onClick={() => {
          recorder.discard();
        }}
        aria-label={t("chat.voice.delete")}
        title={t("chat.voice.delete")}
      >
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
        </svg>
      </button>
      <span className="vn-rec-dot" aria-hidden="true" />
      <Bars levels={padded} />
      <span className="vn-timer" aria-live="off">
        {formatVoiceDuration(elapsedMs)} / {formatVoiceDuration(VOICE_NOTE_MAX_MS)}
      </span>
      <button
        type="button"
        className="vn-stop"
        onClick={() => recorder.stop()}
        aria-label={t("chat.voice.stop")}
        title={t("chat.voice.stop")}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
          <rect x="6" y="6" width="12" height="12" rx="2" />
        </svg>
      </button>
    </div>
  );
}
