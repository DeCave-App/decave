// Settings → Chat: 12/24-hour message times and large emoji. Both are account
// settings shared with desktop and web; chat screens read them from the
// account preferences store.

import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { updateAccountPreferences, type AccountPreferencesPatch, type TimeFormat } from "@/src/lib/account-preferences";
import {
  setAccountPreferencesSnapshot,
  showsLargeEmoji,
  useAccountPreferencesSnapshot,
} from "@/src/lib/account-preferences-store";
import { useSession } from "@/src/providers/SessionProvider";
import { styles } from "./settingsScreen.styles";
import { MenuSection, SettingToggle } from "./SettingsParts";

const TIME_FORMATS: TimeFormat[] = ["system", "12h", "24h"];

export function ChatPreferences() {
  const { t } = useTranslation(["settings"]);
  const { token } = useSession();
  const prefs = useAccountPreferencesSnapshot();
  const [error, setError] = useState("");

  const save = async (patch: AccountPreferencesPatch) => {
    if (!token || !prefs) return;
    const previous = prefs;
    // Show the change at once; the server's copy replaces it when saved.
    setAccountPreferencesSnapshot({
      ...prefs,
      ...(patch.timeFormat ? { timeFormat: patch.timeFormat } : {}),
      clientSettings: patch.clientSettingsPatch?.chat
        ? {
            ...prefs.clientSettings,
            chat: { ...prefs.clientSettings?.chat, ...patch.clientSettingsPatch.chat },
          }
        : prefs.clientSettings,
    });
    setError("");
    try {
      setAccountPreferencesSnapshot(await updateAccountPreferences(token, patch));
    } catch (cause) {
      setAccountPreferencesSnapshot(previous);
      setError(cause instanceof Error ? cause.message : t("settings.mobile.accountSecurity.couldNotSaveThisSetting"));
    }
  };

  const timeFormat = prefs?.timeFormat ?? "system";

  return (
    <MenuSection title={t("settings.tabs.chat.label")}>
      <View style={{ padding: 13 }}>
        <Text style={styles.toggleTitle}>{t("settings.language.timeFormat")}</Text>
        <Text style={[styles.toggleHelp, { lineHeight: 17 }]}>{t("settings.language.timeFormatHelp")}</Text>
        <View style={styles.qualityRow}>
          {TIME_FORMATS.map((value) => {
            const active = timeFormat === value;
            return (
              <Pressable
                key={value}
                accessibilityRole="radio"
                accessibilityState={{ checked: active, disabled: !prefs }}
                style={[styles.qualityButton, active && styles.qualityButtonActive]}
                disabled={!prefs}
                onPress={() => value !== timeFormat && void save({ timeFormat: value })}
              >
                <Text style={[styles.qualityButtonText, active && styles.qualityButtonTextActive]}>
                  {t(`settings.language.timeFormats.${value}`)}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <SettingToggle
          icon="happy-outline"
          title={t("settings.chat.largeEmoji")}
          detail={t("settings.chat.largeEmojiHelp")}
          value={showsLargeEmoji(prefs)}
          onValueChange={(value) => void save({ clientSettingsPatch: { chat: { largeEmoji: value } } })}
        />
        {!!error && <Text style={styles.syncError}>{error}</Text>}
      </View>
    </MenuSection>
  );
}
