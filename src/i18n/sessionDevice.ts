// Signed-in device names in the UI language (see shared/session-device.ts).

import { sessionDeviceFromJson, sessionDeviceText } from "../../shared/session-device";
import { i18next } from "./index.ts";

const translate = (key: string, options?: Record<string, string>): string =>
  (i18next.t as unknown as (key: string, options?: Record<string, string>) => string)(key, options);

/** A device name: translated from the Worker's `device` parts when sent, else its English `label`. */
export function deviceName(label: string, device: unknown): string {
  const parts = sessionDeviceFromJson(device);
  return parts ? sessionDeviceText(parts, translate, i18next.language || "en", label) : label;
}
