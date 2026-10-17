// Devices that hold this account's message key (GET /api/dm-keys/me/devices),
// with Remove: the device is signed out and the account key is rotated so it
// can't read new messages, like web's KeyDevicesList.

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { apiErrorText, apiFetch, type ApiErrorBody } from "@/src/lib/api";
import { deviceName } from "@/src/lib/session-device";
import { dateLocale } from "@/src/lib/date-locale";
import { colors } from "@/src/theme";

type KeyDevice = { sessionId: string; label: string; device?: unknown; addedAt: string; lastUsedAt: string | null; current: boolean };

function appIcon(device: unknown): keyof typeof Ionicons.glyphMap {
  const app = device && typeof device === "object" ? (device as { app?: unknown }).app : null;
  if (app === "mobile" || app === "mobileApp") return "phone-portrait-outline";
  if (app === "desktop" || app === "desktopApp") return "desktop-outline";
  return "globe-outline";
}

export function KeyDevicesCard({ token, refreshKey }: { token: string | null; refreshKey: number }) {
  const { t } = useTranslation(["settings", "common"]);
  const [devices, setDevices] = useState<KeyDevice[] | null>(null);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const response = await apiFetch("/api/dm-keys/me/devices", {}, token);
      const data = (await response.json().catch(() => ({}))) as { devices?: KeyDevice[] } & ApiErrorBody;
      if (!response.ok || !Array.isArray(data.devices)) throw new Error(apiErrorText(data, t("settings.keyDevices.failed")));
      setDevices(data.devices);
      setError("");
    } catch (cause) {
      setDevices([]);
      setError(cause instanceof Error ? cause.message : t("settings.keyDevices.failed"));
    }
  }, [token, t]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const formatDate = (value: string) => new Date(value).toLocaleDateString(dateLocale(), { year: "numeric", month: "short", day: "numeric" });

  const remove = (device: KeyDevice) => {
    const label = deviceName(device.label, device.device) || t("settings.keyDevices.unknownDevice");
    Alert.alert(t("settings.keyDevices.remove"), t("settings.keyDevices.confirm", { device: label }), [
      { text: t("common.actions.cancel"), style: "cancel" },
      {
        text: t("settings.keyDevices.remove"),
        style: "destructive",
        onPress: () =>
          void (async () => {
            if (!token) return;
            setBusyId(device.sessionId);
            setError("");
            setNotice("");
            try {
              const response = await apiFetch(`/api/dm-keys/me/devices/${encodeURIComponent(device.sessionId)}`, { method: "DELETE" }, token);
              const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
              if (!response.ok) throw new Error(apiErrorText(data, t("settings.keyDevices.failed")));
              setNotice(t("settings.keyDevices.removed", { device: label }));
              await load();
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : t("settings.keyDevices.failed"));
            } finally {
              setBusyId("");
            }
          })(),
      },
    ]);
  };

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Ionicons name="key-outline" size={18} color={colors.cyan} />
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{t("settings.keyDevices.title")}</Text>
          <Text style={styles.help}>{t("settings.keyDevices.help")}</Text>
        </View>
      </View>
      {devices === null && <Text style={styles.meta}>{t("settings.keyDevices.loading")}</Text>}
      {devices?.length === 0 && !error && <Text style={styles.meta}>{t("settings.keyDevices.none")}</Text>}
      {devices?.map((device) => {
        const label = deviceName(device.label, device.device) || t("settings.keyDevices.unknownDevice");
        return (
          <View key={device.sessionId} style={styles.row}>
            <View style={styles.icon}>
              <Ionicons name={appIcon(device.device)} size={18} color={colors.cyan} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={styles.nameRow}>
                <Text style={styles.name} numberOfLines={1}>{label}</Text>
                {device.current && <Text style={styles.current}>{t("settings.keyDevices.thisDevice")}</Text>}
              </View>
              <Text style={styles.meta}>{t("settings.keyDevices.added", { date: formatDate(device.addedAt) })}</Text>
              <Text style={styles.meta}>
                {device.lastUsedAt ? t("settings.keyDevices.lastUsed", { date: formatDate(device.lastUsedAt) }) : t("settings.keyDevices.lastUsedUnknown")}
              </Text>
            </View>
            {!device.current && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${t("settings.keyDevices.remove")}: ${label}`}
                style={styles.remove}
                disabled={!!busyId}
                onPress={() => remove(device)}
              >
                {busyId === device.sessionId ? <ActivityIndicator size="small" color={colors.red} /> : <Ionicons name="trash-outline" size={16} color={colors.red} />}
              </Pressable>
            )}
          </View>
        );
      })}
      {!!notice && <Text style={styles.notice}>{notice}</Text>}
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: 14, padding: 12, gap: 10, borderRadius: 18, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border },
  head: { flexDirection: "row", gap: 10 },
  title: { color: colors.text, fontSize: 14, fontWeight: "900" },
  help: { color: colors.muted, fontSize: 12, lineHeight: 16, marginTop: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  icon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.cyanSoft },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  name: { flexShrink: 1, color: colors.text, fontSize: 13, fontWeight: "900" },
  current: { color: colors.green, fontSize: 12, fontWeight: "900" },
  meta: { color: colors.muted, fontSize: 12, marginTop: 2 },
  remove: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,102,120,.08)", borderWidth: 1, borderColor: "rgba(255,102,120,.18)" },
  notice: { color: colors.green, fontSize: 12 },
  error: { color: colors.red, fontSize: 12 },
});
