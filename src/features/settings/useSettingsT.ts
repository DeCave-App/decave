// t() for Settings: keys look like settings.area.purpose. tk() looks up
// keys held as data (the settings map, option lists), which the compiler
// can't check; the catalog test checks that those keys exist.

import { useTranslation } from "react-i18next";
import type { Platform } from "./extraSettings";

export type LooseTranslate = (key: string, options?: Record<string, unknown>) => string;

export function useSettingsT() {
  const { t, i18n } = useTranslation(["settings"]);
  const tk = t as unknown as LooseTranslate;
  return { t, tk, i18n };
}

/** "Windows", "macOS", "Linux" (names stay as they are), or "your computer" in the UI language. */
export function platformLabel(platform: Platform, tk: LooseTranslate): string {
  return platform === "windows"
    ? "Windows"
    : platform === "mac"
      ? "macOS"
      : platform === "linux"
        ? "Linux"
        : tk("settings.app.yourComputer");
}
