import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  summarizeVoiceTest,
  voicePermissionLabel,
  voiceProcessingModeLabel,
  type VoiceLocalTestResult,
  type VoiceProcessingMode,
  type VoiceReadiness,
  type VoiceReadinessCallbacks,
  type VoiceTestVariant,
} from "../../session/voice-readiness.ts";
import "./session.css";

export type VoiceReadinessCardProps = {
  readiness: VoiceReadiness;
  callbacks: VoiceReadinessCallbacks;
  onRefresh?: () => void;
};

function deviceLabel(device: { label: string } | null, fallback: string): string {
  return device?.label || fallback;
}

/** Capability and local test surface shown before joining or after recovery. */
export function VoiceReadinessCard({ readiness, callbacks, onRefresh }: VoiceReadinessCardProps) {
  const { t } = useTranslation(["chat"]);
  const [testVariant, setTestVariant] = useState<VoiceTestVariant | "ab" | null>(null);
  const [testResult, setTestResult] = useState<VoiceLocalTestResult | null>(null);
  const [abResult, setAbResult] = useState<{ raw: VoiceLocalTestResult; processed: VoiceLocalTestResult } | null>(null);
  const [testError, setTestError] = useState("");
  const runTest = async (variant: VoiceTestVariant) => {
    setTestVariant(variant);
    setTestResult(null);
    setAbResult(null);
    setTestError("");
    try {
      setTestResult(await callbacks.onRunLocalTest(variant));
    } catch (cause) {
      setTestError(cause instanceof Error ? cause.message : t("chat.session.readiness.testFailed"));
    } finally {
      setTestVariant(null);
    }
  };
  const runAb = async () => {
    if (!callbacks.onRunABTest) return;
    setTestVariant("ab");
    setTestResult(null);
    setAbResult(null);
    setTestError("");
    try {
      setAbResult(await callbacks.onRunABTest());
    } catch (cause) {
      setTestError(cause instanceof Error ? cause.message : t("chat.session.readiness.compareFailed"));
    } finally {
      setTestVariant(null);
    }
  };
  return (
    <section className="dc-session-readiness" aria-labelledby="voice-readiness-title">
      <div className="dc-session-row">
        <div>
          <span className="dc-session-kicker">{t("chat.session.readiness.kicker")}</span>
          <h2 id="voice-readiness-title">{t("chat.session.readiness.title")}</h2>
          <p>
            {voicePermissionLabel(readiness.inputPermission)} ·{" "}
            {readiness.noiseEnvironment === "not-measured"
              ? t("chat.session.readiness.noiseNotMeasured")
              : t("chat.session.readiness.environment", { environment: readiness.noiseEnvironment })}
          </p>
        </div>
        {onRefresh && (
          <button type="button" onClick={onRefresh}>
            {t("chat.session.readiness.refresh")}
          </button>
        )}
      </div>
      <div className="dc-session-readiness-grid">
        <div className="dc-session-metric">
          <span>{t("chat.session.readiness.input")}</span>
          <strong>
            {deviceLabel(
              readiness.selectedInput,
              readiness.inputSupported
                ? t("chat.session.readiness.systemInput")
                : t("chat.session.readiness.unavailable"),
            )}
          </strong>
        </div>
        <div className="dc-session-metric">
          <span>{t("chat.session.readiness.output")}</span>
          <strong>
            {deviceLabel(
              readiness.selectedOutput,
              readiness.outputSupported
                ? t("chat.session.readiness.systemOutput")
                : readiness.sinkSelectionSupported
                  ? t("chat.session.readiness.systemOutputSelectable")
                  : t("chat.session.readiness.systemOutput"),
            )}
          </strong>
        </div>
        <div className="dc-session-metric">
          <span>{t("chat.session.readiness.processing")}</span>
          <strong>{voiceProcessingModeLabel(readiness.processingMode)}</strong>
        </div>
        <div className="dc-session-metric">
          <span>{t("chat.session.readiness.latency")}</span>
          <strong>
            {readiness.expectedLatencyMs === null
              ? t("chat.session.readiness.notMeasured")
              : t("chat.session.voice.durationMs", { ms: readiness.expectedLatencyMs })}
          </strong>
        </div>
      </div>
      <div className="dc-session-form-grid" style={{ marginTop: 12 }}>
        <label>
          {t("chat.session.readiness.processingMode")}
          <select
            value={readiness.processingMode}
            onChange={(event) => callbacks.onProcessingModeChange?.(event.target.value as VoiceProcessingMode)}
          >
            {readiness.availableProcessingModes.map((mode) => (
              <option key={mode} value={mode}>
                {voiceProcessingModeLabel(mode)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="dc-session-actions">
        <button type="button" disabled={testVariant !== null} onClick={() => void runTest("raw")}>
          {testVariant === "raw" ? t("chat.session.readiness.measuringRaw") : t("chat.session.readiness.testRaw")}
        </button>
        <button type="button" disabled={testVariant !== null} onClick={() => void runTest("processed")}>
          {testVariant === "processed"
            ? t("chat.session.readiness.measuringProcessed")
            : t("chat.session.readiness.testProcessed")}
        </button>
        {callbacks.onRunABTest && (
          <button
            type="button"
            className="dc-session-primary"
            disabled={testVariant !== null}
            onClick={() => void runAb()}
          >
            {testVariant === "ab" ? t("chat.session.readiness.comparing") : t("chat.session.readiness.runAb")}
          </button>
        )}
      </div>
      <p className="dc-session-note">{t("chat.session.readiness.note")}</p>
      {testError && (
        <p className="dc-session-note" role="alert">
          {testError}
        </p>
      )}
      {testResult && (
        <p className="dc-session-test-result" role="status">
          {summarizeVoiceTest(testResult)}
        </p>
      )}
      {abResult && (
        <div className="dc-session-test-result" role="status">
          <div>{summarizeVoiceTest(abResult.raw)}</div>
          <div>{summarizeVoiceTest(abResult.processed)}</div>
        </div>
      )}
    </section>
  );
}
