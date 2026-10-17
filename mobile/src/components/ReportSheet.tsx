import { useState } from "react";
import { AccessibilityInfo, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { ModalKeyboardAvoider } from "@/src/components/KeyboardAware";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { apiFetch, apiJson } from "@/src/lib/api";
import { uploadEvidence, type EvidenceTarget } from "@/src/lib/report-evidence";
import { colors } from "@/src/theme";
import { REPORT_CATEGORIES, type ReportCategory, type ReportTargetType, type ReportUrgency } from "@/src/types";

// Catalog keys for the category chips; the short mobile labels live under safety.mobile.category.
const labels = {
  HARASSMENT_BULLYING: "safety.mobile.category.HARASSMENT_BULLYING",
  HATE_SPEECH: "safety.category.HATE_SPEECH",
  SEXUAL_INAPPROPRIATE: "safety.mobile.category.SEXUAL_INAPPROPRIATE",
  SUSPECTED_GROOMING: "safety.mobile.category.SUSPECTED_GROOMING",
  CHILD_SAFETY: "safety.mobile.category.CHILD_SAFETY",
  THREATS_VIOLENCE: "safety.mobile.category.THREATS_VIOLENCE",
  SPAM_SCAM: "safety.category.SPAM_SCAM",
  IMPERSONATION: "safety.category.IMPERSONATION",
  UNDERAGE_USER: "safety.category.UNDERAGE_USER",
  INAPPROPRIATE_MEDIA: "safety.category.INAPPROPRIATE_MEDIA",
  SELF_HARM: "safety.mobile.category.SELF_HARM",
  OTHER: "safety.category.OTHER",
} as const satisfies Record<ReportCategory, string>;

export type MobileReportTarget = {
  targetType: ReportTargetType;
  targetId: string;
  subjectUserId?: string;
  subjectUsername?: string;
  contextType?: string;
  contextId?: string;
  contextLabel?: string;
  /** The reported message, attached encrypted to the safety team's key. */
  evidenceType?: EvidenceTarget["evidenceType"];
  evidenceText?: string;
  /** Encrypted message only: lets reviewers check it really was sent. */
  e2eeProof?: EvidenceTarget["e2eeProof"];
};

type ReportSheetProps = {
  visible: boolean;
  token: string | null;
  target: MobileReportTarget | null;
  onClose: () => void;
  onSubmitted?: () => void;
};

/** How long a successful report stays on screen, long enough to read or hear before it closes. */
export const REPORT_CONFIRMATION_MS = 3000;

export function ReportSheet({ visible, token, target, onClose, onSubmitted }: ReportSheetProps) {
  const { t } = useTranslation(["common", "safety"]);
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
            clientVersion: "decave-mobile-trust-safety-v2",
          }),
        },
        token,
      );
      if (!data.report?.id) throw new Error(t("safety.report.failed"));
      let evidenceAttached = true;
      if (target.evidenceText?.trim()) {
        try {
          evidenceAttached = await uploadEvidence((path, init) => apiFetch(path, init, token), data.report.id, target);
        } catch {
          evidenceAttached = false;
        }
      }
      if (blockAfter && target.subjectUserId) {
        await apiJson(`/api/safety/blocks/${encodeURIComponent(target.subjectUserId)}`, { method: "PUT" }, token);
      }
      if (evidenceAttached) {
        setNotice(t("safety.report.submitted"));
        AccessibilityInfo.announceForAccessibility(t("safety.report.submitted"));
        onSubmitted?.();
      } else {
        // Leave the sheet open: the auto-close would hide this before anyone reads it.
        setNotice(
          t("safety.report.submittedNoEvidence"),
        );
        AccessibilityInfo.announceForAccessibility(t("safety.mobile.report.submittedNoEvidenceShort"));
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t("safety.mobile.report.failed"));
    } finally {
      setBusy(false);
    }
  };

  const title = target.targetType === "user" || target.targetType === "profile" || target.targetType === "voice_participant"
    ? target.subjectUsername
      ? t("safety.report.title.user", { name: target.subjectUsername })
      : t("safety.report.title.thisUser")
    : t("safety.report.title.thisContent");

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <ModalKeyboardAvoider>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.grabber} />
          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <Text maxFontSizeMultiplier={1.3} style={styles.kicker}>{t("safety.mobile.report.kicker")}</Text>
              <Text style={styles.title}>{title}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={t("common.actions.close")} onPress={onClose} hitSlop={8}><Ionicons name="close" size={21} color={colors.muted} /></Pressable>
          </View>
          <Text style={styles.copy}>{t("safety.mobile.report.private")}</Text>
          <Text style={styles.sectionLabel}>{t("safety.report.category")}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {REPORT_CATEGORIES.map((value) => <Pressable accessibilityRole="button" key={value} style={[styles.chip, category === value && styles.chipActive]} onPress={() => setCategory(value)}><Text style={[styles.chipText, category === value && styles.chipTextActive]}>{t(labels[value])}</Text></Pressable>)}
          </ScrollView>
          <Text style={styles.sectionLabel}>{t("safety.report.urgency")}</Text>
          <View style={styles.urgencyRow}>{(["critical", "high", "medium", "low"] as ReportUrgency[]).map((value) => <Pressable accessibilityRole="button" key={value} style={[styles.urgency, urgency === value && styles.chipActive]} onPress={() => setUrgency(value)}><Text style={[styles.chipText, urgency === value && styles.chipTextActive]}>{t(`safety.myReports.urgency.${value}`)}</Text></Pressable>)}</View>
          <TextInput value={description} onChangeText={(value) => setDescription(value.slice(0, 4000))} placeholder={t("safety.mobile.report.detailsPlaceholder")} placeholderTextColor={colors.faint} multiline numberOfLines={4} textAlignVertical="top" style={styles.textarea} />
          {target.subjectUserId && <Pressable accessibilityRole="button" style={styles.checkRow} onPress={() => setBlockAfter((value) => !value)}><Ionicons name={blockAfter ? "checkbox" : "square-outline"} size={20} color={blockAfter ? colors.cyan : colors.muted} /><Text style={styles.checkText}>{t("safety.report.blockAfter")}</Text></Pressable>}
          <Text style={styles.note}>
            {target.evidenceText?.trim()
              ? t("safety.mobile.report.evidenceNote")
              : t("safety.mobile.report.contextNote")}
          </Text>
          {!!notice && <Text style={styles.notice} accessibilityLiveRegion="polite">{notice}</Text>}
          <View style={styles.actions}><Pressable accessibilityRole="button" style={styles.cancel} onPress={onClose} disabled={busy}><Text style={styles.cancelText}>{t("safety.report.cancel")}</Text></Pressable><Pressable accessibilityRole="button" style={[styles.submit, busy && styles.disabled]} onPress={() => void submit()} disabled={busy}><Text style={styles.submitText}>{busy ? t("safety.report.submitting") : t("safety.report.submit")}</Text></Pressable></View>
        </Pressable>
      </Pressable>
      </ModalKeyboardAvoider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(2,5,12,.78)" },
  sheet: { maxHeight: "92%", padding: 16, paddingBottom: 28, gap: 10, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.sheet },
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
