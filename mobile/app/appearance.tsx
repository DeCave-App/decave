import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Screen } from "@/src/components/Screen";
import { reloadAppAsync } from "expo";
import * as SecureStore from "expo-secure-store";
import { SKINS, type SkinId, useSkin } from "@/src/skin";
import { COLOR_MODE_KEY, colorMode, type ColorMode } from "@/src/theme";

export default function AppearanceScreen() {
  const { skin: activeSkin, setSkin, palette: activePalette } = useSkin();
  const [selectedSkinId, setSelectedSkinId] = useState<SkinId>(activeSkin.id);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const selectedSkin = useMemo(
    () => SKINS.find((skin) => skin.id === selectedSkinId) ?? activeSkin,
    [activeSkin, selectedSkinId],
  );
  // Light mode keeps light surfaces and previews the skin's accent.
  const palette = colorMode === "light" ? { ...activePalette, accent: selectedSkin.lightAccent } : selectedSkin.palette;
  const hasChanges = selectedSkinId !== activeSkin.id;

  useEffect(() => {
    setSelectedSkinId(activeSkin.id);
  }, [activeSkin.id]);

  const chooseMode = async (mode: ColorMode) => {
    if (mode === colorMode) return;
    await SecureStore.setItemAsync(COLOR_MODE_KEY, mode);
    // Styles are built at startup, so the new palette needs a reload.
    await reloadAppAsync("Color mode changed");
  };

  const saveSkin = async () => {
    if (!hasChanges || saving) return;
    setSaving(true);
    setSaved(false);
    await setSkin(selectedSkinId);
    setSaving(false);
    setSaved(true);
  };

  return (
    <Screen>
      <View style={[styles.top, { backgroundColor: palette.bg, borderBottomColor: palette.border }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" style={[styles.back, { backgroundColor: palette.panel, borderColor: palette.border }]} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={22} color={palette.accent} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text maxFontSizeMultiplier={1.3} style={[styles.kicker, { color: palette.accent }]}>APPEARANCE</Text>
          <Text style={[styles.title, { color: palette.text }]}>Skins</Text>
        </View>
        <Ionicons name="color-palette-outline" size={22} color={palette.accent} />
      </View>

      <ScrollView keyboardDismissMode="on-drag" contentContainerStyle={[styles.scroll, { backgroundColor: palette.bg }]}>
        <Text style={[styles.modeLabel, { color: palette.muted }]}>MODE</Text>
        <View style={[styles.modeRow, { backgroundColor: palette.panel, borderColor: palette.border }]}>
          {(["dark", "light"] as const).map((mode) => {
            const active = colorMode === mode;
            return (
              <Pressable
                key={mode}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => void chooseMode(mode)}
                style={[styles.modeButton, active && { backgroundColor: palette.accentSoft, borderColor: palette.accent }]}
              >
                <Ionicons name={mode === "dark" ? "moon-outline" : "sunny-outline"} size={18} color={active ? palette.accent : palette.muted} />
                <Text style={[styles.modeText, { color: active ? palette.text : palette.muted }]}>{mode === "dark" ? "Dark" : "Light"}</Text>
              </Pressable>
            );
          })}
        </View>
        {colorMode === "light" && (
          <Text style={[styles.help, { color: palette.muted, marginBottom: 14 }]}>In Light mode a skin sets the accent color; Dark mode uses its full look.</Text>
        )}
        <Text style={[styles.help, { color: palette.muted }]}>Choose a visual style, preview it here, then tap Save skin. DeCave restarts with the new look, and your choice is stored on this device.</Text>
        <View style={styles.grid}>
          {SKINS.map((skin) => {
            const selected = skin.id === selectedSkinId;
            return (
              <Pressable accessibilityRole="button"
                key={skin.id}
                style={[
                  styles.card,
                  { backgroundColor: skin.palette.panel, borderColor: selected ? skin.palette.accent : skin.palette.border },
                ]}
                onPress={() => { setSelectedSkinId(skin.id); setSaved(false); }}
              >
                <View style={[styles.preview, { backgroundColor: skin.palette.bg, borderColor: skin.palette.border }]}>
                  <View style={[styles.previewNav, { backgroundColor: skin.palette.nav }]} />
                  <View style={styles.previewMain}>
                    <View style={[styles.previewLine, { backgroundColor: skin.palette.accent }]} />
                    <View style={[styles.previewLineShort, { backgroundColor: skin.palette.muted }]} />
                  </View>
                </View>
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.cardTitle, { color: skin.palette.text }]}>{skin.name}</Text>
                    <Text style={[styles.cardText, { color: skin.palette.muted }]}>{skin.description}</Text>
                  </View>
                  {selected && <Ionicons name="checkmark-circle" size={20} color={skin.palette.accent} />}
                </View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
      <View style={[styles.saveFooter, { backgroundColor: palette.bg, borderTopColor: palette.border }]}>
        {saved && !hasChanges && <Text style={[styles.savedText, { color: palette.accent }]}>Skin saved</Text>}
        <Pressable accessibilityRole="button"
          style={[
            styles.saveButton,
            { backgroundColor: palette.accent },
            (!hasChanges || saving) && styles.saveButtonDisabled,
          ]}
          disabled={!hasChanges || saving}
          onPress={() => void saveSkin()}
        >
          <Ionicons name="checkmark" size={18} color={palette.bg} />
          <Text style={[styles.saveButtonText, { color: palette.bg }]}>{saving ? "Saving…" : hasChanges ? "Save skin" : "Skin saved"}</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  modeLabel: { fontSize: 12, fontWeight: "900", letterSpacing: 1.3, marginBottom: 8 },
  modeRow: { flexDirection: "row", gap: 6, padding: 5, borderRadius: 16, borderWidth: 1, marginBottom: 14 },
  modeButton: { flex: 1, height: 46, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, borderWidth: 1, borderColor: "transparent" },
  modeText: { fontSize: 15, fontWeight: "800" },
  top: { minHeight: 76, flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 1 },
  back: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  kicker: { fontSize: 11, fontWeight: "900", letterSpacing: 1.8 },
  title: { fontSize: 21, fontWeight: "900", marginTop: 1 },
  scroll: { padding: 14, paddingBottom: 24, flexGrow: 1 },
  help: { fontSize: 12, lineHeight: 16, marginBottom: 12 },
  grid: { gap: 10 },
  card: { padding: 11, borderRadius: 18, borderWidth: 1 },
  preview: { height: 76, borderRadius: 13, borderWidth: 1, overflow: "hidden", flexDirection: "row" },
  previewNav: { width: 25 },
  previewMain: { flex: 1, padding: 12, justifyContent: "center", gap: 9 },
  previewLine: { width: "63%", height: 7, borderRadius: 99 },
  previewLineShort: { width: "42%", height: 5, borderRadius: 99, opacity: 0.7 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10 },
  cardTitle: { fontSize: 12, fontWeight: "900" },
  cardText: { fontSize: 13, lineHeight: 12, marginTop: 2 },
  saveFooter: { paddingHorizontal: 14, paddingTop: 9, paddingBottom: 12, borderTopWidth: StyleSheet.hairlineWidth },
  savedText: { marginBottom: 6, textAlign: "center", fontSize: 12, fontWeight: "800" },
  saveButton: { minHeight: 46, borderRadius: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  saveButtonDisabled: { opacity: 0.48 },
  saveButtonText: { fontSize: 13, fontWeight: "900" },
});
