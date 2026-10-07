import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Screen } from "@/src/components/Screen";
import { apiJson } from "@/src/lib/api";
import { useSession } from "@/src/providers/SessionProvider";
import { colors } from "@/src/theme";

type DeviceSession = {
  id: string;
  client: "mobile" | "web" | "desktop" | "legacy";
  deviceLabel: string;
  createdAt: string;
  expiresAt: string;
  lastActiveAt?: string | null;
  current: boolean;
};

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

function activityLabel(session: DeviceSession, now = Date.now()): string {
  if (session.current) return "Active now";
  const time = session.lastActiveAt ? new Date(session.lastActiveAt).getTime() : NaN;
  if (!Number.isFinite(time)) {
    const signedIn = new Date(session.createdAt).getTime();
    return Number.isFinite(signedIn) ? `Not used since ${new Date(signedIn).toLocaleDateString()}` : "Not used recently";
  }
  const minutes = Math.max(0, Math.floor((now - time) / 60_000));
  if (minutes < 10) return "Active now";
  if (minutes < 60) return `Active ${plural(minutes, "minute")} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Active ${plural(hours, "hour")} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `Active ${plural(days, "day")} ago`;
  return `Not used since ${new Date(time).toLocaleDateString()}`;
}

function clientIcon(client: DeviceSession["client"]): keyof typeof Ionicons.glyphMap {
  if (client === "mobile") return "phone-portrait-outline";
  if (client === "desktop") return "desktop-outline";
  if (client === "web") return "globe-outline";
  return "help-circle-outline";
}

export default function DevicesScreen() {
  const { token, invalidate } = useSession();
  const [sessions, setSessions] = useState<DeviceSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    setError("");
    try {
      const data = await apiJson<{ sessions: DeviceSession[] }>("/api/auth/sessions", {}, token);
      setSessions(Array.isArray(data.sessions) ? data.sessions : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load active sessions.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const logoutAll = () => {
    Alert.alert(
      "Log out all sessions?",
      "This signs your account out on mobile, browser and desktop devices.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Log out all",
          style: "destructive",
          onPress: () => void (async () => {
            if (!token) return;
            try {
              await apiJson("/api/auth/logout-all", { method: "POST" }, token);
            } finally {
              await invalidate("All DeCave sessions were signed out.");
              router.replace("/login" as any);
            }
          })(),
        },
      ],
    );
  };

  const logoutSession = (session: DeviceSession) => {
    Alert.alert(
      session.current ? "Log out this device?" : "Log out this session?",
      `End the ${session.deviceLabel || session.client} session?`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Log out", style: "destructive", onPress: () => void (async () => {
          if (!token) return;
          try {
            const result = await apiJson<{ current?: boolean }>("/api/auth/sessions/revoke", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: session.id }),
            }, token);
            if (result.current) {
              await invalidate("This device was logged out.");
              router.replace("/login" as any);
              return;
            }
            await load();
          } catch (cause) {
            Alert.alert("Could not log out session", cause instanceof Error ? cause.message : "Try again.");
          }
        })() },
      ],
    );
  };

  return (
    <Screen>
      <View style={styles.top}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" style={styles.back} onPress={() => router.back()}><Ionicons name="chevron-back" size={22} color={colors.cyan} /></Pressable>
        <View style={{ flex: 1 }}><Text maxFontSizeMultiplier={1.3} style={styles.kicker}>ACCOUNT SECURITY</Text><Text style={styles.title}>Devices</Text></View>
        <Ionicons name="desktop-outline" size={22} color={colors.cyan} />
      </View>
      <ScrollView keyboardDismissMode="on-drag"
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={colors.cyan} />}
      >
        <View style={styles.info}><Ionicons name="shield-checkmark-outline" size={18} color={colors.cyan} /><Text style={styles.infoText}>Mobile may stay signed in together with one web or desktop client. Web and desktop replace each other.</Text></View>
        <Pressable accessibilityRole="button" style={styles.scan} onPress={() => router.push("/scan-login" as any)}><Ionicons name="qr-code-outline" size={19} color={colors.cyan} /><View style={{ flex: 1 }}><Text style={styles.scanTitle}>Scan QR login</Text><Text style={styles.scanText}>Sign in on web or desktop using this mobile session.</Text></View><Ionicons name="chevron-forward" size={17} color={colors.muted} /></Pressable>
        {!!error && <Text style={styles.error}>{error}</Text>}
        {loading ? <ActivityIndicator color={colors.cyan} style={{ marginTop: 24 }} /> : (
          <View style={styles.card}>
            {sessions.length === 0 ? <Text style={styles.empty}>No active sessions were returned.</Text> : sessions.map((session, index) => (
              <View key={`${session.client}-${session.createdAt}-${index}`} style={[styles.session, index === sessions.length - 1 && styles.sessionLast]}>
                <View style={styles.icon}><Ionicons name={clientIcon(session.client)} size={19} color={colors.cyan} /></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={styles.nameRow}><Text style={styles.name}>{session.deviceLabel || session.client}</Text>{session.current && <Text style={styles.current}>THIS DEVICE</Text>}</View>
                  <Text style={[styles.meta, activityLabel(session) === "Active now" && styles.activeNow]}>{activityLabel(session)}</Text>
                  <Text style={styles.meta}>{session.client.toUpperCase()} · Signed in {new Date(session.createdAt).toLocaleString()}</Text>
                  <Text style={styles.meta}>Expires {new Date(session.expiresAt).toLocaleString()}</Text>
                </View>
                <Pressable accessibilityRole="button" style={styles.sessionLogout} onPress={() => logoutSession(session)} accessibilityLabel={`Log out ${session.deviceLabel || session.client}`}><Ionicons name="log-out-outline" size={17} color={colors.red} /></Pressable>
              </View>
            ))}
          </View>
        )}
        <Pressable accessibilityRole="button" style={styles.danger} onPress={logoutAll}><Ionicons name="log-out-outline" size={18} color={colors.red} /><View style={{ flex: 1 }}><Text style={styles.dangerTitle}>Log out all active sessions</Text><Text style={styles.dangerText}>End every DeCave login for this account.</Text></View></Pressable>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { minHeight: 76, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.bg },
  back: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border },
  kicker: { color: colors.cyan, fontSize: 11, fontWeight: "900", letterSpacing: 1.8 }, title: { color: colors.text, fontSize: 21, fontWeight: "900" },
  scroll: { padding: 14, paddingBottom: 42 },
  info: { flexDirection: "row", gap: 9, padding: 12, borderRadius: 16, backgroundColor: colors.cyanSoft, borderWidth: 1, borderColor: "rgba(95,225,255,.18)" }, infoText: { flex: 1, color: colors.muted, fontSize: 12, lineHeight: 14 },
  scan: { marginTop: 12, minHeight: 62, flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 16, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border },
  scanTitle: { color: colors.text, fontSize: 13, fontWeight: "900" }, scanText: { color: colors.muted, fontSize: 13, marginTop: 3 },
  error: { color: colors.red, fontSize: 12, marginTop: 10 },
  card: { marginTop: 14, borderRadius: 18, overflow: "hidden", backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border },
  session: { minHeight: 70, flexDirection: "row", alignItems: "center", gap: 10, padding: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, sessionLast: { borderBottomWidth: 0 },
  icon: { width: 40, height: 40, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: colors.cyanSoft },
  sessionLogout: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,102,120,.08)", borderWidth: 1, borderColor: "rgba(255,102,120,.18)" },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 7 }, name: { color: colors.text, fontSize: 13, fontWeight: "900" }, current: { color: colors.green, fontSize: 13, fontWeight: "900", letterSpacing: .6 }, meta: { color: colors.muted, fontSize: 13, marginTop: 3 }, activeNow: { color: colors.green, fontWeight: "800" }, empty: { color: colors.muted, padding: 16, textAlign: "center", fontSize: 12 },
  danger: { marginTop: 14, minHeight: 66, flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 17, backgroundColor: "rgba(255,102,120,.07)", borderWidth: 1, borderColor: "rgba(255,102,120,.20)" }, dangerTitle: { color: colors.red, fontSize: 13, fontWeight: "900" }, dangerText: { color: colors.muted, fontSize: 13, marginTop: 3 },
});
