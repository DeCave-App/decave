import { i18next } from "../i18n/index.ts";
export type VoicePermissionState = "granted" | "denied" | "prompt" | "unknown";
export type VoiceProcessingMode = "standard" | "high-quality" | "low-cpu";
export type VoiceTestVariant = "raw" | "processed";

export type VoiceDeviceOption = {
  id: string;
  label: string;
};

export type VoiceReadiness = {
  checkedAt: string;
  mediaDevicesSupported: boolean;
  inputSupported: boolean;
  outputSupported: boolean;
  inputPermission: VoicePermissionState;
  inputDevices: VoiceDeviceOption[];
  outputDevices: VoiceDeviceOption[];
  selectedInput: VoiceDeviceOption | null;
  selectedOutput: VoiceDeviceOption | null;
  sinkSelectionSupported: boolean;
  audioContextSupported: boolean;
  expectedLatencyMs: number | null;
  processingMode: VoiceProcessingMode;
  availableProcessingModes: VoiceProcessingMode[];
  /** Noise is measured only by an explicit local test callback. */
  noiseEnvironment: "not-measured" | "quiet" | "noisy";
};

export type VoiceReadinessEnvironment = {
  mediaDevices?: Pick<MediaDevices, "enumerateDevices"> | null;
  microphonePermission?: VoicePermissionState | null;
  outputSelectionSupported?: boolean;
  audioContextSupported?: boolean;
  expectedLatencyMs?: number | null;
  availableProcessingModes?: readonly VoiceProcessingMode[];
  selectedProcessingMode?: VoiceProcessingMode;
  now?: number;
};

export type VoiceLocalTestResult = {
  variant: VoiceTestVariant;
  durationMs: number;
  inputRms: number;
  cleanedRms: number;
  transmittedActivity: number;
  clippingPercent?: number;
  measuredAt: string;
};

export type VoiceReadinessCallbacks = {
  /** Called by the explicit 10-second local test button; the component never captures by itself. */
  onRunLocalTest: (variant: VoiceTestVariant) => Promise<VoiceLocalTestResult> | VoiceLocalTestResult;
  /** Optional comparison callback for a real local A/B measurement. */
  onRunABTest?: () =>
    | Promise<{ raw: VoiceLocalTestResult; processed: VoiceLocalTestResult }>
    | { raw: VoiceLocalTestResult; processed: VoiceLocalTestResult };
  /** Called when the user selects an available processing mode. */
  onProcessingModeChange?: (mode: VoiceProcessingMode) => void;
};

const PROCESSING_MODES: readonly VoiceProcessingMode[] = ["standard", "high-quality", "low-cpu"];

async function permissionFromNavigator(): Promise<VoicePermissionState> {
  try {
    const permission = globalThis.navigator?.permissions;
    // Permission querying is optional and must never request microphone access.
    if (!permission || typeof permission.query !== "function") return "unknown";
    const status = await permission.query({ name: "microphone" });
    return status.state === "granted" || status.state === "denied" || status.state === "prompt"
      ? status.state
      : "unknown";
  } catch {
    return "unknown";
  }
}

function sinkSupportedFromBrowser(): boolean {
  try {
    return typeof globalThis.HTMLMediaElement !== "undefined" && "setSinkId" in globalThis.HTMLMediaElement.prototype;
  } catch {
    return false;
  }
}

function audioContextSupportedFromBrowser(): boolean {
  try {
    const scope = globalThis as typeof globalThis & { webkitAudioContext?: unknown };
    return typeof scope.AudioContext !== "undefined" || typeof scope.webkitAudioContext !== "undefined";
  } catch {
    return false;
  }
}

function cleanModes(modes: readonly VoiceProcessingMode[] | undefined): VoiceProcessingMode[] {
  const values = (modes ?? ["standard"]).filter((mode): mode is VoiceProcessingMode => PROCESSING_MODES.includes(mode));
  return [...new Set(values)].length ? [...new Set(values)] : ["standard"];
}

