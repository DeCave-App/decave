// Device-level preferences added in the Settings overhaul (2026-10).
// Like the rest of Settings they preview immediately, are kept by Save and
// reverted by Cancel; they live in localStorage on this device.

export type ThemeMode = "manual" | "system";
export type MotionPreference = "system" | "reduce" | "full";
export type MessageDensity = "cozy" | "compact";

export type QuietHours = {
  enabled: boolean;
  /** "HH:MM", 24-hour, in the device's local time. */
  start: string;
  end: string;
  /** Let direct messages and mentions through during quiet hours. */
  allowMentions: boolean;
};

export type ExtraSettings = {
  themeMode: ThemeMode;
  /** Skins used when themeMode is "system". */
  lightSkin: string;
  darkSkin: string;
  motion: MotionPreference;
  density: MessageDensity;
  highContrast: boolean;
  underlineLinks: boolean;
  showAltText: boolean;
  quietHours: QuietHours;
  /** Master volume for everyone you hear in voice, 0-200%. */
  outputVolume: number;
  cameraDeviceId: string;
  showAudioDiagnostics: boolean;
};

export const EXTRA_SETTINGS_KEY = "decave_extra_settings_v1";

export const LIGHT_SKINS = ["bright", "pearl"] as const;

export const DEFAULT_EXTRA_SETTINGS: ExtraSettings = {
  themeMode: "manual",
  lightSkin: "bright",
  darkSkin: "nebula",
  motion: "system",
  density: "cozy",
  highContrast: false,
  underlineLinks: false,
  showAltText: false,
  quietHours: { enabled: false, start: "23:00", end: "08:00", allowMentions: true },
  outputVolume: 100,
  cameraDeviceId: "",
  showAudioDiagnostics: false,
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function normalizeExtraSettings(value: unknown, skins: readonly string[]): ExtraSettings {
  const raw = (value && typeof value === "object" ? value : {}) as Partial<ExtraSettings> & {
    quietHours?: Partial<QuietHours>;
  };
  const d = DEFAULT_EXTRA_SETTINGS;
  const skin = (candidate: unknown, fallback: string) =>
    typeof candidate === "string" && skins.includes(candidate) ? candidate : fallback;
  const quiet: Partial<QuietHours> = raw.quietHours && typeof raw.quietHours === "object" ? raw.quietHours : {};
  const volume = Number(raw.outputVolume);
  return {
    themeMode: raw.themeMode === "system" ? "system" : "manual",
    lightSkin: skin(raw.lightSkin, d.lightSkin),
    darkSkin: skin(raw.darkSkin, d.darkSkin),
    motion: raw.motion === "reduce" || raw.motion === "full" ? raw.motion : "system",
    density: raw.density === "compact" ? "compact" : "cozy",
    highContrast: raw.highContrast === true,
    underlineLinks: raw.underlineLinks === true,
    showAltText: raw.showAltText === true,
    quietHours: {
      enabled: quiet.enabled === true,
      start: typeof quiet.start === "string" && TIME.test(quiet.start) ? quiet.start : d.quietHours.start,
      end: typeof quiet.end === "string" && TIME.test(quiet.end) ? quiet.end : d.quietHours.end,
      allowMentions: quiet.allowMentions !== false,
    },
    outputVolume: Number.isFinite(volume) ? Math.max(0, Math.min(200, Math.round(volume))) : d.outputVolume,
    cameraDeviceId: typeof raw.cameraDeviceId === "string" ? raw.cameraDeviceId.slice(0, 256) : "",
    showAudioDiagnostics: raw.showAudioDiagnostics === true,
  };
}

export function loadExtraSettings(skins: readonly string[]): ExtraSettings {
  try {
    return normalizeExtraSettings(JSON.parse(localStorage.getItem(EXTRA_SETTINGS_KEY) || "{}"), skins);
  } catch {
    return { ...DEFAULT_EXTRA_SETTINGS, quietHours: { ...DEFAULT_EXTRA_SETTINGS.quietHours } };
  }
}

export function saveExtraSettings(settings: ExtraSettings): void {
  try {
    localStorage.setItem(EXTRA_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* storage blocked */
  }
}

function minutes(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

/**
 * True while quiet hours are running at `now`. Handles windows that cross
 * midnight (23:00–08:00). Equal start and end means "all day".
 */
export function isWithinQuietHours(quiet: QuietHours, now: Date = new Date()): boolean {
  if (!quiet.enabled) return false;
  const start = minutes(quiet.start);
  const end = minutes(quiet.end);
  const current = now.getHours() * 60 + now.getMinutes();
  if (start === end) return true;
  return start < end ? current >= start && current < end : current >= start || current < end;
}

/** Whether a notification of this kind is silenced right now by quiet hours. */
export function quietHoursSilences(
  quiet: QuietHours,
  kind: "dm" | "mention" | "other",
  now: Date = new Date(),
): boolean {
  if (!isWithinQuietHours(quiet, now)) return false;
  return !(quiet.allowMentions && (kind === "dm" || kind === "mention"));
}

/** Skin to show for the current OS colour scheme when following the system. */
export function resolveSkin(settings: ExtraSettings, manualSkin: string, prefersDark: boolean): string {
  if (settings.themeMode !== "system") return manualSkin;
  return prefersDark ? settings.darkSkin : settings.lightSkin;
}

/** Same check the OS uses for "reduce motion", honouring the user's override. */
export function motionReduced(settings: ExtraSettings, systemPrefersReduced: boolean): boolean {
  return settings.motion === "reduce" || (settings.motion === "system" && systemPrefersReduced);
}

export type Platform = "windows" | "mac" | "linux" | "other";

export function detectPlatform(userAgent: string, platformHint = ""): Platform {
  const value = `${platformHint} ${userAgent}`;
  if (/Win/i.test(value)) return "windows";
  if (/Mac|iPhone|iPad/i.test(value)) return "mac";
  if (/Linux|X11|CrOS/i.test(value)) return "linux";
  return "other";
}

/** "Windows", "macOS" or "your computer", for settings copy. */
export function platformName(platform: Platform): string {
  return platform === "windows"
    ? "Windows"
    : platform === "mac"
      ? "macOS"
      : platform === "linux"
        ? "Linux"
        : "your computer";
}
