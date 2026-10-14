// Language choice on the Settings screen: follow the device, or one of the
// languages DeCave is translated into. Saved on this phone and the account.
// Collapsed to one row showing the current choice; tap to show the list.

import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { LANGUAGES, type Locale } from "../../../../shared/i18n/languages.ts";
import { setLocale, storedLocale } from "@/src/i18n";
import { styles } from "./settingsScreen.styles";
import { colors } from "@/src/theme";
import { MenuSection } from "./SettingsParts";

type Choice = Locale | "system";

export function LanguagePicker() {
  const { t } = useTranslation(["settings"]);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let active = true;
    void storedLocale().then((stored) => {
      if (active) setChoice((current) => current ?? stored ?? "system");
    });
    return () => {
      active = false;
    };
  }, []);

  const choose = (next: Choice) => {
    setChoice(next);
    void setLocale(next === "system" ? null : next);
  };

  const options: { value: Choice; label: string }[] = [
    { value: "system", label: t("settings.language.matchSystem") },
    ...LANGUAGES.map((language) => ({
      value: language.code,
      label: language.reviewed ? language.nativeName : t("settings.language.beta", { name: language.nativeName }),
    })),
  ];

  const current = options.find((option) => option.value === choice)?.label ?? "";

  return (
    <MenuSection title={t("settings.language.language")}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${t("settings.language.language")}, ${current}`}
        style={({ pressed }) => [styles.menuRow, !expanded && styles.menuRowLast, pressed && styles.menuRowPressed]}
        onPress={() => setExpanded((value) => !value)}
      >
        <View style={[styles.menuRowIcon, { backgroundColor: "#67E8F922" }]}>
          <Ionicons name="language-outline" size={19} color="#67E8F9" />
        </View>
        <View style={styles.menuRowCopy}>
          <Text style={styles.menuRowTitle}>{t("settings.language.language")}</Text>
          <Text style={styles.menuRowDetail} numberOfLines={1}>
            {current}
          </Text>
        </View>
        <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={18} color={colors.faint} />
      </Pressable>
      {expanded && (
        <View style={styles.languageList}>
          <Text style={styles.choiceHelp}>{t("settings.language.languageHelp")}</Text>
          <View style={styles.previewStack}>
            {options.map(({ value, label }) => {
              const active = choice === value;
              return (
                <Pressable
                  key={value}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active }}
                  accessibilityLabel={label}
                  style={[styles.previewButton, active && styles.previewButtonActive]}
                  onPress={() => choose(value)}
                >
                  <View style={[styles.radio, active && styles.radioActive]}>
                    {active && <View style={styles.radioInner} />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.previewButtonTitle, active && styles.previewButtonTitleActive]}>{label}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}
    </MenuSection>
  );
}
