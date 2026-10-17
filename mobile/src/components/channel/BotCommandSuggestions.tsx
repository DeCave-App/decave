// Slash-command suggestions above the room composer, fed by
// GET /api/servers/:hubId/bot-commands (404 while the bot builder is off),
// like web's src/features/bot-cards/BotCommandSuggestions.tsx.

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { commandsFromResponse, filterCommands, type BotCommandInfo } from "../../../../shared/bots/card-view";
import { apiFetch } from "@/src/lib/api";
import { tapHaptic } from "@/src/lib/haptics";
import { colors } from "@/src/theme";

/** Commands are refetched when "/" is typed and the list is older than this. */
const COMMANDS_MAX_AGE_MS = 60_000;
/** Hubs whose server answered 404 (no bot builder): not asked again this session. */
const hubsWithoutBuilder = new Set<number>();

/** The Hub's commands matching the composer text, loaded when the text starts with "/". */
export function useBotCommands(hubId: number, input: string, token: string | null): BotCommandInfo[] {
  const [loaded, setLoaded] = useState<{ hubId: number; at: number; commands: BotCommandInfo[] } | null>(null);
  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;
  const wantsCommands = input.startsWith("/");

  useEffect(() => {
    const current = loadedRef.current;
    if (!wantsCommands || !token || !hubId || (current?.hubId === hubId && Date.now() - current.at < COMMANDS_MAX_AGE_MS)) return;
    if (hubsWithoutBuilder.has(hubId)) {
      if (current?.hubId !== hubId) setLoaded({ hubId, at: Date.now(), commands: [] });
      return;
    }
    let cancelled = false;
    apiFetch(`/api/servers/${hubId}/bot-commands`, {}, token)
      .then(async (response) => {
        if (response.status === 404) hubsWithoutBuilder.add(hubId);
        return response.ok ? commandsFromResponse(await response.json()) : [];
      })
      .catch(() => [] as BotCommandInfo[])
      .then((commands) => {
        if (!cancelled) setLoaded({ hubId, at: Date.now(), commands });
      });
    return () => {
      cancelled = true;
    };
  }, [wantsCommands, hubId, token]);

  return loaded?.hubId === hubId ? filterCommands(loaded.commands, input) : [];
}

export function commandInsertText(command: BotCommandInfo): string {
  return `/${command.name} `;
}

export function BotCommandSuggestions({ suggestions, onChoose }: { suggestions: BotCommandInfo[]; onChoose: (command: BotCommandInfo) => void }) {
  const { t } = useTranslation(["bots"]);
  if (!suggestions.length) return null;
  return (
    <View style={styles.wrap} accessibilityLabel={t("bots.card.commands")}>
      <ScrollView keyboardShouldPersistTaps="always" style={{ maxHeight: 200 }}>
        {suggestions.map((command) => (
          <Pressable
            key={`${command.botId}:${command.name}`}
            accessibilityRole="button"
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.panel2 }]}
            onPress={() => {
              tapHaptic();
              onChoose(command);
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>
                /{command.name}
                {command.options.length ? (
                  <Text style={styles.options}>
                    {" "}
                    {command.options.map((option) => (option.required ? `<${option.name}>` : `[${option.name}]`)).join(" ")}
                  </Text>
                ) : null}
              </Text>
            </View>
            <Text style={styles.bot} numberOfLines={1}>{command.botName}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginHorizontal: 10, marginBottom: 6, borderRadius: 14, overflow: "hidden", backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  name: { color: colors.text, fontSize: 14, fontWeight: "900" },
  options: { color: colors.muted, fontSize: 13, fontWeight: "600" },
  bot: { maxWidth: 120, color: colors.faint, fontSize: 12, fontWeight: "700" },
});
