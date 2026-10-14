// Profile accent: a row of swatches (the curated room accents, which start
// with the default #7c5cff). Desktop offers a free colour input, so an accent
// set there that is not a swatch is shown first and stays selectable.

import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { ROOM_ACCENT_SWATCHES } from "../../../../shared/room-style";
import { colors } from "@/src/theme";
import { styles } from "./profile.styles";

export function AccentPicker({
  accent,
  saving,
  onChange,
}: {
  accent: string;
  saving: boolean;
  onChange: (color: string) => void;
}) {
  const { t } = useTranslation(["settings", "hub"]);
  const current = accent.toLowerCase();
  const swatches: Array<{ color: string; name: string }> = ROOM_ACCENT_SWATCHES.map((swatch) => ({
    color: swatch.color,
    name: t(`hub.roomSettings.style.swatches.${swatch.label.toLowerCase()}`, { defaultValue: swatch.label }),
  }));
  if (/^#[0-9a-f]{6}$/.test(current) && !swatches.some((swatch) => swatch.color === current)) {
    swatches.unshift({ color: current, name: current });
  }

  return (
    <View style={styles.accentBlock}>
      <View style={styles.rowMain}>
        <Text style={[styles.accentLabel, { flex: 1 }]}>{t("settings.profile.accent")}</Text>
        {saving && <ActivityIndicator size="small" color={colors.cyan} />}
      </View>
      <View style={styles.swatches}>
        {swatches.map((swatch) => {
          const active = swatch.color === current;
          return (
            <Pressable
              key={swatch.color}
              style={[styles.swatch, { backgroundColor: swatch.color }, active && styles.swatchActive]}
              onPress={() => !active && onChange(swatch.color)}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel={t("hub.mobile.roomEditor.swatchAccent", { color: swatch.name })}
              accessibilityState={{ selected: active, disabled: saving }}
            >
              {active && <Ionicons name="checkmark" size={16} color="#fff" />}
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.accentHelp}>{t("settings.profile.accentHelp")}</Text>
    </View>
  );
}
