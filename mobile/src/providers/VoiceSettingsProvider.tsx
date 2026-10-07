import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import * as SecureStore from "expo-secure-store";

export type ScreenShareQuality = "dataSaver" | "balanced" | "full";

export type VoiceSettings = {
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
  joinMuted: boolean;
  screenShareQuality: ScreenShareQuality;
};

type VoiceSettingsContextValue = {
  settings: VoiceSettings;
  loaded: boolean;
  updateSettings: (patch: Partial<VoiceSettings>) => void;
  resetSettings: () => void;
};

const STORAGE_KEY = "decave_mobile_voice_settings_v1";

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
  joinMuted: false,
  screenShareQuality: "balanced",
};

const VoiceSettingsContext = createContext<VoiceSettingsContextValue | null>(null);

function normalize(value: Partial<VoiceSettings> | null | undefined): VoiceSettings {
  const quality: ScreenShareQuality =
    value?.screenShareQuality === "dataSaver" ||
    value?.screenShareQuality === "full"
      ? value.screenShareQuality
      : "balanced";

  return {
    noiseSuppression:
      typeof value?.noiseSuppression === "boolean"
        ? value.noiseSuppression
        : DEFAULT_VOICE_SETTINGS.noiseSuppression,
    echoCancellation:
      typeof value?.echoCancellation === "boolean"
        ? value.echoCancellation
        : DEFAULT_VOICE_SETTINGS.echoCancellation,
    autoGainControl:
      typeof value?.autoGainControl === "boolean"
        ? value.autoGainControl
        : DEFAULT_VOICE_SETTINGS.autoGainControl,
    joinMuted:
      typeof value?.joinMuted === "boolean"
        ? value.joinMuted
        : DEFAULT_VOICE_SETTINGS.joinMuted,
    screenShareQuality: quality,
  };
}

export function VoiceSettingsProvider({ children }: PropsWithChildren) {
  const [settings, setSettings] = useState<VoiceSettings>(DEFAULT_VOICE_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;

    void SecureStore.getItemAsync(STORAGE_KEY)
      .then((raw) => {
        if (!active || !raw) return;
        try {
          setSettings(normalize(JSON.parse(raw) as Partial<VoiceSettings>));
        } catch {}
      })
      .finally(() => {
        if (active) setLoaded(true);
      });

    return () => {
      active = false;
    };
  }, []);

  const persist = (next: VoiceSettings) => {
    setSettings(next);
    void SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
  };

  const value = useMemo<VoiceSettingsContextValue>(
    () => ({
      settings,
      loaded,
      updateSettings: (patch) => persist({ ...settings, ...patch }),
      resetSettings: () => persist(DEFAULT_VOICE_SETTINGS),
    }),
    [settings, loaded],
  );

  return (
    <VoiceSettingsContext.Provider value={value}>
      {children}
    </VoiceSettingsContext.Provider>
  );
}

export function useVoiceSettings(): VoiceSettingsContextValue {
  const value = useContext(VoiceSettingsContext);
  if (!value) {
    throw new Error("useVoiceSettings must be used inside VoiceSettingsProvider");
  }
  return value;
}
