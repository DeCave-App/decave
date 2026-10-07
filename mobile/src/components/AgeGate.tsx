import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { apiJson } from "@/src/lib/api";
import { colors } from "@/src/theme";
import type { SafetyProfile } from "@/src/types";

type AgeGateProps = {
  token: string;
  onComplete: (safety: SafetyProfile) => void;
};

export function AgeGate({ token, onComplete }: AgeGateProps) {
  const [birthDate, setBirthDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const submit = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
      setNotice("Enter your birth date as YYYY-MM-DD.");
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      const data = await apiJson<{ safety: SafetyProfile }>(
        "/api/auth/age",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ birthDate }) },
        token,
      );
      onComplete(data.safety);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "We could not verify your age.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => {}}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text maxFontSizeMultiplier={1.3} style={styles.kicker}>WELCOME TO DECAVE</Text>
          <Text style={styles.title}>Confirm your age</Text>
          <Text style={styles.copy}>
            DeCave is available to people aged 13 and older. We keep only an age band and the verification time, not your exact birth date.
          </Text>
          <Text style={styles.label}>Birth date</Text>
          <TextInput
            value={birthDate}
            onChangeText={(value) => setBirthDate(value.replace(/[^0-9-]/g, "").slice(0, 10))}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={colors.faint}
            keyboardType="numbers-and-punctuation"
            autoCapitalize="none"
            style={styles.input}
            editable={!busy}
          />
          {!!notice && <Text style={styles.error}>{notice}</Text>}
          <Pressable accessibilityRole="button" style={[styles.button, busy && styles.buttonDisabled]} onPress={() => void submit()} disabled={busy}>
            <Text style={styles.buttonText}>{busy ? "Checking…" : "Continue"}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "center", padding: 22, backgroundColor: "rgba(2,5,12,.86)" },
  card: { borderRadius: 20, padding: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panel, gap: 11 },
  kicker: { color: colors.cyan, fontSize: 12, fontWeight: "900", letterSpacing: 1.8 },
  title: { color: colors.text, fontSize: 24, fontWeight: "900" },
  copy: { color: colors.muted, fontSize: 12, lineHeight: 19 },
  label: { color: colors.text, fontSize: 11, fontWeight: "900" },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.input, color: colors.text, paddingHorizontal: 13, paddingVertical: 12, fontSize: 15 },
  error: { color: colors.red, fontSize: 13, lineHeight: 17 },
  button: { alignItems: "center", borderRadius: 12, paddingVertical: 13, backgroundColor: colors.violet },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: "#fff", fontWeight: "900", fontSize: 14 },
});

export default AgeGate;
