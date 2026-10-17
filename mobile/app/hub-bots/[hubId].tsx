import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { Screen } from "@/src/components/Screen";
import { apiJson } from "@/src/lib/api";
import {
  summarizeBot,
  timeAgo,
  type BotBuilderOverview,
  type BotRun,
  type ClientBot,
} from "@/src/lib/bots";
import { runNoticeText } from "@/src/lib/server-notice";
import { useSession } from "@/src/providers/SessionProvider";
import { colors } from "@/src/theme";
import { useTranslation } from "react-i18next";

const JSON_HEADERS = { "Content-Type": "application/json" };

export default function HubBotsScreen() {
  const { t } = useTranslation(["bots", "common"]);
  const { hubId } = useLocalSearchParams<{ hubId: string }>();
  const { token } = useSession();
  const [overview, setOverview] = useState<BotBuilderOverview | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, BotRun[]>>({});
  const [now, setNow] = useState(() => Date.now());
  const [newName, setNewName] = useState("");

  const load = useCallback(async () => {
    if (!token || !hubId) return;
    setError("");
    try {
      const data = await apiJson<BotBuilderOverview>(`/api/servers/${hubId}/bot-builder`, {}, token);
      // The list does not carry run times; fetch the latest runs per builder bot.
      const latest = await Promise.all(
        data.bots.map(async (bot) => {
          if (bot.kind !== "builder") return null;
          try {
            const result = await apiJson<{ runs: BotRun[] }>(`/api/servers/${hubId}/bot-builder/${bot.id}/runs`, {}, token);
            return [bot.id, result.runs] as const;
          } catch {
            return null;
          }
        }),
      );
      const byBot: Record<string, BotRun[]> = {};
      for (const entry of latest) if (entry) byBot[entry[0]] = entry[1];
      setRuns((current) => ({ ...current, ...byBot }));
      setOverview({ ...data, bots: data.bots.map((bot) => ({ ...bot, lastRunAt: byBot[bot.id]?.[0]?.created_at ?? null })) });
      setNow(Date.now());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("bots.section.loadFailed"));
    }
  }, [token, hubId]);

  useEffect(() => {
    void load();
  }, [load]);

  const setEnabled = async (bot: ClientBot, enabled: boolean) => {
    if (!token || busy) return;
    setBusy(bot.id);
    setError("");
    setNotice("");
    try {
      await apiJson(
        `/api/servers/${hubId}/bot-builder/${bot.id}`,
        { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify({ enabled }) },
        token,
      );
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("bots.page.updateFailed"));
    } finally {
      setBusy("");
    }
  };

  const createFromTemplate = async (templateId: string, name: string) => {
    if (!token || busy) return;
    setBusy(`template:${templateId}`);
    setError("");
    setNotice("");
    try {
      const created = await apiJson<ClientBot>(
        `/api/servers/${hubId}/bot-builder`,
        { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ name, templateId }) },
        token,
      );
      setNotice(t("bots.newBot.createdFromTemplate"));
      await load();
      openBot(created.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("bots.mobile.hubBots.couldNotCreateTheBot"));
    } finally {
      setBusy("");
    }
  };

  const openBot = (botId: string) => router.push(`/hub-bot/${encodeURIComponent(botId)}?hubId=${hubId}` as never);

  const createBlank = async () => {
    const name = newName.trim().slice(0, 32);
    if (!token || busy || !name) return;
    setBusy("scratch");
    setError("");
    setNotice("");
    try {
      const created = await apiJson<ClientBot>(
        `/api/servers/${hubId}/bot-builder`,
        { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ name }) },
        token,
      );
      setNewName("");
      await load();
      openBot(created.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("bots.mobile.hubBots.couldNotCreateTheBot"));
    } finally {
      setBusy("");
    }
  };

  // A .decave-bot.json file exported from web, desktop or another phone.
  const importBot = async () => {
    if (!token || busy) return;
    const picked = await DocumentPicker.getDocumentAsync({ type: ["application/json", "text/plain", "*/*"], copyToCacheDirectory: true });
    if (picked.canceled || !picked.assets?.[0]) return;
    const file = picked.assets[0];
    setBusy("import");
    setError("");
    setNotice("");
    try {
      if ((file.size ?? 0) > 512 * 1024) throw new Error(t("bots.newBot.fileTooLarge"));
      let parsed: unknown;
      try {
        parsed = JSON.parse(await (await fetch(file.uri)).text());
      } catch {
        throw new Error(t("bots.newBot.fileInvalid"));
      }
      const result = await apiJson<{ bot: ClientBot; unresolved: string[] }>(
        `/api/servers/${hubId}/bot-builder/import`,
        { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(parsed) },
        token,
      );
      setNotice(result.unresolved.length ? t("bots.newBot.importedUnresolved", { names: result.unresolved.join(", ") }) : t("bots.newBot.imported"));
      await load();
      openBot(result.bot.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("bots.newBot.genericError"));
    } finally {
      setBusy("");
    }
  };

  const toggleActivity = async (bot: ClientBot) => {
    if (openId === bot.id) {
      setOpenId(null);
      return;
    }
    setOpenId(bot.id);
    if (!token) return;
    try {
      const result = await apiJson<{ runs: BotRun[] }>(`/api/servers/${hubId}/bot-builder/${bot.id}/runs`, {}, token);
      setRuns((current) => ({ ...current, [bot.id]: result.runs }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("bots.activity.loadFailed"));
    }
  };

  return (
    <Screen>
      <View style={styles.top}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("common.actions.back")} style={styles.back} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={22} color={colors.cyan} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>{t("bots.mobile.hubBots.hubControl")}</Text>
          <Text style={styles.title}>{t("bots.section.title")}</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {!!error && <Text style={styles.error}>{error}</Text>}
        {!!notice && <Text style={styles.notice}>{notice}</Text>}
        {!overview && !error && <Text style={styles.muted}>{t("bots.section.loading")}</Text>}
        {overview && overview.bots.length === 0 && (
          <View style={styles.card}>
            <Text style={styles.name}>{t("bots.section.emptyTitle")}</Text>
            <Text style={styles.muted}>{t("bots.section.emptyHint")}</Text>
          </View>
        )}

        {overview && (
          <>
            <Text style={styles.section}>{t("bots.newBot.scratch").toUpperCase()}</Text>
            <View style={[styles.card, styles.row]}>
              <TextInput
                value={newName}
                onChangeText={setNewName}
                placeholder={t("bots.newBot.name")}
                placeholderTextColor={colors.faint}
                maxLength={32}
                style={styles.input}
                onSubmitEditing={() => void createBlank()}
                returnKeyType="done"
              />
              <Pressable accessibilityRole="button" style={[styles.primary, styles.inlineButton, !newName.trim() && { opacity: 0.45 }]} disabled={!!busy || !newName.trim()} onPress={() => void createBlank()}>
                <Text style={styles.primaryText}>{busy === "scratch" ? t("bots.newBot.creating") : t("bots.newBot.create")}</Text>
              </Pressable>
            </View>
            <Pressable accessibilityRole="button" style={styles.link} disabled={!!busy} onPress={() => void importBot()}>
              <Text style={styles.linkText}>{busy === "import" ? t("bots.newBot.importing") : t("bots.newBot.chooseFile")}</Text>
            </Pressable>
          </>
        )}
        {overview?.bots.map((bot) => (
          <View key={bot.id} style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.emoji}>{bot.avatarEmoji || "🤖"}</Text>
              <Pressable
                accessibilityRole={bot.kind === "builder" ? "button" : undefined}
                disabled={bot.kind !== "builder"}
                style={{ flex: 1 }}
                onPress={() => openBot(bot.id)}
              >
                <Text style={styles.name} numberOfLines={1}>{bot.name}</Text>
                {bot.kind === "builder" ? (
                  <Text style={[styles.muted, bot.pausedReason && styles.warn]}>{summarizeBot(bot, now)}</Text>
                ) : (
                  <Text style={styles.muted}>{t("bots.mobile.hubBots.manageOnDesktop")}</Text>
                )}
                {bot.kind === "builder" && bot.hasUnpublishedChanges && (
                  <Text style={[styles.muted, styles.warn]}>{t("bots.status.unpublished")}</Text>
                )}
              </Pressable>
              {bot.kind === "builder" && <Ionicons name="chevron-forward" size={16} color={colors.faint} />}
              {bot.kind === "builder" && (
                <Switch
                  accessibilityLabel={t("bots.mobile.hubBots.nameEnabled", { name: bot.name })}
                  value={bot.enabled}
                  disabled={!!busy}
                  onValueChange={(value) => void setEnabled(bot, value)}
                />
              )}
            </View>
            {bot.kind === "builder" && (
              <>
                <Pressable accessibilityRole="button" style={styles.link} onPress={() => void toggleActivity(bot)}>
                  <Text style={styles.linkText}>{openId === bot.id ? t("bots.mobile.hubBots.hideActivity") : t("bots.mobile.hubBots.showActivity")}</Text>
                </Pressable>
                {openId === bot.id &&
                  ((runs[bot.id] ?? []).length === 0 ? (
                    <Text style={styles.muted}>{t("bots.mobile.hubBots.noRunsYet")}</Text>
                  ) : (
                    (runs[bot.id] ?? []).slice(0, 20).map((run) => (
                      <View key={run.id} style={styles.run}>
                        <Text style={[styles.runStatus, run.status === "error" && styles.warn]}>{run.status}</Text>
                        <Text style={[styles.muted, { flex: 1 }]} numberOfLines={2}>{(run.detail && runNoticeText(run.notice, run.detail)) || run.trigger}</Text>
                        <Text style={styles.muted}>{timeAgo(run.created_at, now)}</Text>
                      </View>
                    ))
                  ))}
              </>
            )}
          </View>
        ))}

        {overview && overview.templates.length > 0 && (
          <>
            <Text style={styles.section}>{t("bots.mobile.hubBots.startFromATemplate")}</Text>
            {overview.templates.map((template) => (
              <View key={template.id} style={styles.card}>
                <Text style={styles.name}>{template.name}</Text>
                <Text style={styles.muted}>{template.description}</Text>
                <Pressable
                  accessibilityRole="button"
                  style={styles.primary}
                  disabled={!!busy}
                  onPress={() => void createFromTemplate(template.id, template.name.slice(0, 32))}
                >
                  <Text style={styles.primaryText}>{busy === `template:${template.id}` ? t("bots.newBot.creating") : t("bots.mobile.hubBots.createBot")}</Text>
                </Pressable>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, paddingBottom: 8 },
  back: { width: 40, height: 40, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border },
  kicker: { color: colors.cyan, fontSize: 11, fontWeight: "900", letterSpacing: 1.1 },
  title: { color: colors.text, fontSize: 19, fontWeight: "900", marginTop: 2 },
  scroll: { padding: 14, paddingBottom: 28, gap: 10 },
  card: { padding: 11, borderRadius: 17, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border, gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  emoji: { fontSize: 22 },
  name: { color: colors.text, fontSize: 14, fontWeight: "900" },
  muted: { color: colors.muted, fontSize: 13, marginTop: 2 },
  warn: { color: colors.yellow },
  error: { color: colors.red, fontSize: 13 },
  notice: { color: colors.green, fontSize: 13 },
  section: { color: colors.faint, fontSize: 10.5, fontWeight: "700", letterSpacing: 1.6, marginTop: 10 },
  link: { minHeight: 36, justifyContent: "center" },
  linkText: { color: colors.cyan, fontSize: 13, fontWeight: "900" },
  run: { flexDirection: "row", alignItems: "center", gap: 8 },
  runStatus: { color: colors.text, fontSize: 12, fontWeight: "900", minWidth: 52 },
  primary: { minHeight: 43, borderRadius: 12, backgroundColor: colors.cyan, alignItems: "center", justifyContent: "center" },
  primaryText: { color: "#061018", fontSize: 12, fontWeight: "900" },
  input: { flex: 1, minHeight: 43, paddingHorizontal: 12, borderRadius: 12, color: colors.text, backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border, fontSize: 14 },
  inlineButton: { paddingHorizontal: 16 },
});
