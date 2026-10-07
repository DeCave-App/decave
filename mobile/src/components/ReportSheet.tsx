import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { apiJson } from "@/src/lib/api";
import { colors } from "@/src/theme";
import { REPORT_CATEGORIES, type ReportCategory, type ReportTargetType, type ReportUrgency } from "@/src/types";

const labels: Record<ReportCategory, string> = {
  HARASSMENT_BULLYING: "Harassment",
  HATE_SPEECH: "Hate speech",
  SEXUAL_INAPPROPRIATE: "Sexual content",
  SUSPECTED_GROOMING: "Grooming",
  CHILD_SAFETY: "Child safety",
  THREATS_VIOLENCE: "Threats",
  SPAM_SCAM: "Spam or scam",
  IMPERSONATION: "Impersonation",
  UNDERAGE_USER: "Underage user",
  INAPPROPRIATE_MEDIA: "Inappropriate media",
  SELF_HARM: "Self-harm",
  OTHER: "Other",
};

export type MobileReportTarget = {
  targetType: ReportTargetType;
  targetId: string;
  subjectUserId?: string;
  subjectUsername?: string;
  contextType?: string;
  contextId?: string;
  contextLabel?: string;
};

type ReportSheetProps = {
  visible: boolean;
  token: string | null;
  target: MobileReportTarget | null;
  onClose: () => void;
  onSubmitted?: () => void;
};

export function ReportSheet({ visible, token, target, onClose, onSubmitted }: ReportSheetProps) {
  const [category, setCategory] = useState<ReportCategory>("HARASSMENT_BULLYING");
  const [urgency, setUrgency] = useState<ReportUrgency>("medium");
  const [description, setDescription] = useState("");
  const [blockAfter, setBlockAfter] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  if (!target) return null;

  const submit = async () => {
    if (!token) return;
    setBusy(true);
    setNotice("");
    try {
      const data = await apiJson<{ report?: { id: string } }>(
        "/api/safety/reports",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetType: target.targetType,
            targetId: target.targetId,
            subjectUserId: target.subjectUserId,
            contextType: target.contextType,
            contextId: target.contextId,
            contextLabel: target.contextLabel,
            category,
            urgency,
            description: description.trim(),
            clientVersion: "decave-mobile-trust-safety-v1",
          }),
        },
        token,
      );
      if (!data.report?.id) throw new Error("The report could not be submitted.");
      if (blockAfter && target.subjectUserId) {
        await apiJson(`/api/safety/blocks/${encodeURIComponent(target.subjectUserId)}`, { method: "PUT" }, token);
      }
      setNotice("Report submitted. Thank you for helping keep DeCave safe.");
      onSubmitted?.();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not submit the report.");
    } finally {
      setBusy(false);
    }
  };

  const label = target.targetType === "user" || target.targetType === "profile" || target.targetType === "voice_participant"
    ? target.subjectUsername || "this user"
    : "this content";

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.grabber} />
          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <Text maxFontSizeMultiplier={1.3} style={styles.kicker}>TRUST &amp; SAFETY</Text>
              <Text style={styles.title}>Report {label}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={8}><Ionicons name="close" size={21} color={colors.muted} /></Pressable>
          </View>
          <Text style={styles.copy}>Your report is private. The person being reported will not see your identity.</Text>
          <Text style={styles.sectionLabel}>What happened?</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {REPORT_CATEGORIES.map((value) => <Pressable accessibilityRole="button" key={value} style={[styles.chip, category === value && styles.chipActive]} onPress={() => setCategory(value)}><Text style={[styles.chipText, category === value && styles.chipTextActive]}>{labels[value]}</Text></Pressable>)}
          </ScrollView>
          <Text style={styles.sectionLabel}>Urgency</Text>
          <View style={styles.urgencyRow}>{(["critical", "high", "medium", "low"] as ReportUrgency[]).map((value) => <Pressable accessibilityRole="button" key={value} style={[styles.urgency, urgency === value && styles.chipActive]} onPress={() => setUrgency(value)}><Text style={[styles.chipText, urgency === value && styles.chipTextActive]}>{value}</Text></Pressable>)}</View>
          <TextInput value={description} onChangeText={(value) => setDescription(value.slice(0, 4000))} placeholder="Tell us what we should know (optional)" placeholderTextColor={colors.faint} multiline numberOfLines={4} textAlignVertical="top" style={styles.textarea} />
          {target.subjectUserId && <Pressable accessibilityRole="button" style={styles.checkRow} onPress={() => setBlockAfter((value) => !value)}><Ionicons name={blockAfter ? "checkbox" : "square-outline"} size={20} color={blockAfter ? colors.cyan : colors.muted} /><Text style={styles.checkText}>Block this user after submitting</Text></Pressable>}
          <Text style={styles.note}>Private-message evidence is encrypted before upload on the desktop client. Mobile reports send the report and context without sending message text.</Text>
          {!!notice && <Text style={styles.notice}>{notice}</Text>}
          <View style={styles.actions}><Pressable accessibilityRole="button" style={styles.cancel} onPress={onClose} disabled={busy}><Text style={styles.cancelText}>Cancel</Text></Pressable><Pressable accessibilityRole="button" style={[styles.submit, busy && styles.disabled]} onPress={() => void submit()} disabled={busy}><Text style={styles.submitText}>{busy ? "Submitting…" : "Submit report"}</Text></Pressable></View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(2,5,12,.78)" },
  sheet: { maxHeight: "92%", padding: 16, paddingBottom: 28, gap: 10, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panel },
  grabber: { alignSelf: "center", width: 42, height: 4, borderRadius: 99, backgroundColor: colors.border, marginBottom: 2 },
  head: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  kicker: { color: colors.cyan, fontSize: 12, fontWeight: "900", letterSpacing: 1.6 },
  title: { color: colors.text, fontSize: 21, fontWeight: "900", marginTop: 3 },
  copy: { color: colors.muted, fontSize: 13, lineHeight: 17 },
  sectionLabel: { color: colors.text, fontSize: 11, fontWeight: "900", marginTop: 3 },
  chipRow: { gap: 7, paddingVertical: 2 },
  chip: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 99, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panel2 },
  chipActive: { borderColor: colors.cyan, backgroundColor: colors.cyanSoft },
  chipText: { color: colors.muted, fontSize: 12, fontWeight: "800" },
  chipTextActive: { color: colors.cyan },
  urgencyRow: { flexDirection: "row", gap: 7 },
  urgency: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 9, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panel2 },
  textarea: { minHeight: 92, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 11, color: colors.text, backgroundColor: colors.input, fontSize: 12 },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  checkText: { color: colors.text, fontSize: 13, fontWeight: "800" },
  note: { color: colors.faint, fontSize: 12, lineHeight: 14 },
  notice: { color: colors.cyan, fontSize: 13, lineHeight: 17 },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 2 },
  cancel: { paddingHorizontal: 15, paddingVertical: 12, borderRadius: 11, borderWidth: 1, borderColor: colors.border },
  cancelText: { color: colors.muted, fontSize: 13, fontWeight: "900" },
  submit: { paddingHorizontal: 15, paddingVertical: 12, borderRadius: 11, backgroundColor: colors.violet },
  submitText: { color: "#fff", fontSize: 13, fontWeight: "900" },
  disabled: { opacity: 0.6 },
});

export default ReportSheet;
