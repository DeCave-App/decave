import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { POLL_MAX_OPTIONS, POLL_MIN_OPTIONS, POLL_OPTION_MAX, POLL_QUESTION_MAX, pollMessageText } from "@/src/lib/polls";
import { colors } from "@/src/theme";

/** Create a poll (2–8 options), like web's PollComposerDialog. `onPost` gets the message text. */
export function PollComposerSheet({
  visible,
  onClose,
  onPost,
}: {
  visible: boolean;
  onClose: () => void;
  onPost: (text: string) => Promise<boolean> | boolean;
}) {
  const { t } = useTranslation(["chat", "common"]);
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    if (visible) return;
    setQuestion("");
    setOptions(["", ""]);
  }, [visible]);

  const text = pollMessageText(question, options);

  const post = async () => {
    if (!text || posting) return;
    setPosting(true);
    try {
      if (await onPost(text)) onClose();
    } finally {
      setPosting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.grabber} />
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 10 }}>
              <Text maxFontSizeMultiplier={1.3} style={styles.kicker}>{t("chat.poll.kicker")}</Text>
              <Text style={styles.title} accessibilityRole="header">{t("chat.poll.title")}</Text>
              <Text style={styles.lead}>{t("chat.poll.lead")}</Text>

              <Text style={styles.label}>{t("chat.poll.question")}</Text>
              <TextInput
                value={question}
                onChangeText={setQuestion}
                placeholder={t("chat.poll.questionPlaceholder")}
                placeholderTextColor={colors.faint}
                maxLength={POLL_QUESTION_MAX}
                style={styles.input}
                autoFocus
              />

              {options.map((option, index) => (
                <View key={index} style={styles.optionRow}>
                  <TextInput
                    value={option}
                    onChangeText={(value) => setOptions((current) => current.map((item, i) => (i === index ? value : item)))}
                    placeholder={t("chat.poll.option", { number: index + 1 })}
                    accessibilityLabel={t("chat.poll.option", { number: index + 1 })}
                    placeholderTextColor={colors.faint}
                    maxLength={POLL_OPTION_MAX}
                    style={[styles.input, { flex: 1 }]}
                  />
                  {options.length > POLL_MIN_OPTIONS && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t("chat.poll.removeOption", { number: index + 1 })}
                      style={styles.remove}
                      hitSlop={6}
                      onPress={() => setOptions((current) => current.filter((_item, i) => i !== index))}
                    >
                      <Ionicons name="close" size={18} color={colors.muted} />
                    </Pressable>
                  )}
                </View>
              ))}

              {options.length < POLL_MAX_OPTIONS && (
                <Pressable accessibilityRole="button" style={styles.add} onPress={() => setOptions((current) => [...current, ""])}>
                  <Ionicons name="add" size={18} color={colors.cyan} />
                  <Text style={styles.addText}>{t("chat.poll.addOption")}</Text>
                </Pressable>
              )}

              <View style={styles.footer}>
                <Pressable accessibilityRole="button" style={styles.cancel} onPress={onClose}>
                  <Text style={styles.cancelText}>{t("common.actions.cancel")}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !text || posting }}
                  disabled={!text || posting}
                  style={[styles.primary, (!text || posting) && styles.disabled]}
                  onPress={() => void post()}
                >
                  <Text style={styles.primaryText}>{t("chat.poll.post")}</Text>
                </Pressable>
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(2,5,12,.72)" },
  sheet: { maxHeight: "88%", padding: 16, paddingBottom: 30, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border },
  grabber: { alignSelf: "center", width: 42, height: 4, borderRadius: 99, backgroundColor: colors.border, marginBottom: 14 },
  kicker: { color: colors.cyan, fontSize: 11, fontWeight: "900", letterSpacing: 0.6, textTransform: "uppercase" },
  title: { color: colors.text, fontSize: 20, fontWeight: "900" },
  lead: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  label: { color: colors.muted, fontSize: 12, fontWeight: "900", marginTop: 4 },
  input: { minHeight: 44, paddingHorizontal: 12, borderRadius: 12, color: colors.text, backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border, fontSize: 15 },
  optionRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  remove: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.panel2 },
  add: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingVertical: 8 },
  addText: { color: colors.cyan, fontSize: 14, fontWeight: "800" },
  footer: { flexDirection: "row", gap: 10, marginTop: 6 },
  cancel: { flex: 1, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: colors.panel2 },
  cancelText: { color: colors.text, fontSize: 15, fontWeight: "800" },
  primary: { flex: 1, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: colors.cyan },
  primaryText: { color: "#061018", fontSize: 15, fontWeight: "900" },
  disabled: { opacity: 0.45 },
});
