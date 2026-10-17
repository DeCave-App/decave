import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Linking, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Screen } from "@/src/components/Screen";
import { apiErrorText, apiFetch, type ApiErrorBody } from "@/src/lib/api";
import { useSession } from "@/src/providers/SessionProvider";
import { colors } from "@/src/theme";

type Provider = "steam" | "twitch" | "faceit";
type Connection = { provider: Provider; linked: boolean; displayName?: string; showOnProfile: boolean; available: boolean };

const CONNECT_PATH: Record<Provider, string> = {
  steam: "/api/integrations/steam/connect",
  twitch: "/api/account/twitch/connect",
  faceit: "/api/account/faceit/connect",
};
const DISCONNECT_PATH: Record<Provider, string> = {
  steam: "/api/integrations/steam",
  twitch: "/api/account/twitch",
  faceit: "/api/account/faceit",
};
const ICONS: Record<Provider, keyof typeof Ionicons.glyphMap> = { steam: "logo-steam", twitch: "logo-twitch", faceit: "trophy-outline" };

/** Settings → Linked accounts (Steam, Twitch, FACEIT), like web's ConnectionsTab. */
export default function ConnectionsScreen() {
  const { t } = useTranslation(["settings", "common"]);
  const { token } = useSession();
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (): Promise<Connection[] | null> => {
    if (!token) return null;
    try {
      const response = await apiFetch("/api/account/connections", { cache: "no-store" }, token);
      const data = (await response.json().catch(() => ({}))) as { connections?: Connection[] };
      if (!response.ok || !data.connections) throw new Error("load");
      setConnections(data.connections);
      setLoadFailed(false);
      return data.connections;
    } catch {
      setLoadFailed(true);
      return null;
    }
  }, [token]);

  useEffect(() => {
    void load();
    // Back from the browser: the link may be done.
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void load();
    });
    return () => {
      sub.remove();
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [load]);

  /** After opening a sign-in page, check every few seconds until the link appears (2 minutes at most). */
  const watchForLink = (provider: Provider) => {
    if (pollRef.current) clearInterval(pollRef.current);
    const stopAt = Date.now() + 2 * 60_000;
    pollRef.current = setInterval(() => {
      void load().then((list) => {
        const done = list?.find((item) => item.provider === provider)?.linked;
        if ((done || Date.now() > stopAt) && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      });
    }, 4000);
  };

  const visible = (connections ?? []).filter((item) => item.available);

  return (
    <Screen>
      <View style={styles.top}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("common.actions.back")} style={styles.back} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={22} color={colors.cyan} />
        </Pressable>
        <Text style={styles.title}>{t("settings.connections.title")}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.intro}>{t("settings.connections.intro")}</Text>
        {connections === null && !loadFailed && <ActivityIndicator color={colors.cyan} style={{ marginTop: 20 }} />}
        {loadFailed && (
          <Pressable accessibilityRole="button" onPress={() => void load()}>
            <Text style={styles.error}>
              {t("settings.connections.loadFailed")} <Text style={styles.link}>{t("settings.connections.retry")}</Text>
            </Text>
          </Pressable>
        )}
        {visible.map((connection) => (
          <ConnectionRow key={connection.provider} connection={connection} token={token} onChanged={() => void load()} onConnectStarted={() => watchForLink(connection.provider)} />
        ))}
      </ScrollView>
    </Screen>
  );
}

function ConnectionRow({ connection, token, onChanged, onConnectStarted }: { connection: Connection; token: string | null; onChanged: () => void; onConnectStarted: () => void }) {
  const { t } = useTranslation(["settings"]);
  const { provider } = connection;
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [shown, setShown] = useState(connection.showOnProfile);
  useEffect(() => setShown(connection.showOnProfile), [connection.showOnProfile]);

  const connect = async () => {
    if (!token) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await apiFetch(CONNECT_PATH[provider], { method: "POST" }, token);
      const data = (await response.json().catch(() => ({}))) as { url?: string } & ApiErrorBody;
      if (!response.ok || !data.url) throw new Error(apiErrorText(data, t("settings.connections.actionFailed")));
      await Linking.openURL(data.url);
      setNotice(t("settings.connections.finishInBrowser"));
      onConnectStarted();
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : t("settings.connections.actionFailed"));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!token) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await apiFetch(DISCONNECT_PATH[provider], { method: "DELETE" }, token);
      if (!response.ok) throw new Error("");
      onChanged();
    } catch {
      setError(t("settings.connections.actionFailed"));
    } finally {
      setBusy(false);
    }
  };

  const setShowOnProfile = async (next: boolean) => {
    if (!token) return;
    const previous = shown;
    setShown(next);
    try {
      const response = await apiFetch(
        `/api/account/connections/${provider}/visibility`,
        { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ showOnProfile: next }) },
        token,
      );
      if (!response.ok) throw new Error("save");
    } catch {
      setShown(previous);
      setError(t("settings.connections.actionFailed"));
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={styles.icon}>
          <Ionicons name={ICONS[provider]} size={22} color={colors.text} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{t(`settings.connections.providers.${provider}.name`)}</Text>
          <Text style={[styles.status, connection.linked && { color: colors.green }]}>
            {connection.linked ? t("settings.connections.connected", { name: connection.displayName ?? "" }) : t("settings.connections.notConnected")}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          style={[connection.linked ? styles.secondary : styles.primary, busy && { opacity: 0.5 }]}
          onPress={() => void (connection.linked ? disconnect() : connect())}
        >
          <Text style={connection.linked ? styles.secondaryText : styles.primaryText}>
            {connection.linked ? t("settings.connections.disconnect") : busy ? t("settings.connections.connecting") : t("settings.connections.connect")}
          </Text>
        </Pressable>
      </View>
      <Text style={styles.use}>{t(`settings.connections.providers.${provider}.use`)}</Text>
      {connection.linked && (
        <View style={styles.row}>
          <Text style={[styles.use, { flex: 1, marginTop: 0 }]}>{t("settings.connections.showOnProfile")}</Text>
          <Switch value={shown} onValueChange={(value) => void setShowOnProfile(value)} />
        </View>
      )}
      {!!notice && <Text style={styles.notice}>{notice}</Text>}
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, paddingBottom: 8 },
  back: { width: 40, height: 40, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border },
  title: { flex: 1, color: colors.text, fontSize: 19, fontWeight: "900" },
  scroll: { padding: 14, paddingBottom: 40, gap: 12 },
  intro: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  card: { padding: 12, gap: 8, borderRadius: 16, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  icon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.panel2 },
  name: { color: colors.text, fontSize: 15, fontWeight: "900" },
  status: { color: colors.muted, fontSize: 12, fontWeight: "700", marginTop: 2 },
  use: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  primary: { paddingHorizontal: 14, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: colors.cyan },
  primaryText: { color: "#061018", fontSize: 13, fontWeight: "900" },
  secondary: { paddingHorizontal: 14, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border },
  secondaryText: { color: colors.text, fontSize: 13, fontWeight: "800" },
  notice: { color: colors.cyan, fontSize: 12 },
  error: { color: colors.red, fontSize: 12 },
  link: { color: colors.cyan, fontWeight: "800" },
});
