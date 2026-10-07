import { StyleSheet, Text, View } from "react-native";
import { colors } from "@/src/theme";

export function EmptyState({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  return (
    <View style={styles.box}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.detail}>{detail}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    padding: 24,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    alignItems: "center",
  },
  title: { color: colors.text, fontWeight: "800", fontSize: 16 },
  detail: {
    color: colors.muted,
    textAlign: "center",
    marginTop: 7,
    lineHeight: 20,
  },
});
