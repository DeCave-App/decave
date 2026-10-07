import { StyleSheet, Text, View } from "react-native";
import { colors } from "@/src/theme";

/**
 * The pressed message, lifted above the action menu (like iOS context menus),
 * so it is clear which message the actions apply to.
 */
export function MessagePreview({ author, text, mine }: { author: string; text: string; mine?: boolean }) {
  const body = text.trim() || "Attachment";
  return (
    <View style={[styles.bubble, mine && styles.mine]} accessible accessibilityLabel={`Message from ${author}: ${body}`}>
      <Text style={styles.author} numberOfLines={1}>
        {mine ? "You" : author}
      </Text>
      <Text style={styles.text} numberOfLines={5}>
        {body}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    alignSelf: "flex-start",
    maxWidth: "92%",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    borderTopLeftRadius: 6,
    backgroundColor: colors.panel2,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 14,
  },
  mine: { alignSelf: "flex-end", borderTopLeftRadius: 18, borderTopRightRadius: 6, borderColor: colors.violet },
  author: { color: colors.cyan, fontSize: 13, fontWeight: "800", marginBottom: 3 },
  text: { color: colors.text, fontSize: 15, lineHeight: 21 },
});