/** Inspect current capability without opening the microphone or changing a media track. */
export async function inspectVoiceReadiness(environment: VoiceReadinessEnvironment = {}): Promise<VoiceReadiness> {
  const mediaDevices =
    environment.mediaDevices === undefined ? (globalThis.navigator?.mediaDevices ?? null) : environment.mediaDevices;
  const mediaDevicesSupported = Boolean(mediaDevices && typeof mediaDevices.enumerateDevices === "function");
  let rawDevices: MediaDeviceInfo[] = [];
  if (mediaDevicesSupported && mediaDevices) {
    try {
      rawDevices = await mediaDevices.enumerateDevices();
    } catch {
      // A browser can expose enumerateDevices while denying the query.
      rawDevices = [];
    }
  }
  const inputDevices = rawDevices
    .filter((device) => device.kind === "audioinput")
    .map((device, index) => ({
      id: device.deviceId || `audioinput-${index}`,
      label: device.label || i18next.t("chat.session.voice.inputFallback", { number: index + 1 }),
    }));
  const outputDevices = rawDevices
    .filter((device) => device.kind === "audiooutput")
    .map((device, index) => ({
      id: device.deviceId || `audiooutput-${index}`,
      label: device.label || i18next.t("chat.session.voice.outputFallback", { number: index + 1 }),
    }));
  const inputPermission = environment.microphonePermission ?? (await permissionFromNavigator());
  const sinkSelectionSupported = environment.outputSelectionSupported ?? sinkSupportedFromBrowser();
  const audioContextSupported = environment.audioContextSupported ?? audioContextSupportedFromBrowser();
  const availableProcessingModes = cleanModes(environment.availableProcessingModes);
  const processingMode =
    environment.selectedProcessingMode && availableProcessingModes.includes(environment.selectedProcessingMode)
      ? environment.selectedProcessingMode
      : availableProcessingModes[0];
  const expectedLatencyMs =
    typeof environment.expectedLatencyMs === "number" &&
    Number.isFinite(environment.expectedLatencyMs) &&
    environment.expectedLatencyMs >= 0
      ? Math.round(environment.expectedLatencyMs)
      : null;
  return {
    checkedAt: new Date(environment.now ?? Date.now()).toISOString(),
    mediaDevicesSupported,
    inputSupported:
      mediaDevicesSupported &&
      (inputDevices.length > 0 || inputPermission === "granted" || inputPermission === "prompt"),
    outputSupported: mediaDevicesSupported && outputDevices.length > 0,
    inputPermission,
    inputDevices,
    outputDevices,
    selectedInput: inputDevices[0] ?? null,
    selectedOutput: outputDevices[0] ?? null,
    sinkSelectionSupported,
    audioContextSupported,
    expectedLatencyMs,
    processingMode,
    availableProcessingModes,
    noiseEnvironment: "not-measured",
  };
}

export function voicePermissionLabel(permission: VoicePermissionState): string {
  return permission === "granted"
    ? i18next.t("chat.session.voice.permissionGranted")
    : permission === "denied"
      ? i18next.t("chat.session.voice.permissionDenied")
      : permission === "prompt"
        ? i18next.t("chat.session.voice.permissionPrompt")
        : i18next.t("chat.session.voice.permissionUnknown");
}

export function voiceProcessingModeLabel(mode: VoiceProcessingMode): string {
  return mode === "high-quality"
    ? i18next.t("chat.session.voice.modeHighQuality")
    : mode === "low-cpu"
      ? i18next.t("chat.session.voice.modeLowCpu")
      : i18next.t("chat.session.voice.modeStandard");
}

export function summarizeVoiceTest(result: VoiceLocalTestResult): string {
  const variant =
    result.variant === "raw"
      ? i18next.t("chat.session.voice.rawInput")
      : i18next.t("chat.session.voice.processedInput");
  const duration = Number.isFinite(result.durationMs)
    ? i18next.t("chat.session.voice.durationMs", { ms: Math.max(0, Math.round(result.durationMs)) })
    : i18next.t("chat.session.voice.durationUnavailable");
  const activity = Number.isFinite(result.transmittedActivity)
    ? i18next.t("chat.session.voice.activityPercent", {
        percent: Math.round(Math.max(0, Math.min(1, result.transmittedActivity)) * 100),
      })
    : i18next.t("chat.session.voice.activityUnavailable");
  return i18next.t("chat.session.voice.testSummary", { variant, duration, activity });
}
