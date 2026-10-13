// Signed-in device names in the UI language (see shared/session-device.ts).

import { countryName, sessionDeviceFromJson, sessionDeviceText } from "../../../shared/session-device";
import { i18next } from "../i18n";

const translate = (key: string, options?: Record<string, string>): string =>
  (i18next.t as unknown as (key: string, options?: Record<string, string>) => string)(key, options);

/** A device name: translated from the Worker's `device` parts when sent, else its English `label`. */
export function deviceName(label: string, device: unknown): string {
  const parts = sessionDeviceFromJson(device);
  return parts ? sessionDeviceText(parts, translate, i18next.language || "en", label) : label;
}

/** A two-letter country in the UI language, or null when the code is missing. */
export function countryText(country: unknown): string | null {
  return typeof country === "string" && /^[A-Z]{2}$/.test(country)
    ? countryName(country, i18next.language || "en")
    : null;
}
