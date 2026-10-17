import { Image, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { GLASS_BACKDROPS, GLASS_STYLES, type GlassSettings } from "@/src/glass-data";
import { glassWallpaper } from "@/src/components/GlassBackdrop";
import type { Palette } from "@/src/skins-data";

type Props = {
  value: GlassSettings;
  onChange: (next: GlassSettings) => void;
  palette: Palette;
  skinId: string;
  /** Glass draws only in Dark mode; Light mode shows a note instead of the options. */
  darkMode: boolean;
};

/** Settings → Appearance: Liquid Glass on top of the chosen skin (applied on Save). */
export function GlassSettingsCard({ value, onChange, palette, skinId, darkMode }: Props) {
  const { t } = useTranslation(["settings"]);
  const backdropLabel = (id: string): string =>
    id === "skin"
      ? t("settings.mobile.appearance.glass.skinColors")
      : String(t(`settings.appearance.glass.backdrop.${id}.label` as never));
  return (
    <View style={[styles.card, { backgroundColor: palette.panel, borderColor: palette.border }]}>
      <View style={styles.head}>
        <Ionicons name="water-outline" size={20} color={palette.accent} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: palette.text }]}>{t("settings.appearance.glass.label")}</Text>
          <Text style={[styles.help, { color: palette.muted }]}>{t("settings.mobile.appearance.glass.help")}</Text>
        </View>
        <Switch
          accessibilityLabel={t("settings.appearance.glass.label")}
          value={value.enabled}
          onValueChange={(enabled) => onChange({ ...value, enabled })}
          trackColor={{ true: palette.accent }}
        />
      </View>

      {value.enabled && !darkMode && (
        <Text style={[styles.note, { color: palette.muted }]}>{t("settings.mobile.appearance.glass.darkOnly")}</Text>
      )}

      {value.enabled && darkMode && (
        <>
          <Text style={[styles.label, { color: palette.muted }]}>{t("settings.appearance.glass.styleLabel")}</Text>
          <View style={styles.segment}>
            {GLASS_STYLES.map((id) => {
              const active = value.style === id;
              return (
                <Pressable
                  key={id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  onPress={() => onChange({ ...value, style: id })}
                  style={[
                    styles.option,
                    { borderColor: active ? palette.accent : palette.border, backgroundColor: active ? palette.accentSoft : "transparent" },
                  ]}
                >
                  <Text style={[styles.optionTitle, { color: palette.text }]}>{t(`settings.appearance.glass.${id}.label`)}</Text>
                  <Text style={[styles.optionText, { color: palette.muted }]}>{t(`settings.appearance.glass.${id}.detail`)}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={[styles.label, { color: palette.muted }]}>{t("settings.appearance.glass.backdropLabel")}</Text>
          <View style={styles.backdrops}>
            {GLASS_BACKDROPS.map((id) => {
              const active = value.backdrop === id;
              return (
                <Pressable
                  key={id}
                  accessibilityRole="radio"
                  accessibilityLabel={backdropLabel(id)}
                  accessibilityState={{ selected: active }}
                  onPress={() => onChange({ ...value, backdrop: id })}
                  style={[styles.backdrop, { borderColor: active ? palette.accent : palette.border }]}
                >
                  <Image source={glassWallpaper(id, skinId)} style={styles.swatch} resizeMode="cover" />
                  <Text numberOfLines={1} style={[styles.backdropText, { color: active ? palette.text : palette.muted }]}>
                    {backdropLabel(id)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 13, borderRadius: 18, borderWidth: 1, gap: 10, marginBottom: 14 },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { fontSize: 15, fontWeight: "900" },
  help: { fontSize: 12, lineHeight: 16, marginTop: 2 },
  note: { fontSize: 12, lineHeight: 16 },
  label: { fontSize: 12, fontWeight: "900", letterSpacing: 0.6, marginTop: 2 },
  segment: { flexDirection: "row", gap: 8 },
  option: { flex: 1, padding: 10, borderRadius: 12, borderWidth: 1, gap: 2 },
  optionTitle: { fontSize: 13, fontWeight: "900" },
  optionText: { fontSize: 11, lineHeight: 14 },
  backdrops: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  backdrop: { width: "31%", flexGrow: 1, borderRadius: 12, borderWidth: 2, overflow: "hidden" },
  swatch: { width: "100%", height: 54 },
  backdropText: { fontSize: 11, fontWeight: "800", paddingHorizontal: 7, paddingVertical: 5 },
});
