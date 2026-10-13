import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { successHaptic } from "@/src/lib/haptics";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { emitSquadSearchChanged } from "@/src/lib/squad-search-events";
import { Screen } from "@/src/components/Screen";
import { apiJson } from "@/src/lib/api";
import { useSession } from "@/src/providers/SessionProvider";
import { colors } from "@/src/theme";
import type { GroupChat } from "@/src/types";
import { useTranslation } from "react-i18next";
import { i18next } from "@/src/i18n";

type SquadSearch = {
  id: string;
  game: string;
  platform: string;
  language: string;
  region: string;
  microphoneRequired: boolean;
  groupId: string | null;
  memberCount: number;
  expiresAt: string;
  owner?: { id: string | null; username: string; avatarUrl?: string | null };
};
const GAMES = ["Escape from Tarkov"];
const PLATFORMS = ["PC", "PlayStation", "Xbox", "Mobile"];
const LANGUAGES = [
  "English",
  "Polish",
  "German",
  "French",
  "Spanish",
  "Italian",
  "Portuguese",
  "Dutch",
  "Swedish",
  "Norwegian",
  "Danish",
  "Finnish",
  "Czech",
  "Slovak",
  "Hungarian",
  "Romanian",
  "Greek",
  "Bulgarian",
  "Serbian",
  "Croatian",
  "Slovenian",
  "Lithuanian",
  "Latvian",
  "Estonian",
  "Turkish",
  "Arabic",
  "Hebrew",
  "Persian",
  "Russian",
  "Ukrainian",
  "Hindi",
  "Bengali",
  "Urdu",
  "Chinese",
  "Japanese",
  "Korean",
  "Thai",
  "Vietnamese",
  "Indonesian",
  "Malay",
  "Filipino",
];
const REGIONS = ["Europe", "North America", "South America", "Asia", "Oceania", "Middle East", "Africa"];

type SquadField = "platform" | "region" | "language";

// Platform, language and region values are stored in English; these show them in
// the UI language (same keys as the web app). Values without a translation show as stored.
const translateUntyped = (key: string) => (i18next.t as unknown as (key: string) => string)(key);

function squadValueLabel(field: SquadField, value: string): string {
  const key = `common.squad.${field}.${value.replace(/[^A-Za-z]/g, "")}`;
  return i18next.exists(key) ? translateUntyped(key) : value;
}

