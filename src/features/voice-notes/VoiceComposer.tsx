// The composer's mic button (shown only while there is no text) and, once
// recording starts, the recording bar laid over the composer row.

import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { RecordingBar } from "./RecordingBar.tsx";
import { useVoiceRecorder, type VoiceNoteDraft } from "./useVoiceRecorder.ts";
import { micButtonVisible, VoiceNoteSendError } from "./send.ts";
import "./voice-notes.css";

const noop = () => undefined;

export function VoiceComposer({
  text,
  hasOtherContent = false,
  disabled = false,
  onSend,
  onError,
}: {
  text: string;
  hasOtherContent?: boolean;
  disabled?: boolean;
  /** Resolves once sent; on rejection the preview stays so it can be sent again. */
  onSend: (draft: VoiceNoteDraft) => Promise<void>;
  /** A translated message for the composer's error line. */
  onError: (message: string) => void;
}) {
  const { t } = useTranslation(["chat"]);
  const recorder = useVoiceRecorder();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const send = useCallback(
    (draft: VoiceNoteDraft) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      onSend(draft)
        .then(() => recorder.discard())
        .catch((error: unknown) =>
          onError(
            error instanceof Error && !(error instanceof VoiceNoteSendError) && error.message
              ? error.message
              : t("chat.voice.sendFailed"),
          ),
        )
        .finally(() => {
          busyRef.current = false;
          setBusy(false);
        });
    },
    [onSend, onError, recorder, t],
  );
  if (recorder.state !== "idle") {
    return (
      <div className={`vn-composer-overlay${busy ? " is-busy" : ""}`} aria-busy={busy}>
        <RecordingBar recorder={recorder} onSend={send} onCancel={noop} />
      </div>
    );
  }
  if (!micButtonVisible(text, hasOtherContent)) return null;
  return (
    <button
      type="button"
      className="dc-dm-composer-btn icon-only vn-mic"
      onClick={() => void recorder.start()}
      disabled={disabled}
      title={t("chat.voice.record")}
      aria-label={t("chat.voice.record")}
    >
      <svg className="dc-composer-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a1 1 0 1 1 2 0 7 7 0 0 1-6 6.93V20h2a1 1 0 1 1 0 2H9a1 1 0 1 1 0-2h2v-2.07A7 7 0 0 1 5 11a1 1 0 1 1 2 0 5 5 0 0 0 10 0Z"
        />
      </svg>
    </button>
  );
}
