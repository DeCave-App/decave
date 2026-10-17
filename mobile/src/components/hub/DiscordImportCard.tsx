// Hub admin: copy a Discord server's rooms and roles from a Server Template
// link, reviewed before anything is created, with Undo for what it created —
// like web's DiscordImportReview (src/components/studio/DiscordImportReview.tsx).

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import {
  buildDiscordImportDryRun,
  extractDiscordTemplateCode,
  type DiscordImportApplyResult,
  type DiscordImportExistingRole,
  type DiscordImportExistingRoom,
  type DiscordImportPreview,
  type DiscordImportRollbackResult,
} from "../../../../shared/discord-template";
import { apiErrorText, apiFetch, type ApiErrorBody } from "@/src/lib/api";
import { colors } from "@/src/theme";

/** The shape of a Discord Server Template link, the same in every language. */
const TEMPLATE_URL_SHAPE = "https://discord.new/xxxxxxxx";

/** Catalog strings mark the number with <b>…</b> for web; plain text here. */
const plain = (text: string) => text.replace(/<\/?b>/g, "");

async function postJson<T>(path: string, token: string, body: unknown | undefined, fallback: string): Promise<T> {
  const response = await apiFetch(
    path,
    body === undefined ? { method: "POST" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    token,
  );
  const data = (await response.json().catch(() => ({}))) as T & ApiErrorBody;
  if (!response.ok) throw new Error(apiErrorText(data, fallback));
  return data;
}

export function DiscordImportCard({
  hubId,
  token,
  existingRooms,
  existingRoles,
  onChanged,
}: {
  hubId: number;
  token: string;
  existingRooms: readonly DiscordImportExistingRoom[];
  existingRoles: readonly DiscordImportExistingRole[];
  /** Rooms or roles were created or removed; reload the Hub. */
  onChanged: () => void;
}) {
  const { t } = useTranslation(["admin", "hub"]);
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<DiscordImportPreview | null>(null);
  const [busy, setBusy] = useState<"" | "load" | "apply" | "rollback">("");
  const [error, setError] = useState("");
  const [applied, setApplied] = useState<DiscordImportApplyResult | null>(null);
  const [rollback, setRollback] = useState<DiscordImportRollbackResult | null>(null);
  const dryRun = useMemo(() => (preview ? buildDiscordImportDryRun(preview, existingRooms, existingRoles) : null), [preview, existingRooms, existingRoles]);

  const load = async () => {
    const code = extractDiscordTemplateCode(url);
    if (!code) {
      setError(t("hub.actions.import.templateUrlInvalid"));
      setPreview(null);
      return;
    }
    setBusy("load");
    setError("");
    setApplied(null);
    setRollback(null);
    try {
      const sourceResponse = await apiFetch(`/api/discord/templates/${encodeURIComponent(code)}`, {}, token);
      const source = (await sourceResponse.json().catch(() => ({}))) as DiscordImportPreview & ApiErrorBody;
      if (!sourceResponse.ok) throw new Error(apiErrorText(source, t("hub.actions.import.templateUrlInvalid")));
      // The server checks the preview the same way before anything can be applied.
      await postJson(`/api/servers/${hubId}/import/preview`, token, { discordImport: source }, t("admin.discordImport.applyFailed"));
      setPreview(source);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("admin.discordImport.applyFailed"));
      setPreview(null);
    } finally {
      setBusy("");
    }
  };

  const apply = async () => {
    if (!dryRun || busy) return;
    setBusy("apply");
    setError("");
    try {
      const result = await postJson<DiscordImportApplyResult>(
        `/api/servers/${hubId}/import/apply`,
        token,
        {
          discordImport: { sourceName: dryRun.sourceName, sourceCode: dryRun.sourceCode, create: dryRun.create, conflicts: dryRun.conflicts, unsupported: dryRun.unsupported },
          fingerprint: dryRun.fingerprint,
        },
        t("admin.discordImport.applyFailed"),
      );
      if (!result.importId) throw new Error(t("admin.discordImport.applyFailed"));
      setApplied(result);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("admin.discordImport.applyFailed"));
    } finally {
      setBusy("");
    }
  };

  const undo = async () => {
    if (!applied || busy) return;
    setBusy("rollback");
    setError("");
    try {
      const result = await postJson<DiscordImportRollbackResult>(
        `/api/servers/${hubId}/import/${encodeURIComponent(applied.importId)}/rollback`,
        token,
        undefined,
        t("admin.discordImport.rollbackFailed"),
      );
      setRollback(result);
      if (result.retainedRoomIds.length === 0 && result.retainedRoleIds.length === 0) setApplied(null);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("admin.discordImport.rollbackFailed"));
    } finally {
      setBusy("");
    }
  };

  return (
    <View style={styles.wrap} accessibilityLabel={t("admin.discordImport.label")}>
      <Text style={styles.kicker}>{t("admin.discordImport.kicker")}</Text>
      <Text style={styles.title}>{t("admin.discordImport.title")}</Text>
      <Text style={styles.muted}>{t("admin.discordImport.noLogin")}</Text>
      <View style={styles.row}>
        <TextInput
          value={url}
          onChangeText={setUrl}
          placeholder={TEMPLATE_URL_SHAPE}
          placeholderTextColor={colors.faint}
          accessibilityLabel={t("admin.discordImport.urlLabel")}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          style={styles.input}
        />
        <Pressable accessibilityRole="button" style={[styles.secondary, (!url.trim() || !!busy) && { opacity: 0.45 }]} disabled={!url.trim() || !!busy} onPress={() => void load()}>
          {busy === "load" ? <ActivityIndicator color={colors.cyan} /> : <Text style={styles.secondaryText}>{t("admin.discordImport.preview")}</Text>}
        </Pressable>
      </View>
      {!!error && <Text style={styles.error}>{error}</Text>}
      {preview && dryRun && (
        <View style={styles.preview}>
          <View style={styles.row}>
            <Text style={[styles.title, { flex: 1 }]} numberOfLines={1}>{preview.name}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setPreview(null);
                setApplied(null);
                setRollback(null);
                setError("");
              }}
            >
              <Text style={styles.link}>{t("admin.discordImport.clear")}</Text>
            </Pressable>
          </View>
          {!!preview.description && <Text style={styles.muted}>{preview.description}</Text>}
          <View style={styles.stats}>
            <Text style={styles.stat}>{plain(t("admin.discordImport.rooms", { count: dryRun.summary.rooms }))}</Text>
            <Text style={styles.stat}>{plain(t("admin.discordImport.roles", { count: dryRun.summary.roles }))}</Text>
            <Text style={styles.stat}>{plain(t("admin.discordImport.conflicts", { count: dryRun.summary.conflicts }))}</Text>
            <Text style={styles.stat}>{plain(t("admin.discordImport.unsupported", { count: dryRun.summary.unsupported }))}</Text>
          </View>
          {dryRun.conflicts.length > 0 && (
            <View style={{ gap: 3 }}>
              <Text style={styles.label}>{t("admin.discordImport.kept")}</Text>
              {dryRun.conflicts.slice(0, 12).map((conflict) => (
                <Text key={`${conflict.kind}-${conflict.existingId}`} style={styles.muted}>
                  {conflict.kind === "room"
                    ? conflict.category
                      ? t("admin.discordImport.conflictRoomIn", { name: conflict.name, category: conflict.category })
                      : t("admin.discordImport.conflictRoom", { name: conflict.name })
                    : conflict.category
                      ? t("admin.discordImport.conflictRoleIn", { name: conflict.name, category: conflict.category })
                      : t("admin.discordImport.conflictRole", { name: conflict.name })}
                </Text>
              ))}
            </View>
          )}
          {dryRun.unsupported.length > 0 && <Text style={styles.warn}>{t("admin.discordImport.notImported", { items: dryRun.unsupported.join(", ") })}</Text>}
          <Text style={styles.muted}>{t("admin.discordImport.note")}</Text>
          {rollback && (
            <Text style={styles.muted}>
              {t("admin.discordImport.rollback", {
                rooms: t("admin.discordImport.rollbackRooms", { count: rollback.deletedRoomIds.length }),
                roles: t("admin.discordImport.rollbackRoles", { count: rollback.deletedRoleIds.length }),
              })}{" "}
              {rollback.retainedRoomIds.length + rollback.retainedRoleIds.length > 0 ? t("admin.discordImport.rollbackKept") : ""}
            </Text>
          )}
          {!applied ? (
            <Pressable accessibilityRole="button" style={styles.primary} disabled={!!busy} onPress={() => void apply()}>
              <Text style={styles.primaryText}>{busy === "apply" ? t("admin.discordImport.applying") : t("admin.discordImport.apply")}</Text>
            </Pressable>
          ) : (
            <Pressable accessibilityRole="button" style={styles.secondaryWide} disabled={!!busy} onPress={() => void undo()}>
              <Text style={styles.secondaryText}>{busy === "rollback" ? t("admin.discordImport.rollingBack") : t("admin.discordImport.undo")}</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  kicker: { color: colors.cyan, fontSize: 11, fontWeight: "900", letterSpacing: 1 },
  title: { color: colors.text, fontSize: 15, fontWeight: "900" },
  muted: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  warn: { color: colors.yellow, fontSize: 12, lineHeight: 17 },
  label: { color: colors.text, fontSize: 12, fontWeight: "900" },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  input: { flex: 1, minHeight: 42, paddingHorizontal: 12, borderRadius: 12, color: colors.text, backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border, fontSize: 14 },
  secondary: { paddingHorizontal: 12, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border },
  secondaryWide: { height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border },
  secondaryText: { color: colors.cyan, fontSize: 13, fontWeight: "800" },
  preview: { gap: 8, padding: 10, borderRadius: 12, backgroundColor: colors.panel2 },
  stats: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  stat: { color: colors.text, fontSize: 12, fontWeight: "800" },
  primary: { height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.cyan },
  primaryText: { color: "#061018", fontSize: 14, fontWeight: "900" },
  error: { color: colors.red, fontSize: 12 },
  link: { color: colors.cyan, fontSize: 13, fontWeight: "800" },
});
