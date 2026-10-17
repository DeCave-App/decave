import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Screen } from "@/src/components/Screen";
import { Avatar } from "@/src/components/Avatar";
import { apiJson } from "@/src/lib/api";
import {
  loadAccountPreferences,
  updateAccountPreferences,
  type AccountPreferences,
  type AccountPreferencesPatch,
  type ActivityVisibility,
  type FriendRequestPolicy,
} from "@/src/lib/account-preferences";
import { sendsTypingIndicators, setAccountPreferencesSnapshot } from "@/src/lib/account-preferences-store";
import { useSession } from "@/src/providers/SessionProvider";
import { DmEncryptionSettings } from "@/src/providers/DmE2eeProvider";
import { useDmE2ee } from "@/src/lib/e2ee/client";
import { colors } from "@/src/theme";
import { useTranslation } from "react-i18next";
import { dateLocale } from "@/src/lib/date-locale";

type BlockedAccount = { userId: string; username: string; createdAt: string };

export default function PrivacyScreen() {
  const { t } = useTranslation(["settings", "common"]);
  const friendRequestOptions: Array<[FriendRequestPolicy, string, string]> = [
    ["everyone", t("settings.mobile.privacy.requests.everyone"), t("settings.mobile.privacy.requests.everyoneDetail")],
    ["friends_of_friends", t("settings.mobile.privacy.requests.friendsOfFriends"), t("settings.mobile.privacy.requests.friendsOfFriendsDetail")],
    ["none", t("settings.mobile.privacy.requests.none"), t("settings.mobile.privacy.requests.noneDetail")],
  ];
  const activityOptions: Array<[ActivityVisibility, string]> = [
    ["everyone", t("settings.mobile.privacy.activityOptions.everyone")],
    ["friends", t("settings.mobile.privacy.activityOptions.friends")],
    ["nobody", t("settings.mobile.privacy.activityOptions.nobody")],
  ];
  const dmE2eeAvailable = useDmE2ee().available;
  const { token } = useSession();
  const [friendPolicy, setFriendPolicy] = useState<FriendRequestPolicy | null>(null);
  const [activity, setActivity] = useState<ActivityVisibility | null>(null);
  const [prefs, setPrefs] = useState<AccountPreferences | null>(null);
  const [blocks, setBlocks] = useState<BlockedAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [blocksError, setBlocksError] = useState("");
  const [unblocking, setUnblocking] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setError("");
    setBlocksError("");
    const [prefs, blockData] = await Promise.allSettled([
      loadAccountPreferences(token),
      apiJson<{ blocks: BlockedAccount[] }>("/api/safety/blocks", {}, token),
    ]);
    if (prefs.status === "fulfilled") {
      setFriendPolicy(prefs.value.friendRequestPolicy ?? "everyone");
      setActivity(prefs.value.activityVisibility ?? "everyone");
      setPrefs(prefs.value);
    } else {
      setError(prefs.reason instanceof Error ? prefs.reason.message : t("settings.mobile.privacy.couldNotLoadYourPrivacy"));
    }
    if (blockData.status === "fulfilled") {
      setBlocks(Array.isArray(blockData.value.blocks) ? blockData.value.blocks : []);
    } else {
      setBlocksError(blockData.reason instanceof Error ? blockData.reason.message : t("settings.mobile.privacy.couldNotLoadBlockedAccounts"));
    }
    setLoading(false);
    setRefreshing(false);
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const saveFriendPolicy = async (value: FriendRequestPolicy) => {
    if (!token || value === friendPolicy) return;
    const previous = friendPolicy;
    setFriendPolicy(value);
    setError("");
    try {
      const prefs = await updateAccountPreferences(token, { friendRequestPolicy: value });
      setFriendPolicy(prefs.friendRequestPolicy ?? value);
    } catch (cause) {
      setFriendPolicy(previous);
      setError(cause instanceof Error ? cause.message : t("settings.mobile.accountSecurity.couldNotSaveThisSetting"));
    }
  };

  const saveActivity = async (value: ActivityVisibility) => {
    if (!token || value === activity) return;
    const previous = activity;
    setActivity(value);
    setError("");
    try {
      const prefs = await updateAccountPreferences(token, { activityVisibility: value });
      setActivity(prefs.activityVisibility ?? value);
    } catch (cause) {
      setActivity(previous);
      setError(cause instanceof Error ? cause.message : t("settings.mobile.accountSecurity.couldNotSaveThisSetting"));
    }
  };

  /** Typing indicators and stream previews: shown at once, put back if saving fails. */
  const saveToggle = async (patch: AccountPreferencesPatch, optimistic: AccountPreferences) => {
    if (!token || !prefs) return;
    const previous = prefs;
    setPrefs(optimistic);
    setError("");
    try {
      const saved = await updateAccountPreferences(token, patch);
      setPrefs(saved);
      setAccountPreferencesSnapshot(saved);
    } catch (cause) {
      setPrefs(previous);
      setError(cause instanceof Error ? cause.message : t("settings.mobile.accountSecurity.couldNotSaveThisSetting"));
    }
  };

  const setTypingIndicators = (value: boolean) => {
    if (!prefs) return;
    const clientSettings = prefs.clientSettings ?? {};
    void saveToggle(
      { clientSettingsPatch: { privacy: { sendTypingIndicators: value } } },
      { ...prefs, clientSettings: { ...clientSettings, privacy: { ...clientSettings.privacy, sendTypingIndicators: value } } },
    );
  };

  const setStreamerMode = (value: boolean) => {
    if (!prefs) return;
    void saveToggle({ streamerMode: value }, { ...prefs, streamerMode: value });
  };

  const setStreamPreviews = (value: boolean) => {
    if (!prefs) return;
    void saveToggle({ allowStreamPreviews: value }, { ...prefs, allowStreamPreviews: value });
  };

  const unblock = (account: BlockedAccount) => {
    Alert.alert(t("settings.mobile.privacy.unblockUsername", { username: account.username }), t("settings.mobile.privacy.theyLlBeAbleTo"), [
      { text: t("common.actions.cancel"), style: "cancel" },
      {
        text: t("common.actions.unblock"),
        onPress: () => void (async () => {
          if (!token) return;
          setUnblocking(account.userId);
          setBlocksError("");
          try {
            await apiJson(`/api/safety/blocks/${encodeURIComponent(account.userId)}`, { method: "DELETE" }, token);
            setBlocks((current) => current.filter((item) => item.userId !== account.userId));
          } catch (cause) {
            setBlocksError(cause instanceof Error ? cause.message : t("settings.mobile.privacy.couldNotUnblockThisAccount"));
          } finally {
            setUnblocking(null);
          }
        })(),
      },
    ]);
  };

  return (
    <Screen>
      <View style={styles.top}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("common.actions.back")} style={styles.back} onPress={() => router.back()}><Ionicons name="chevron-back" size={22} color={colors.cyan} /></Pressable>
        <View style={{ flex: 1 }}><Text maxFontSizeMultiplier={1.3} style={styles.kicker}>{t("settings.mobile.accountSecurity.settings")}</Text><Text style={styles.title}>{t("settings.mobile.settings.privacySafety")}</Text></View>
        <Ionicons name="hand-left-outline" size={22} color={colors.cyan} />
      </View>
      <ScrollView keyboardDismissMode="on-drag"
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={colors.cyan} />}
      >
        {loading ? <ActivityIndicator color={colors.cyan} style={{ marginTop: 24 }} /> : (
          <>
            {!!error && <Text style={styles.error}>{error}</Text>}

            <Text style={styles.section}>{t("settings.mobile.privacy.friendRequests")}</Text>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{t("settings.mobile.privacy.whoCanSendYouFriend")}</Text>
              <View style={styles.stack}>
                {friendRequestOptions.map(([value, label, detail]) => {
                  const active = friendPolicy === value;
                  return (
                    <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: active }} style={[styles.option, active && styles.optionActive]} onPress={() => void saveFriendPolicy(value)} disabled={friendPolicy === null}>
                      <View style={[styles.radio, active && styles.radioActive]}>{active && <View style={styles.radioInner} />}</View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.optionTitle, active && styles.optionTitleActive]}>{label}</Text>
                        <Text style={styles.optionDetail}>{detail}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <Text style={styles.section}>{t("settings.mobile.privacy.activity")}</Text>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{t("settings.gaming.visibilityLabel")}</Text>
              <View style={styles.segment}>
                {activityOptions.map(([value, label]) => {
                  const active = activity === value;
                  return (
                    <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: active }} style={[styles.segmentButton, active && styles.segmentButtonActive]} onPress={() => void saveActivity(value)} disabled={activity === null}>
                      <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <Text style={styles.section}>{t("settings.mobile.privacy.messages")}</Text>
            <View style={styles.info}>
              <Ionicons name="chatbubbles-outline" size={18} color={colors.cyan} />
              <Text style={styles.infoText}>{t("settings.mobile.privacy.onlyFriendsCanMessageYou")}</Text>
            </View>
            <View style={[styles.card, styles.toggleCard]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{t("settings.privacy.typing")}</Text>
                <Text style={styles.optionDetail}>{t("settings.privacy.typingHelp")}</Text>
              </View>
              <Switch
                accessibilityLabel={t("settings.privacy.typing")}
                value={sendsTypingIndicators(prefs)}
                onValueChange={setTypingIndicators}
                disabled={!prefs}
                trackColor={{ true: colors.violet }}
              />
            </View>

            <Text style={styles.section}>{t("settings.anchors.streamPrivacy.label").toUpperCase()}</Text>
            <View style={[styles.card, styles.toggleCard]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{t("settings.privacy.streamerMode")}</Text>
                <Text style={styles.optionDetail}>{t("settings.mobile.privacy.streamerModeHelp")}</Text>
              </View>
              <Switch
                accessibilityLabel={t("settings.privacy.streamerMode")}
                value={prefs?.streamerMode === true}
                onValueChange={setStreamerMode}
                disabled={!prefs}
                trackColor={{ true: colors.violet }}
              />
            </View>
            <View style={[styles.card, styles.toggleCard]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{t("settings.privacy.streamPreviews")}</Text>
                <Text style={styles.optionDetail}>{t("settings.privacy.streamPreviewsHelp")}</Text>
              </View>
              <Switch
                accessibilityLabel={t("settings.privacy.streamPreviews")}
                value={prefs?.allowStreamPreviews !== false}
                onValueChange={setStreamPreviews}
                disabled={!prefs}
                trackColor={{ true: colors.violet }}
              />
            </View>

            {dmE2eeAvailable && (
              <>
                <Text style={styles.section}>{t("settings.mobile.privacy.encryptedMessages")}</Text>
                <View style={styles.card}>
                  <DmEncryptionSettings />
                </View>
              </>
            )}

            <Text style={styles.section}>{t("settings.mobile.privacy.blockedAccounts")}</Text>
            {!!blocksError && <Text style={styles.error}>{blocksError}</Text>}
            <View style={[styles.card, { padding: 0, overflow: "hidden" }]}>
              {blocks.length === 0 ? (
                <Text style={styles.empty}>{t("settings.blocked.none")}</Text>
              ) : blocks.map((account, index) => (
                <View key={account.userId} style={[styles.blockRow, index === blocks.length - 1 && styles.blockRowLast]}>
                  <Avatar username={account.username} size={36} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.blockName} numberOfLines={1}>{account.username}</Text>
                    <Text style={styles.blockMeta}>{t("settings.mobile.privacy.blockedOn", { date: new Date(account.createdAt).toLocaleDateString(dateLocale()) })}</Text>
                  </View>
                  <Pressable accessibilityRole="button" accessibilityLabel={t("settings.mobile.privacy.unblockUsername2", { username: account.username })} style={[styles.unblock, unblocking === account.userId && styles.disabled]} disabled={unblocking !== null} onPress={() => unblock(account)}>
                    {unblocking === account.userId ? <ActivityIndicator size="small" color={colors.cyan} /> : <Text style={styles.unblockText}>{t("common.actions.unblock")}</Text>}
                  </Pressable>
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { minHeight: 76, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.bg },
  back: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border },
  kicker: { color: colors.cyan, fontSize: 11, fontWeight: "900", letterSpacing: 1.8 }, title: { color: colors.text, fontSize: 21, fontWeight: "900" },
  scroll: { padding: 14, paddingBottom: 42 },
  section: { color: colors.faint, fontSize: 13, fontWeight: "900", letterSpacing: 1.4, marginTop: 14, marginBottom: 7 },
  card: { padding: 12, borderRadius: 18, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border },
  cardTitle: { color: colors.text, fontSize: 13, fontWeight: "900" },
  toggleCard: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 8 },
  stack: { gap: 7, marginTop: 10 },
  option: { minHeight: 54, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12, backgroundColor: colors.input, borderWidth: 1, borderColor: colors.border },
  optionActive: { backgroundColor: colors.cyanSoft, borderColor: "rgba(95,225,255,.30)" },
  radio: { width: 17, height: 17, borderRadius: 99, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.faint },
  radioActive: { borderColor: colors.cyan }, radioInner: { width: 9, height: 9, borderRadius: 99, backgroundColor: colors.cyan },
  optionTitle: { color: colors.text, fontSize: 12, fontWeight: "900" }, optionTitleActive: { color: colors.cyan }, optionDetail: { color: colors.muted, fontSize: 13, marginTop: 2 },
  segment: { flexDirection: "row", gap: 7, marginTop: 10 },
  segmentButton: { flex: 1, minHeight: 40, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: colors.input, borderWidth: 1, borderColor: colors.border },
  segmentButtonActive: { backgroundColor: colors.cyanSoft, borderColor: "rgba(95,225,255,.34)" },
  segmentText: { color: colors.muted, fontSize: 13, fontWeight: "900" }, segmentTextActive: { color: colors.cyan },
  info: { flexDirection: "row", gap: 9, padding: 12, borderRadius: 16, backgroundColor: colors.cyanSoft, borderWidth: 1, borderColor: "rgba(95,225,255,.18)" }, infoText: { flex: 1, color: colors.muted, fontSize: 13, lineHeight: 18 },
  blockRow: { minHeight: 62, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, blockRowLast: { borderBottomWidth: 0 },
  blockName: { color: colors.text, fontSize: 13, fontWeight: "900" }, blockMeta: { color: colors.muted, fontSize: 12, marginTop: 2 },
  unblock: { minWidth: 82, minHeight: 34, paddingHorizontal: 12, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: colors.cyanSoft, borderWidth: 1, borderColor: "rgba(95,225,255,.24)" },
  unblockText: { color: colors.cyan, fontSize: 12, fontWeight: "900" },
  disabled: { opacity: 0.55 },
  empty: { color: colors.muted, padding: 16, textAlign: "center", fontSize: 13 },
  error: { color: colors.red, fontSize: 12, marginTop: 6, marginBottom: 2 },
});
