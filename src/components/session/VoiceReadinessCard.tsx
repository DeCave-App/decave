import { useState } from "react";
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
      setTestError(cause instanceof Error ? cause.message : "The local voice test could not run.");
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
      setTestError(cause instanceof Error ? cause.message : "The local comparison could not run.");
    } finally {
      setTestVariant(null);
    }
  };
  return (
    <section className="dc-session-readiness" aria-labelledby="voice-readiness-title">
      <div className="dc-session-row">
        <div>
          <span className="dc-session-kicker">VOICE READINESS</span>
          <h2 id="voice-readiness-title">Check before joining</h2>
          <p>
            {voicePermissionLabel(readiness.inputPermission)} ·{" "}
            {readiness.noiseEnvironment === "not-measured"
              ? "Noise not measured"
              : `Environment ${readiness.noiseEnvironment}`}
          </p>
        </div>
        {onRefresh && (
          <button type="button" onClick={onRefresh}>
            Refresh devices
          </button>
        )}
      </div>
      <div className="dc-session-readiness-grid">
        <div className="dc-session-metric">
          <span>Input</span>
          <strong>
            {deviceLabel(readiness.selectedInput, readiness.inputSupported ? "System input" : "Unavailable")}
          </strong>
        </div>
        <div className="dc-session-metric">
          <span>Output</span>
          <strong>
            {deviceLabel(
              readiness.selectedOutput,
              readiness.outputSupported
                ? "System output"
                : readiness.sinkSelectionSupported
                  ? "System output · selectable"
                  : "System output",
            )}
          </strong>
        </div>
        <div className="dc-session-metric">
          <span>Processing</span>
          <strong>{voiceProcessingModeLabel(readiness.processingMode)}</strong>
        </div>
        <div className="dc-session-metric">
          <span>Expected latency</span>
          <strong>{readiness.expectedLatencyMs === null ? "Not measured" : `${readiness.expectedLatencyMs} ms`}</strong>
        </div>
      </div>
      <div className="dc-session-form-grid" style={{ marginTop: 12 }}>
        <label>
          Processing mode
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
          {testVariant === "raw" ? "Measuring raw…" : "Test raw input"}
        </button>
        <button type="button" disabled={testVariant !== null} onClick={() => void runTest("processed")}>
          {testVariant === "processed" ? "Measuring processed…" : "Test cleaned input"}
        </button>
        {callbacks.onRunABTest && (
          <button
            type="button"
            className="dc-session-primary"
            disabled={testVariant !== null}
            onClick={() => void runAb()}
          >
            {testVariant === "ab" ? "Comparing…" : "Run local A/B test"}
          </button>
        )}
      </div>
      <p className="dc-session-note">
        Tests run locally after you choose a button and are not saved by this component.
      </p>
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
