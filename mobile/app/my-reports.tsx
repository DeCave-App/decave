import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Screen } from "@/src/components/Screen";
import { apiJson } from "@/src/lib/api";
import { useSession } from "@/src/providers/SessionProvider";
import { colors } from "@/src/theme";
import type { SafetyReport } from "@/src/types";

function statusLabel(value: SafetyReport["status"]): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function MyReportsScreen() {
  const { token } = useSession();
  const [reports, setReports] = useState<SafetyReport[]>([]);
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    setBusy(true);
    setNotice("");
    try {
      const data = await apiJson<{ reports?: SafetyReport[] }>("/api/safety/reports", {}, token);
      setReports(data.reports ?? []);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not load your reports.");
    } finally {
      setBusy(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  return (
    <Screen>
      <View style={styles.top}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} hitSlop={8}><Ionicons name="chevron-back" size={23} color={colors.cyan} /></Pressable>
        <View style={{ flex: 1 }}><Text maxFontSizeMultiplier={1.3} style={styles.kicker}>PRIVATE TO YOU</Text><Text style={styles.title}>My Reports</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel="Refresh" onPress={() => void load()} disabled={busy} hitSlop={8}><Ionicons name="refresh" size={19} color={colors.cyan} /></Pressable>
      </View>
      <View style={styles.intro}><Ionicons name="shield-checkmark-outline" size={22} color={colors.cyan} /><Text style={styles.introText}>Track reports you have submitted. Review details remain private.</Text></View>
      {!!notice && <Text style={styles.notice}>{notice}</Text>}
      {busy && reports.length === 0 ? <ActivityIndicator color={colors.cyan} style={{ marginTop: 30 }} /> : <FlatList data={reports} keyExtractor={(item) => item.id} contentContainerStyle={styles.list} ListEmptyComponent={<Text style={styles.empty}>You have not submitted any reports.</Text>} renderItem={({ item }) => <View style={styles.row}><View style={{ flex: 1 }}><Text style={styles.case}>{item.caseNumber || `Report ${item.id.slice(0, 8)}`}</Text><Text style={styles.detail}>{item.subjectUsername || item.targetType} · {new Date(item.createdAt).toLocaleDateString()}</Text></View><View style={styles.status}><Text style={styles.statusText}>{statusLabel(item.status)}</Text><Text style={styles.urgency}>{item.urgency}</Text></View></View>} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", gap: 11, padding: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  kicker: { color: colors.cyan, fontSize: 12, fontWeight: "900", letterSpacing: 1.5 },
  title: { color: colors.text, fontSize: 22, fontWeight: "900", marginTop: 2 },
  intro: { flexDirection: "row", alignItems: "center", gap: 9, margin: 14, padding: 13, borderRadius: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panel },
  introText: { flex: 1, color: colors.muted, fontSize: 13, lineHeight: 17 },
  list: { padding: 14, gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 9, padding: 13, borderRadius: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panel },
  case: { color: colors.text, fontWeight: "900", fontSize: 12 },
  detail: { color: colors.muted, fontSize: 12, marginTop: 5 },
  status: { alignItems: "flex-end", gap: 4 },
  statusText: { color: colors.cyan, fontSize: 12, fontWeight: "900" },
  urgency: { color: colors.muted, fontSize: 12, textTransform: "uppercase" },
  empty: { color: colors.muted, textAlign: "center", marginTop: 50, fontSize: 12 },
  notice: { color: colors.red, paddingHorizontal: 14, fontSize: 13 },
});
