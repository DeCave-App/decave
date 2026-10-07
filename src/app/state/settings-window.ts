// The Settings window itself: open tab, search, unsaved changes, saving, and
// the confirm-before-closing prompt.

import { useState } from "react";
import type { SettingsTab } from "../types";

export function useSettingsWindowState() {
  const [settingsSearch, setSettingsSearch] = useState("");
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsCloseConfirm, setSettingsCloseConfirm] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("profile");

  return {
    settingsSearch,
    setSettingsSearch,
    settingsDirty,
    setSettingsDirty,
    settingsSaving,
    setSettingsSaving,
    settingsCloseConfirm,
    setSettingsCloseConfirm,
    settingsTab,
    setSettingsTab,
  };
}

export type SettingsWindowState = ReturnType<typeof useSettingsWindowState>;
