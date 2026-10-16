import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as SecureStore from "expo-secure-store";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { fetchAndroidUpdate, type AndroidUpdate } from "@/src/lib/android-update";
import { colors } from "@/src/theme";

const DISMISSED_KEY = "decave.androidUpdate.dismissedVersionCode";
const CHECK_EVERY_MS = 30 * 60 * 1000;

/**
 * Android builds are shared as an APK from de-cave.com rather than a store,
 * so nothing else tells people a new one is out. On launch and when the app
 * comes back to the foreground, compares this build with the published
 * latest.json and offers the download. Dismissing hides that version only.
 */
export function AndroidUpdateBanner() {
  const { t } = useTranslation(["common"]);
  const insets = useSafeAreaInsets();
  const [update, setUpdate] = useState<AndroidUpdate | null>(null);
  const lastCheck = useRef(0);

  const check = useCallback(async () => {
    if (Date.now() - lastCheck.current < CHECK_EVERY_MS) return;
    lastCheck.current = Date.now();
    const next = await fetchAndroidUpdate();
    if (!next) return setUpdate(null);
    const dismissed = Number(await SecureStore.getItemAsync(DISMISSED_KEY).catch(() => null));
    setUpdate(dismissed === next.versionCode ? null : next);
  }, []);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    void check();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void check();
    });
    return () => sub.remove();
  }, [check]);

  if (!update) return null;

  const dismiss = () => {
    setUpdate(null);
    void SecureStore.setItemAsync(DISMISSED_KEY, String(update.versionCode)).catch(() => undefined);
  };

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { top: insets.top + 8 }]}>
      <View style={styles.banner} accessibilityRole="alert">
        <Ionicons name="arrow-down-circle" size={22} color={colors.cyan} />
        <View style={styles.copy}>
          <Text style={styles.title}>{t("common.mobile.appUpdate.title")}</Text>
          <Text style={styles.body} numberOfLines={2}>
            {t("common.mobile.appUpdate.body", { version: update.versionName })}
          </Text>
        </View>
        <Pressable accessibilityRole="button" onPress={() => void Linking.openURL(update.url)} hitSlop={6} style={styles.action}>
          <Text style={styles.actionText}>{t("common.mobile.appUpdate.download")}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t("common.actions.dismiss")} onPress={dismiss} hitSlop={10}>
          <Ionicons name="close" size={18} color={colors.muted} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 12, right: 12, zIndex: 50, elevation: 50 },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.panel2,
  },
  copy: { flex: 1 },
  title: { color: colors.text, fontSize: 14, fontWeight: "800" },
  body: { color: colors.muted, fontSize: 12.5, marginTop: 1 },
  action: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, backgroundColor: colors.violet },
  actionText: { color: "#fff", fontSize: 13, fontWeight: "800" },
});
