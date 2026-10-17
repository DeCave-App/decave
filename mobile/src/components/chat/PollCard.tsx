import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { tallyPoll, type PollPayload, type Reactions } from "@/src/lib/polls";
import { tapHaptic } from "@/src/lib/haptics";
import { colors } from "@/src/theme";

/** A poll message: tap an option to vote, tap another to move your vote. */
export function PollCard({
  poll,
  reactions,
  userId,
  onVote,
}: {
  poll: PollPayload;
  reactions: Reactions;
  userId: string | null | undefined;
  onVote: (optionIndex: number) => void;
}) {
  const { t } = useTranslation(["chat"]);
  const { counts, total, mine } = tallyPoll(poll, reactions, userId);

  return (
    <View style={styles.card}>
      <Text maxFontSizeMultiplier={1.3} style={styles.kicker}>{t("chat.actions.poll.kicker")}</Text>
      <Text style={styles.question}>{poll.question}</Text>
      <View style={styles.options}>
        {poll.options.map((option, index) => {
          const count = counts[index] ?? 0;
          const percent = total ? Math.round((count / total) * 100) : 0;
          const selected = mine === index;
          return (
            <Pressable
              key={index}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`${option}, ${t("chat.actions.poll.votes", { count })}, ${percent}%`}
              style={({ pressed }) => [styles.option, selected && styles.optionSelected, pressed && styles.pressed]}
              onPress={() => {
                tapHaptic();
                onVote(index);
              }}
            >
              <View style={[styles.bar, { width: `${percent}%` }, selected && styles.barSelected]} />
              {selected && <Ionicons name="checkmark-circle" size={16} color={colors.cyan} />}
              <Text style={styles.optionText} numberOfLines={3}>{option}</Text>
              <Text maxFontSizeMultiplier={1.3} style={styles.optionCount}>{count} · {percent}%</Text>
            </Pressable>
          );
        })}
      </View>
      <Text maxFontSizeMultiplier={1.3} style={styles.total}>{t("chat.actions.poll.votes", { count: total })}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: 4, padding: 12, borderRadius: 14, backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border, gap: 8, maxWidth: 420 },
  kicker: { color: colors.cyan, fontSize: 11, fontWeight: "900", letterSpacing: 0.6 },
  question: { color: colors.text, fontSize: 15, fontWeight: "800" },
  options: { gap: 6 },
  option: { minHeight: 42, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 11, overflow: "hidden", borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panel },
  optionSelected: { borderColor: colors.cyan },
  pressed: { opacity: 0.75 },
  bar: { position: "absolute", left: 0, top: 0, bottom: 0, backgroundColor: colors.violetSoft },
  barSelected: { backgroundColor: colors.cyanSoft },
  optionText: { flex: 1, color: colors.text, fontSize: 14, fontWeight: "700" },
  optionCount: { color: colors.muted, fontSize: 12, fontWeight: "800" },
  total: { color: colors.faint, fontSize: 12, fontWeight: "700" },
});
