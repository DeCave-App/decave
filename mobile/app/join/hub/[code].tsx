import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { Screen } from "@/src/components/Screen";
import { apiJson } from "@/src/lib/api";
import { successHaptic } from "@/src/lib/haptics";
import { useSession } from "@/src/providers/SessionProvider";
import { colors } from "@/src/theme";
import type { Hub } from "@/src/types";

/** Opened from https://app.de-cave.com/join/hub/<code> or decave://join/hub/<code>. */
export default function JoinHubInviteScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const { token, user, loading } = useSession();
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token || !code) return;
    let cancelled = false;
    apiJson<Hub>(`/api/invites/${encodeURIComponent(String(code))}/join`, { method: "POST" }, token)
      .then((hub) => {
        if (cancelled) return;
        successHaptic();
        router.replace(`/hub/${hub.id}`);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Couldn't use this invite.");
      });
    return () => {
      cancelled = true;
    };
  }, [token, code]);

  if (!loading && !user) return <Redirect href="/login" />;

  return (
    <Screen>
      <View style={styles.center}>
        {error ? (
          <>
            <Ionicons name="alert-circle-outline" size={40} color={colors.red} />
            <Text style={styles.title}>Invite didn't work</Text>
            <Text style={styles.text}>{error}</Text>
            <Pressable accessibilityRole="button" style={styles.button} onPress={() => router.replace("/home")}>
              <Text style={styles.buttonText}>Go home</Text>
            </Pressable>
          </>
        ) : (
          <>
            <ActivityIndicator color={colors.cyan} size="large" />
            <Text style={styles.title}>Joining Hub…</Text>
          </>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 32 },
  title: { color: colors.text, fontSize: 20, fontWeight: "900" },
  text: { color: colors.muted, fontSize: 14, textAlign: "center", lineHeight: 20 },
  button: { marginTop: 8, paddingHorizontal: 22, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: colors.violet },
  buttonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "900" },
});
