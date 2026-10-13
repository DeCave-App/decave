import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { colors } from "@/src/theme";

/** Replaces an empty list when loading failed, so "nothing here" and "couldn't load" look different. */
export function LoadError({ message, onRetry }: { message?: string; onRetry: () => void }) {
  const { t } = useTranslation(["common"]);
  return (
    <View style={styles.box} accessibilityRole="alert">
      <Ionicons name="cloud-offline-outline" size={28} color={colors.muted} />
      <Text style={styles.title}>{t("common.mobile.loadError.title")}</Text>
      <Text style={styles.detail}>{message || t("common.mobile.loadError.detail")}</Text>
      <Pressable accessibilityRole="button" onPress={onRetry} style={({ pressed }) => [styles.retry, pressed && { opacity: 0.75 }]}>
        <Ionicons name="refresh" size={16} color="#FFFFFF" />
        <Text style={styles.retryText}>{t("common.mobile.tryAgain")}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: "center", paddingVertical: 36, paddingHorizontal: 24, gap: 6 },
  title: { color: colors.text, fontSize: 16, fontWeight: "800", marginTop: 4 },
  detail: { color: colors.muted, fontSize: 14, textAlign: "center", lineHeight: 20 },
  retry: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10, minHeight: 44, paddingHorizontal: 18, borderRadius: 14, backgroundColor: colors.violet },
  retryText: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
});
