// How a settings control saves: it changes app state, then asks the Settings
// window to persist the parts that state lives in. The window waits for React
// to commit the change first, so the save sends the new values.

import { createContext, useContext } from "react";

/** Which stores a settings change needs to reach. */
export type SettingsPart = "profile" | "account" | "device" | "desktop";

export const ALL_SETTINGS_PARTS: readonly SettingsPart[] = ["profile", "account", "device", "desktop"];

/** Rejects when the save failed (offline, server error). */
export type PersistSettings = (parts?: readonly SettingsPart[]) => Promise<void>;

export const SettingsPersistContext = createContext<PersistSettings>(async () => undefined);

export function useSettingsPersist(): PersistSettings {
  return useContext(SettingsPersistContext);
}
