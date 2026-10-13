import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { colors } from "@/src/theme";

/** Shown above the composer when a message couldn't be sent; the text stays in the box. */
export function SendFailedBanner({ onRetry, onDismiss }: { onRetry: () => void; onDismiss: () => void }) {
  const { t } = useTranslation(["common", "chat"]);
  return (
    <View style={styles.banner} accessibilityRole="alert">
      <Ionicons name="alert-circle" size={16} color={colors.red} />
      <Text style={styles.text} numberOfLines={2}>
        {t("chat.mobile.sendFailed.text")}
      </Text>
      <Pressable accessibilityRole="button" accessibilityLabel={t("chat.mobile.sendFailed.retryLabel")} onPress={onRetry} hitSlop={6} style={styles.retry}>
        <Text style={styles.retryText}>{t("common.actions.retry")}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={t("common.actions.dismiss")} onPress={onDismiss} hitSlop={8}>
        <Ionicons name="close" size={16} color={colors.muted} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
    borderRadius: 12,
    backgroundColor: colors.redSoft,
  },
  text: { flex: 1, color: colors.text, fontSize: 13, fontWeight: "600" },
  retry: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 9, backgroundColor: colors.panel2 },
  retryText: { color: colors.cyan, fontSize: 13, fontWeight: "800" },
});