export default function SquadFinderScreen() {
  const { t } = useTranslation(["social", "common"]);
  const { token } = useSession();
  const [game, setGame] = useState(GAMES[0]);
  const [platform, setPlatform] = useState(PLATFORMS[0]);
  const [language, setLanguage] = useState(LANGUAGES[0]);
  const [region, setRegion] = useState(REGIONS[0]);
  const [microphoneRequired, setMicrophoneRequired] = useState(true);
  const [games, setGames] = useState(GAMES);
  const [suggestion, setSuggestion] = useState("");
  const [current, setCurrent] = useState<SquadSearch | null>(null);
  const [matches, setMatches] = useState<SquadSearch[]>([]);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [autoJoin, setAutoJoin] = useState(true);
  const autoJoinedRef = useRef<string | null>(null);
  const autoRetriedRef = useRef<string | null>(null);
  const [notice, setNotice] = useState("");

  const load = async () => {
    if (!token) return;
    try {
      const [data, catalog] = await Promise.all([
        apiJson<{ current: SquadSearch | null; matches: SquadSearch[] }>("/api/squad-finder", {}, token),
        apiJson<{ games: string[] }>("/api/squad-finder/games", {}, token),
      ]);
      setCurrent(data.current);
      setMatches(data.matches || []);
      if (catalog.games?.length) {
        setGames(catalog.games);
        setGame((value) => (catalog.games.includes(value) ? value : catalog.games[0]));
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t("social.mobile.squadFinder.couldNotLoadSquadFinder"));
    }
  };
  // Poll only while visible; NotificationProvider keeps watching for matches on other tabs.
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      void load();
      return () => setFocused(false);
    }, [token]),
  );
  useEffect(() => {
    if (!current || !focused) return;
    const timer = setInterval(() => void load(), 8000);
    return () => clearInterval(timer);
  }, [current?.id, token, focused]);
  const start = async () => {
    if (!token) return;
    setBusy(true);
    setNotice("");
    try {
      const data = await apiJson<{ current: SquadSearch; matches: SquadSearch[] }>(
        "/api/squad-finder",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ game, platform, language, region, microphoneRequired }),
        },
        token,
      );
      setCurrent(data.current);
      setMatches(data.matches || []);
      setNotice(data.matches?.length ? t("social.mobile.squadFinder.compatibleSquadsFound") : t("social.mobile.squadFinder.searchingForCompatiblePlayers"));
      emitSquadSearchChanged();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t("social.mobile.squadFinder.couldNotStartSearch"));
    } finally {
      setBusy(false);
    }
  };
  const stop = async () => {
    if (!token) return;
    setBusy(true);
    try {
      await apiJson("/api/squad-finder", { method: "DELETE" }, token);
      setCurrent(null);
      setMatches([]);
      setNotice(t("social.mobile.squadFinder.searchStopped"));
      emitSquadSearchChanged();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t("social.mobile.squadFinder.couldNotStopSearch"));
    } finally {
      setBusy(false);
    }
  };
  const join = async (match: SquadSearch) => {
    if (!token) return;
    setBusy(true);
    try {
      const data = await apiJson<{ group: GroupChat; hubId: number; channelId: number; channelName: string }>(
        `/api/squad-finder/${encodeURIComponent(match.id)}/join`,
        { method: "POST" },
        token,
      );
      setCurrent(null);
      setMatches([]);
      router.replace(
        `/voice/${data.channelId}?hubId=${data.hubId}&name=${encodeURIComponent(data.channelName || t("social.mobile.squadFinder.squadLounge"))}&squad=1`,
      );
    } catch (error) {
      const key = match.groupId || match.id;
      if (autoJoinedRef.current === key && autoRetriedRef.current !== key) {
        autoRetriedRef.current = key;
        autoJoinedRef.current = null;
        setNotice(t("social.mobile.squadFinder.couldnTJoinThatSquad"));
      } else
        setNotice(
          error instanceof Error
            ? t("social.mobile.squadFinder.messageTapJoinToTry", { message: error.message })
            : t("social.mobile.squadFinder.couldNotJoinSquadTap"),
        );
    } finally {
      setBusy(false);
    }
  };
  // Auto-join: take the first compatible squad as soon as one appears.
  useEffect(() => {
    if (!autoJoin || !focused || !current || busy || matches.length === 0) return;
    const first = matches[0];
    const key = first.groupId || first.id;
    if (autoJoinedRef.current === key) return;
    autoJoinedRef.current = key;
    successHaptic();
    void join(first);
  }, [autoJoin, focused, current?.id, matches, busy]);
  const suggest = async () => {
    if (!token || !suggestion.trim()) return;
    setBusy(true);
    setNotice("");
    try {
      await apiJson(
        "/api/squad-finder/game-suggestions",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ gameName: suggestion.trim() }),
        },
        token,
      );
      setSuggestion("");
      setNotice(t("social.mobile.squadFinder.submittedForReviewItWill"));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t("social.mobile.squadFinder.couldNotSubmitThatGame"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={styles.top}>
        <View style={{ flex: 1 }}>
          <Text maxFontSizeMultiplier={1.3} style={styles.kicker}>
            {t("social.mobile.squadFinder.liveMatchmaking")}
          </Text>
          <Text style={styles.title}>{t("common.squad.title")}</Text>
        </View>
        <Ionicons name="people-circle-outline" size={24} color={colors.violet} />
      </View>
      <ScrollView
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.cyan}
            onRefresh={() => {
              setRefreshing(true);
              void load().finally(() => setRefreshing(false));
            }}
          />
        }
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.intro}>{t("social.mobile.squadFinder.playersOnlyMatchWhenAll")}</Text>
        <Choice
          icon="game-controller-outline"
          title={t("social.mobile.squadFinder.game")}
          values={games}
          value={game}
          disabled={!!current}
          onChange={setGame}
        />
        <View style={styles.suggest}>
          <View style={{ flex: 1 }}>
            <Text style={styles.suggestTitle}>{t("common.squad.suggestTitle")}</Text>
            <Text style={styles.help}>{t("social.mobile.squadFinder.suggestItForOwnerReview")}</Text>
          </View>
          <TextInput
            value={suggestion}
            onChangeText={setSuggestion}
            maxLength={60}
            placeholder={t("social.mobile.squadFinder.gameName")}
            placeholderTextColor={colors.faint}
            style={styles.suggestInput}
          />
          <Pressable
            accessibilityRole="button"
            disabled={busy || !suggestion.trim()}
            style={[styles.suggestButton, (busy || !suggestion.trim()) && styles.disabled]}
            onPress={() => void suggest()}
          >
            <Text style={styles.suggestButtonText}>{t("common.squad.submit")}</Text>
          </Pressable>
        </View>
        <Choice
          icon="hardware-chip-outline"
          title={t("social.mobile.squadFinder.platform")}
          values={PLATFORMS}
          field="platform"
          value={platform}
          disabled={!!current}
          onChange={setPlatform}
        />
        <Choice
          icon="language-outline"
          title={t("social.mobile.squadFinder.language")}
          values={LANGUAGES}
          field="language"
          value={language}
          disabled={!!current}
          onChange={setLanguage}
        />
        <Choice
          icon="globe-outline"
          title={t("social.mobile.squadFinder.region")}
          values={REGIONS}
          field="region"
          value={region}
          disabled={!!current}
          onChange={setRegion}
        />
        <View style={styles.micRow}>
          <View style={styles.micIcon}>
            <Ionicons name="mic-outline" size={19} color={microphoneRequired ? colors.cyan : colors.muted} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.micTitle}>{t("common.squad.micRequired")}</Text>
            <Text style={styles.help}>{t("social.mobile.squadFinder.chooseWhetherSquadMembersMust")}</Text>
          </View>
          <View style={micOptionStyles.options}>
            <Pressable
              disabled={!!current}
              accessibilityRole="button"
              accessibilityState={{ selected: microphoneRequired, disabled: !!current }}
              style={[micOptionStyles.choice, microphoneRequired && micOptionStyles.active]}
              onPress={() => setMicrophoneRequired(true)}
            >
              <Text style={[micOptionStyles.text, microphoneRequired && micOptionStyles.textActive]}>{t("common.squad.yes")}</Text>
            </Pressable>
            <Pressable
              disabled={!!current}
              accessibilityRole="button"
              accessibilityState={{ selected: !microphoneRequired, disabled: !!current }}
              style={[micOptionStyles.choice, !microphoneRequired && micOptionStyles.active]}
              onPress={() => setMicrophoneRequired(false)}
            >
              <Text style={[micOptionStyles.text, !microphoneRequired && micOptionStyles.textActive]}>{t("common.squad.no")}</Text>
            </Pressable>
          </View>
        </View>
        <View style={styles.micRow}>
          <View style={styles.micIcon}>
            <Ionicons name="flash-outline" size={19} color={autoJoin ? colors.cyan : colors.muted} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.micTitle}>{t("social.mobile.squadFinder.autoJoinFirstMatch")}</Text>
            <Text style={styles.help}>{t("social.mobile.squadFinder.jumpStraightIntoTheSquad")}</Text>
          </View>
          <Switch value={autoJoin} onValueChange={setAutoJoin} trackColor={{ true: colors.violet }} />
        </View>
        {!current && (
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            style={[styles.primary, busy && styles.disabled]}
            onPress={() => void start()}
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Ionicons name="search-outline" size={18} color="#fff" />}
            <Text style={styles.primaryText}>{t("social.mobile.squadFinder.startSearch")}</Text>
          </Pressable>
        )}
        {!!notice && <Text style={styles.notice}>{notice}</Text>}
        {current && (
          <View style={styles.live}>
            <View style={styles.dot} />
            <View style={{ flex: 1 }}>
              <Text style={styles.liveTitle}>{t("common.squad.running")}</Text>
              <Text style={styles.liveText}>
                {current.game} · {squadValueLabel("platform", current.platform)} · {squadValueLabel("language", current.language)} · {squadValueLabel("region", current.region)}
              </Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={t("common.squad.refresh")} onPress={() => void load()}>
              <Ionicons name="refresh-outline" size={19} color={colors.cyan} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              accessibilityLabel={t("common.squad.cancel")}
              style={[liveActionStyles.cancel, busy && styles.disabled]}
              onPress={() => void stop()}
            >
              <Ionicons name="close" size={15} color="#FF9AAA" />
              <Text style={liveActionStyles.cancelText}>{t("common.actions.cancel")}</Text>
            </Pressable>
          </View>
        )}
        {current && (
          <>
            <Text style={styles.matchesTitle}>{t("social.mobile.squadFinder.possibleGroups")}</Text>
            {matches.length === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="hourglass-outline" size={26} color={colors.faint} />
                <Text style={styles.emptyTitle}>{t("social.mobile.squadFinder.waitingForCompatiblePlayers")}</Text>
                <Text style={styles.help}>{t("social.mobile.squadFinder.resultsRefreshAutomaticallyWhileYour")}</Text>
              </View>
            ) : (
              matches.map((match) => (
                <View style={styles.match} key={match.groupId || match.id}>
                  <View style={styles.matchIcon}>
                    <Ionicons name="people-outline" size={20} color={colors.cyan} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.matchTitle}>{match.owner?.username || t("social.mobile.squadFinder.gameSquad", { game: match.game })}</Text>
                    <Text style={styles.matchText}>
                      {t("social.mobile.squadFinder.membercount4PlayersPlatformRegion", { memberCount: match.memberCount, platform: squadValueLabel("platform", match.platform), region: squadValueLabel("region", match.region) })}
                    </Text>
                    <Text style={styles.matchText}>
                      {t(match.microphoneRequired ? "social.mobile.squadFinder.micRequired" : "social.mobile.squadFinder.micOptional", { language: squadValueLabel("language", match.language) })}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    disabled={busy}
                    style={styles.join}
                    onPress={() => void join(match)}
                  >
                    <Text style={styles.joinText}>{t("common.actions.join")}</Text>
                  </Pressable>
                </View>
              ))
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

/** Collapsed picker: shows the current value, expands into a searchable list. */
function Choice({
  icon,
  title,
  values,
  value,
  field,
  disabled,
  onChange,
}: {
  icon: string;
  title: string;
  values: string[];
  value: string;
  /** Stored values shown through their translated labels. */
  field?: SquadField;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const label = (item: string) => (field ? squadValueLabel(field, item) : item);
  const { t } = useTranslation(["social"]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? values.filter((item) => label(item).toLowerCase().includes(q)) : values;
  }, [query, values, field]);
  const pick = (item: string) => {
    onChange(item);
    setOpen(false);
    setQuery("");
  };
  return (
    <View style={pickerStyles.wrap}>
      <Pressable
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`${title}: ${label(value)}`}
        accessibilityState={{ expanded: open, disabled }}
        onPress={() => setOpen((v) => !v)}
        style={({ pressed }) => [
          pickerStyles.head,
          open && pickerStyles.headOpen,
          disabled && styles.disabled,
          pressed && { opacity: 0.75 },
        ]}
      >
        <View style={styles.micIcon}>
          <Ionicons name={icon as any} size={18} color={colors.cyan} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.section}>{title}</Text>
          <Text style={pickerStyles.value} numberOfLines={1}>
            {label(value)}
          </Text>
        </View>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={colors.muted} />
      </Pressable>
      {open && (
        <View style={pickerStyles.body}>
          {values.length > 6 && (
            <View style={pickerStyles.search}>
              <Ionicons name="search" size={15} color={colors.faint} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={t("social.mobile.squadFinder.searchValue", { value: title.toLowerCase() })}
                placeholderTextColor={colors.faint}
                autoCorrect={false}
                style={pickerStyles.searchInput}
              />
              {!!query && (
                <Pressable accessibilityRole="button" accessibilityLabel={t("social.mobile.squadFinder.clearSearch")} onPress={() => setQuery("")}>
                  <Ionicons name="close-circle" size={16} color={colors.faint} />
                </Pressable>
              )}
            </View>
          )}
          <ScrollView
            keyboardDismissMode="on-drag"
            style={{ maxHeight: 240 }}
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
          >
            {filtered.length === 0 ? (
              <Text style={[styles.help, { padding: 12 }]}>{t("social.mobile.squadFinder.noMatches")}</Text>
            ) : (
              filtered.map((item) => (
                <Pressable
                  key={item}
                  accessibilityRole="button"
                  accessibilityState={{ selected: item === value }}
                  onPress={() => pick(item)}
                  style={({ pressed }) => [
                    pickerStyles.row,
                    item === value && pickerStyles.rowActive,
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Text style={[pickerStyles.rowText, item === value && { color: colors.cyan }]}>{label(item)}</Text>
                  {item === value && <Ionicons name="checkmark" size={16} color={colors.cyan} />}
                </Pressable>
              ))
            )}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const pickerStyles = StyleSheet.create({
  wrap: {
    marginTop: 12,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    overflow: "hidden",
  },
  head: { minHeight: 60, padding: 11, flexDirection: "row", alignItems: "center", gap: 10 },
  headOpen: { borderBottomWidth: 1, borderBottomColor: colors.border },
  value: { color: colors.text, fontSize: 14, fontWeight: "800", marginTop: -4 },
  body: { padding: 8 },
  search: {
    height: 40,
    marginBottom: 6,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel2,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 14 },
  row: {
    minHeight: 42,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 9,
  },
  rowActive: { backgroundColor: colors.cyanSoft },
  rowText: { color: colors.text, fontSize: 14, fontWeight: "600" },
});

const micOptionStyles = StyleSheet.create({
  options: { flexDirection: "row", gap: 6 },
  choice: {
    width: 45,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 9,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel2,
  },
  active: { borderColor: "rgba(95,225,255,.38)", backgroundColor: colors.cyanSoft },
  text: { color: colors.muted, fontSize: 12, fontWeight: "900" },
  textActive: { color: colors.cyan },
});
const liveActionStyles = StyleSheet.create({
  cancel: {
    height: 34,
    paddingHorizontal: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "rgba(255,98,125,.25)",
    backgroundColor: "rgba(169,56,74,.13)",
  },
  cancelText: { color: "#FF9AAA", fontSize: 12, fontWeight: "900" },
});

const styles = StyleSheet.create({
  top: {
    minHeight: 76,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.bg,
  },
  kicker: { color: colors.cyan, fontSize: 12, fontWeight: "900", letterSpacing: 1.7 },
  title: { color: colors.text, fontSize: 21, fontWeight: "900" },
  scroll: { padding: 14, paddingBottom: 44 },
  intro: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  section: { color: colors.muted, fontSize: 12, fontWeight: "900", letterSpacing: 1.3, marginBottom: 8 },
  suggest: {
    marginTop: 12,
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 7,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
  },
  suggestTitle: { color: colors.text, fontSize: 13, fontWeight: "900" },
  suggestInput: {
    minWidth: 130,
    height: 38,
    paddingHorizontal: 10,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel2,
    color: colors.text,
    fontSize: 13,
  },
  suggestButton: {
    height: 38,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 9,
    backgroundColor: colors.violetSoft,
  },
  suggestButtonText: { color: colors.violet, fontSize: 12, fontWeight: "900" },
  micRow: {
    minHeight: 68,
    marginTop: 20,
    padding: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
  },
  micIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.panel2,
  },
  micTitle: { color: colors.text, fontSize: 14, fontWeight: "900" },
  help: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  primary: {
    minHeight: 48,
    marginTop: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderRadius: 13,
    backgroundColor: colors.violet,
  },
  disabled: { opacity: 0.58 },
  primaryText: { color: "#fff", fontSize: 13, fontWeight: "900" },
  notice: { marginTop: 9, color: colors.muted, fontSize: 12, textAlign: "center" },
  live: {
    marginTop: 14,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "rgba(67,226,154,.20)",
    backgroundColor: colors.greenSoft,
  },
  dot: { width: 8, height: 8, borderRadius: 99, backgroundColor: colors.green },
  liveTitle: { color: colors.green, fontSize: 13, fontWeight: "900" },
  liveText: { color: colors.muted, fontSize: 12, marginTop: 2 },
  matchesTitle: {
    marginTop: 22,
    marginBottom: 8,
    color: colors.muted,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.3,
  },
  empty: {
    padding: 28,
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.border,
  },
  emptyTitle: { marginTop: 8, color: colors.text, fontSize: 14, fontWeight: "900" },
  match: {
    minHeight: 76,
    marginBottom: 8,
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
  },
  matchIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.cyanSoft,
  },
  matchTitle: { color: colors.text, fontSize: 13, fontWeight: "900" },
  matchText: { color: colors.muted, fontSize: 12, marginTop: 2 },
  join: {
    minHeight: 36,
    paddingHorizontal: 13,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: colors.violetSoft,
    borderWidth: 1,
    borderColor: "rgba(124,92,255,.28)",
  },
  joinText: { color: colors.violet, fontSize: 12, fontWeight: "900" },});
