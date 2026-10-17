import { useState, useRef, useEffect } from "react";
import Constants from "expo-constants";
import { useSession } from "@/src/providers/SessionProvider";
import {
  Alert,
  Platform,
  PermissionsAndroid,
  View,
  Pressable,
  Text,
  ScrollView,
  Linking,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { useVoice } from "@/src/providers/VoiceProvider";
import { useVoiceSettings } from "@/src/providers/VoiceSettingsProvider";
import { useNotificationSettings, type NotificationSettings, DEFAULT_NOTIFICATION_SETTINGS } from "@/src/providers/NotificationSettingsProvider";
import { useNotifications } from "@/src/providers/NotificationProvider";
import {
  type SyncedClientSettings,
  type QuietHours,
  readQuietHours,
  loadAccountPreferences,
  updateAccountPreferences,
  deviceTimeZone,
  type SyncedNotifications,
  normalizeClockTime,
  type NotifyLevel,
} from "@/src/lib/account-preferences";
import type { Hub } from "@/src/types";
import { apiJson } from "@/src/lib/api";
import { mediaDevices } from "react-native-webrtc";
import { Screen } from "@/src/components/Screen";
import { styles } from "@/src/components/settings/settingsScreen.styles";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/src/theme";
import { Avatar } from "@/src/components/Avatar";
import { MenuSection, SettingsMenuRow, SectionHeading, SettingsCard, StatusHeader, Divider, SettingToggle } from "@/src/components/settings/SettingsParts";
import { LanguagePicker } from "@/src/components/settings/LanguagePicker";
import { ChatPreferences } from "@/src/components/settings/ChatPreferences";
import { MutedPlacesCard } from "@/src/components/settings/MutedPlacesCard";
import { useStreamerMode } from "@/src/hooks/useStreamerMode";
import { isPlatformOwner } from "@/src/lib/admin-api";
import { setAccountPreferencesSnapshot } from "@/src/lib/account-preferences-store";
import { I18N_PICKER_ENABLED } from "../../shared/i18n/flags.ts";
import { useTranslation } from "react-i18next";

export default function SettingsScreen() {
  const { t } = useTranslation(["settings", "common"]);
  const [settingsPage, setSettingsPage] = useState<"menu" | "notifications" | "voice">("menu");
  const { user, token, logout } = useSession();

  const confirmLogout = () => {
    Alert.alert(t("settings.mobile.settings.logOut"), t("settings.mobile.settings.youLlNeedToSign"), [
      { text: t("common.actions.cancel"), style: "cancel" },
      { text: t("common.logout.confirm"), style: "destructive", onPress: () => void logout() },
    ]);
  };
  const {
    voiceStatus,
    voiceChannelId,
    muted,
    deafened,
    toggleMute,
    toggleDeafen,
  } = useVoice();

  const {
    settings,
    updateSettings,
    resetSettings,
  } = useVoiceSettings();

  const {
    settings: notificationSettings,
    updateSettings: updateNotificationSettings,
    resetSettings: resetNotificationSettings,
  } = useNotificationSettings();

  const { permissionState, requestPermission } = useNotifications();

  // Settings synced with the account so phone push follows the same choices as web.
  const [synced, setSynced] = useState<SyncedClientSettings | null>(null);
  const [syncError, setSyncError] = useState("");
  const [quietHours, setQuietHours] = useState<QuietHours>(readQuietHours(null));
  const [quietStart, setQuietStart] = useState(quietHours.start);
  const [quietEnd, setQuietEnd] = useState(quietHours.end);
  const [quietError, setQuietError] = useState("");
  const [hubs, setHubs] = useState<Hub[] | null>(null);
  const streamerMode = useStreamerMode();
  // Admin & Security is listed only for platform owners (the server decides).
  const [platformOwner, setPlatformOwner] = useState(false);
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void isPlatformOwner(token).then((value) => { if (!cancelled) setPlatformOwner(value); });
    return () => { cancelled = true; };
  }, [token]);
  const [hubsError, setHubsError] = useState("");
  const syncedRef = useRef<SyncedClientSettings | null>(null);
  const sessionTokenRef = useRef(token);
  sessionTokenRef.current = token;

  const applySynced = (next: SyncedClientSettings | null | undefined) => {
    const value = next ?? {};
    syncedRef.current = value;
    setSynced(value);
    const quiet = readQuietHours(value);
    setQuietHours(quiet);
    setQuietStart(quiet.start);
    setQuietEnd(quiet.end);
  };

  useEffect(() => {
    syncedRef.current = null;
    setSynced(null);
    setSyncError("");
    if (!token) return;
    const sessionToken = token;
    let active = true;
    loadAccountPreferences(token)
      .then((prefs) => { if (active && sessionTokenRef.current === sessionToken) applySynced(prefs.clientSettings); })
      .catch(() => { if (active) setSyncError(t("settings.mobile.settings.couldnTLoadYourAccount")); });
    return () => { active = false; };
  }, [token]);

  useEffect(() => {
    if (settingsPage !== "notifications" || !token) return;
    let active = true;
    setHubsError("");
    apiJson<Hub[]>("/api/servers", {}, token)
      .then((list) => { if (active) setHubs(Array.isArray(list) ? list : []); })
      .catch((cause) => { if (active) setHubsError(cause instanceof Error ? cause.message : t("settings.mobile.settings.couldNotLoadYourHubs")); });
    return () => { active = false; };
  }, [settingsPage, token]);

  const pushSyncedPatch = async (patch: SyncedClientSettings) => {
    const sessionToken = token;
    if (!sessionToken) return false;
    setSyncError("");
    try {
      const prefs = await updateAccountPreferences(sessionToken, {
        clientSettingsPatch: { ...patch, timeZone: deviceTimeZone() },
      });
      if (sessionTokenRef.current !== sessionToken) return false;
      setAccountPreferencesSnapshot(prefs);
      if (prefs.clientSettings) applySynced(prefs.clientSettings);
      return true;
    } catch {
      if (sessionTokenRef.current !== sessionToken) return false;
      setSyncError(t("settings.mobile.settings.couldnTSyncToYour"));
      return false;
    }
  };

  const syncNotificationChoices = (next: NotificationSettings) => {
    const current = syncedRef.current;
    const existing = current?.notifications ?? {};
    // The account owns both the master push switch and Hub message notices.
    const notifications: SyncedNotifications = {
      enabled: next.enabled,
      dms: next.dms,
      mentions: next.mentions,
      hubMessages: next.hubMessages,
      groups: next.groups,
      sounds: existing.sounds ?? true,
      desktop: existing.desktop ?? true,
      friendRequests: existing.friendRequests ?? true,
      voiceEvents: existing.voiceEvents ?? true,
    };
    void pushSyncedPatch({
      notifications,
      privacy: { ...(current?.privacy ?? {}), notificationPreview: next.notificationPreview },
    });
  };

  const changeNotificationSettings = (patch: Partial<NotificationSettings>) => {
    updateNotificationSettings(patch);
    syncNotificationChoices({ ...notificationSettings, ...patch });
  };

  const resetAndSyncNotificationSettings = () => {
    resetNotificationSettings();
    syncNotificationChoices(DEFAULT_NOTIFICATION_SETTINGS);
  };

  const saveQuietHours = async (next: QuietHours) => {
    const sessionToken = token;
    const previous = quietHours;
    setQuietHours(next);
    const ok = await pushSyncedPatch({ extra: { quietHours: next } });
    if (!ok && sessionToken && sessionTokenRef.current === sessionToken) {
      setQuietHours(previous);
      setQuietStart(previous.start);
      setQuietEnd(previous.end);
    }
  };

  const commitQuietTime = (which: "start" | "end") => {
    const raw = which === "start" ? quietStart : quietEnd;
    const value = normalizeClockTime(raw);
    if (!value) {
      setQuietError(t("settings.mobile.settings.useA24HourTime"));
      if (which === "start") setQuietStart(quietHours.start);
      else setQuietEnd(quietHours.end);
      return;
    }
    setQuietError("");
    if (which === "start") setQuietStart(value);
    else setQuietEnd(value);
    if (value === quietHours[which]) return;
    void saveQuietHours({ ...quietHours, [which]: value });
  };

  const hubLevel = (hubId: number): NotifyLevel =>
    synced?.notifyLevels?.hubs?.[String(hubId)] ?? "mentions";

  const setHubLevel = (hubId: number, level: NotifyLevel) => {
    const sessionToken = token;
    const current = syncedRef.current;
    const hubsMap: Record<string, NotifyLevel> = { ...(current?.notifyLevels?.hubs ?? {}) };
    if (level === "mentions") delete hubsMap[String(hubId)];
    else hubsMap[String(hubId)] = level;
    const notifyLevels = { hubs: hubsMap, rooms: { ...(current?.notifyLevels?.rooms ?? {}) } };
    applySynced({ ...(current ?? {}), notifyLevels });
    void pushSyncedPatch({ notifyLevels }).then((ok) => {
      if (!ok && current && sessionToken && sessionTokenRef.current === sessionToken) applySynced(current);
    });
  };

  const [micChecking, setMicChecking] = useState(false);
  const [micNotice, setMicNotice] = useState("");

  const checkMicrophone = async () => {
    if (micChecking) return;

    setMicChecking(true);
    setMicNotice("");

    try {
      if (Platform.OS === "android") {
        const result = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          {
            title: t("settings.mobile.settings.decaveMicrophoneAccess"),
            message:
              t("settings.mobile.settings.decaveNeedsYourMicrophoneSo"),
            buttonPositive: t("settings.mobile.settings.allow"),
            buttonNegative: t("settings.mobile.settings.notNow"),
          },
        );

        if (result !== PermissionsAndroid.RESULTS.GRANTED) {
          setMicNotice(t("settings.mobile.settings.microphonePermissionIsNotEnabled"));
          return;
        }
      }

      const stream = await mediaDevices.getUserMedia({
        audio: {
          echoCancellation: settings.echoCancellation,
          noiseSuppression: settings.noiseSuppression,
          autoGainControl: settings.autoGainControl,
        } as any,
        video: false,
      });

      for (const track of stream.getTracks()) track.stop();
      setMicNotice(t("settings.mobile.settings.microphoneIsReady"));
    } catch {
      setMicNotice(t("settings.mobile.settings.decaveCouldNotOpenThe"));
    } finally {
      setMicChecking(false);
    }
  };

  const connected =
    voiceStatus === "connected" && voiceChannelId !== null;

  if (settingsPage === "menu") {
    return (
      <Screen>
        <View style={styles.top}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("common.actions.back")} style={styles.backButton} onPress={() => router.back()} hitSlop={8}>
            <Ionicons name="chevron-back" size={22} color={colors.cyan} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text maxFontSizeMultiplier={1.3} style={styles.kicker}>{t("settings.mobile.settings.decaveControlCenter")}</Text>
            <Text style={styles.title}>{t("settings.window.title")}</Text>
          </View>
          <View style={styles.topIcon}>
            <Ionicons name="settings-outline" size={19} color={colors.violet} />
          </View>
        </View>

        <ScrollView keyboardDismissMode="on-drag" contentContainerStyle={styles.menuScroll} showsVerticalScrollIndicator={false}>
          <Pressable
            style={({ pressed }) => [styles.accountCard, pressed && styles.menuRowPressed]}
            onPress={() => router.push("/account-security" as any)}
            accessibilityRole="button"
            accessibilityLabel={t("settings.mobile.settings.accountAndSecurity")}
          >
            <View style={styles.accountRing}>
              <Avatar username={user?.username ?? "?"} avatarUrl={user?.avatarUrl} size={44} />
            </View>
            <View style={styles.menuRowCopy}>
              <Text maxFontSizeMultiplier={1.3} style={styles.accountName} numberOfLines={1}>{user?.username ?? t("settings.mobile.settings.yourAccount")}</Text>
              <Text style={styles.menuRowDetail} numberOfLines={1}>{streamerMode ? t("settings.account.hiddenByStreamerMode") : (user?.email ?? t("settings.mobile.settings.accountEmailPassword"))}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.lilac} />
          </Pressable>

          <MenuSection title={t("settings.mobile.settings.accountSettings")}>
            <SettingsMenuRow icon="person-circle-outline" tint="#A78BFA" title={t("settings.mobile.settings.accountSecurity")} detail={t("settings.mobile.settings.passwordAccountAccessDisableOr")} onPress={() => router.push("/account-security" as any)} />
            <SettingsMenuRow icon="color-palette-outline" tint="#F472B6" title={t("settings.mobile.settings.appearance")} detail={t("settings.mobile.settings.themeSkinAndVisualPreferences")} onPress={() => router.push("/appearance" as any)} />
            <SettingsMenuRow icon="desktop-outline" tint="#67E8F9" title={t("settings.mobile.settings.devicesSessions")} detail={t("settings.mobile.settings.reviewAndLogOutActive")} onPress={() => router.push("/devices" as any)} />
            <SettingsMenuRow icon="link-outline" tint="#818CF8" title={t("settings.connections.title")} detail={t("settings.mobile.connections.detail")} onPress={() => router.push("/connections" as any)} />
            <SettingsMenuRow icon="hand-left-outline" tint="#FB923C" title={t("settings.mobile.settings.privacySafety")} detail={t("settings.mobile.settings.friendRequestsActivityAndBlocked")} onPress={() => router.push("/privacy" as any)} />
            <SettingsMenuRow icon="shield-checkmark-outline" tint="#34D399" title={t("settings.mobile.settings.myReports")} detail={t("settings.mobile.settings.trackReportsAndSafetyCases")} onPress={() => router.push("/my-reports" as any)} />
            <SettingsMenuRow icon="qr-code-outline" tint="#FBBF24" title={t("settings.mobile.settings.scanQrCode")} detail={t("settings.mobile.settings.signInToDecaveOn")} onPress={() => router.push("/scan-login" as any)} last={!platformOwner} />
            {platformOwner && <SettingsMenuRow icon="shield-half-outline" tint="#F87171" title={t("common.admin.title")} detail={t("common.admin.lead")} onPress={() => router.push("/admin" as any)} last />}
          </MenuSection>

          <MenuSection title={t("settings.mobile.settings.appSettings")}>
            <SettingsMenuRow icon="headset-outline" tint="#A78BFA" title={t("settings.mobile.settings.voiceAudio")} detail={t("settings.mobile.settings.microphoneProcessingAndScreenShare")} value={connected ? t("common.connection.connected") : undefined} onPress={() => setSettingsPage("voice")} />
            <SettingsMenuRow icon="notifications-outline" tint="#F472B6" title={t("settings.mobile.settings.notificationsPrivacy")} detail={t("settings.mobile.settings.alertsSoundsMentionsAndPreview")} value={notificationSettings.enabled ? t("settings.mobile.settings.on") : t("settings.voice.noise.modes.off.label")} onPress={() => setSettingsPage("notifications")} last />
          </MenuSection>

          {I18N_PICKER_ENABLED && <LanguagePicker />}

          <ChatPreferences />

          <MenuSection title={t("settings.mobile.settings.support")}>
            <SettingsMenuRow icon="help-circle-outline" tint="#67E8F9" title={t("settings.mobile.settings.helpFeedback")} detail={t("settings.mobile.settings.contactDecaveSupport")} onPress={() => void Linking.openURL("mailto:support@de-cave.com?subject=DeCave%20mobile%20support")} />
            <SettingsMenuRow icon="document-lock-outline" tint="#34D399" title={t("settings.support.privacy")} detail={t("settings.mobile.settings.whatDecaveCollectsAndHow")} onPress={() => void Linking.openURL("https://de-cave.com/privacy")} />
            <SettingsMenuRow icon="document-text-outline" tint="#FBBF24" title={t("settings.support.terms")} detail={t("settings.mobile.settings.theRulesForUsingDecave")} onPress={() => void Linking.openURL("https://de-cave.com/terms")} />
            <SettingsMenuRow icon="information-circle-outline" tint="#A29DB2" title={t("settings.mobile.settings.aboutDecave")} detail={t("settings.mobile.settings.mobileAppAndServiceInformation")} value={Constants.expoConfig?.version} last />
          </MenuSection>

          <Pressable
            style={({ pressed }) => [styles.logoutButton, pressed && styles.menuRowPressed]}
            onPress={confirmLogout}
            accessibilityRole="button"
          >
            <Ionicons name="log-out-outline" size={18} color="#FCA5A5" />
            <Text style={styles.logoutText}>{t("common.logout.confirm")}</Text>
          </Pressable>
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.top}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("common.actions.back")}
          style={styles.backButton}
          onPress={() => setSettingsPage("menu")}
          hitSlop={8}
        >
          <Ionicons
            name="chevron-back"
            size={22}
            color={colors.cyan}
          />
        </Pressable>

        <View style={{ flex: 1 }}>
          <Text maxFontSizeMultiplier={1.3} style={styles.kicker}>{t("settings.mobile.settings.appSettings")}</Text>
          <Text style={styles.title}>{settingsPage === "voice" ? t("settings.mobile.settings.voiceAudio") : t("settings.mobile.settings.notificationsPrivacy")}</Text>
        </View>

        <View style={styles.topIcon}>
          <Ionicons
            name={settingsPage === "voice" ? "headset-outline" : "notifications-outline"}
            size={19}
            color={colors.violet}
          />
        </View>
      </View>

      <ScrollView keyboardDismissMode="on-drag"
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.introCard}>
          <View style={styles.introIcon}>
            <Ionicons
              name="shield-checkmark-outline"
              size={23}
              color={colors.cyan}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.introTitle}>
              {settingsPage === "voice" ? t("settings.mobile.settings.clearComfortableVoice") : t("settings.mobile.settings.alertsWithoutOversharing")}
            </Text>
            <Text style={styles.introText}>
              {settingsPage === "voice"
                ? t("settings.mobile.settings.tuneMicrophoneProcessingAndHow")
                : t("settings.mobile.settings.chooseWhatCanNotifyYou")}
            </Text>
          </View>
        </View>

        <View style={settingsPage !== "notifications" ? styles.hidden : undefined}>
        <SectionHeading
          icon="notifications-outline"
          title={t("settings.mobile.settings.privacyNotifications")}
        />

        <SettingsCard>
          <StatusHeader
            icon="notifications-outline"
            title={t("settings.mobile.settings.deviceNotifications")}
            detail={t("settings.mobile.settings.controlMessageAlertsShownBy")}
            status={
              permissionState === "checking"
                ? t("settings.mobile.settings.checking")
                : permissionState === "granted"
                  ? t("settings.mobile.settings.allowed")
                  : t("settings.mobile.settings.blocked")
            }
            live={permissionState === "granted"}
          />

          {permissionState !== "granted" && (
            <Pressable accessibilityRole="button"
              style={styles.primarySecondaryButton}
              onPress={() => void requestPermission()}
            >
              <Ionicons
                name="notifications-outline"
                size={16}
                color={colors.cyan}
              />
              <Text style={styles.primarySecondaryButtonText}>
                {t("settings.mobile.settings.enableNotifications")}
              </Text>
            </Pressable>
          )}

          <Divider />

          <SettingToggle
            icon="notifications"
            title={t("settings.notifications.title")}
            detail={t("settings.mobile.settings.masterSwitchForDecaveMessage")}
            value={notificationSettings.enabled}
            onValueChange={(value) =>
              changeNotificationSettings({ enabled: value })
            }
          />
          <SettingToggle
            icon="volume-medium-outline"
            title={t("settings.mobile.settings.notificationSounds")}
            detail={t("settings.mobile.settings.playASoundWhenDecave")}
            value={notificationSettings.sound}
            onValueChange={(value) =>
              changeNotificationSettings({ sound: value })
            }
          />
          <SettingToggle
            icon="chatbubble-outline"
            title={t("settings.notifications.kinds.dms")}
            detail={t("settings.mobile.settings.notifyWhenAFriendSends")}
            value={notificationSettings.dms}
            onValueChange={(value) =>
              changeNotificationSettings({ dms: value })
            }
          />
          <SettingToggle
            icon="people-outline"
            title={t("settings.mobile.settings.groupChats")}
            detail={t("settings.mobile.settings.notifyWhenSomebodyPostsIn")}
            value={notificationSettings.groups}
            onValueChange={(value) =>
              changeNotificationSettings({ groups: value })
            }
          />
          <SettingToggle
            icon="grid-outline"
            title={t("settings.mobile.settings.hubMessages")}
            detail={t("settings.mobile.settings.notifyForHubTextMessages")}
            value={notificationSettings.hubMessages}
            onValueChange={(value) =>
              changeNotificationSettings({ hubMessages: value })
            }
          />
          <SettingToggle
            icon="at-outline"
            title={t("settings.notifications.kinds.mentions")}
            detail={t("settings.mobile.settings.notifyForYournameAndEveryone")}
            value={notificationSettings.mentions}
            onValueChange={(value) =>
              changeNotificationSettings({ mentions: value })
            }
          />

          <View style={styles.choiceBlock}>
            <View style={styles.choiceHeading}>
              <Ionicons
                name="eye-outline"
                size={17}
                color={colors.cyan}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.choiceTitle}>
                  {t("settings.mobile.settings.notificationPreview")}
                </Text>
                <Text style={styles.choiceHelp}>
                  {t("settings.mobile.settings.chooseHowMuchPrivateContent")}
                </Text>
              </View>
            </View>

            <View style={styles.previewStack}>
              {([
                ["full", t("settings.notifications.previews.full.label"), t("settings.mobile.settings.senderMessageText")],
                ["sender", t("settings.notifications.previews.sender.label"), t("settings.mobile.settings.hideTheMessageText")],
                ["hidden", t("settings.notifications.previews.hidden.label"), t("settings.mobile.settings.genericDecaveAlertOnly")],
              ] as const).map(([value, label, detail]) => {
                const active =
                  notificationSettings.notificationPreview === value;

                return (
                  <Pressable accessibilityRole="button"
                    key={value}
                    style={[
                      styles.previewButton,
                      active && styles.previewButtonActive,
                    ]}
                    onPress={() =>
                      changeNotificationSettings({
                        notificationPreview: value,
                      })
                    }
                  >
                    <View
                      style={[
                        styles.radio,
                        active && styles.radioActive,
                      ]}
                    >
                      {active && <View style={styles.radioInner} />}
                    </View>

                    <View style={{ flex: 1 }}>
                      <Text
                        style={[
                          styles.previewButtonTitle,
                          active &&
                            styles.previewButtonTitleActive,
                        ]}
                      >
                        {label}
                      </Text>
                      <Text style={styles.previewButtonDetail}>
                        {detail}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <Pressable accessibilityRole="button"
            style={styles.resetButton}
            onPress={resetAndSyncNotificationSettings}
          >
            <Ionicons
              name="refresh-outline"
              size={15}
              color={colors.muted}
            />
            <Text style={styles.resetButtonText}>
              {t("settings.mobile.settings.resetNotificationSettings")}
            </Text>
          </Pressable>
          {!!syncError && <Text style={styles.syncError}>{syncError}</Text>}
        </SettingsCard>

        <SectionHeading icon="moon-outline" title={t("settings.mobile.settings.quietHours")} />
        <SettingsCard>
          <SettingToggle
            icon="moon-outline"
            title={t("settings.anchors.quietHours.label")}
            detail={t("settings.mobile.settings.silenceNotificationsOnAllYour")}
            value={quietHours.enabled}
            onValueChange={(value) => void saveQuietHours({ ...quietHours, enabled: value })}
          />
          <View style={[styles.timeRow, !quietHours.enabled && styles.buttonDisabled]}>
            <View style={styles.timeField}>
              <Text style={styles.timeLabel}>{t("settings.notifications.quiet.from")}</Text>
              <TextInput
                value={quietStart}
                onChangeText={(value) => setQuietStart(value.replace(/[^0-9:]/g, "").slice(0, 5))}
                onEndEditing={() => commitQuietTime("start")}
                editable={quietHours.enabled}
                placeholder="22:00"
                placeholderTextColor={colors.faint}
                keyboardType="numbers-and-punctuation"
                returnKeyType="done"
                maxLength={5}
                style={styles.timeInput}
                accessibilityLabel={t("settings.mobile.settings.quietHoursStartTime")}
              />
            </View>
            <View style={styles.timeField}>
              <Text style={styles.timeLabel}>{t("settings.notifications.quiet.until")}</Text>
              <TextInput
                value={quietEnd}
                onChangeText={(value) => setQuietEnd(value.replace(/[^0-9:]/g, "").slice(0, 5))}
                onEndEditing={() => commitQuietTime("end")}
                editable={quietHours.enabled}
                placeholder="08:00"
                placeholderTextColor={colors.faint}
                keyboardType="numbers-and-punctuation"
                returnKeyType="done"
                maxLength={5}
                style={styles.timeInput}
                accessibilityLabel={t("settings.mobile.settings.quietHoursEndTime")}
              />
            </View>
          </View>
          <Text style={styles.timeHint}>{t("settings.mobile.settings.use24HourTimeTimes")}</Text>
          {!!quietError && <Text style={styles.syncError}>{quietError}</Text>}
          <SettingToggle
            icon="at-outline"
            title={t("settings.notifications.quiet.allowMentions")}
            detail={t("settings.mobile.settings.importantMessagesStillComeThrough")}
            value={quietHours.allowMentions}
            onValueChange={(value) => void saveQuietHours({ ...quietHours, allowMentions: value })}
          />
        </SettingsCard>

        <MutedPlacesCard
          hubs={hubs}
          settings={synced}
          onPatch={(patch) => {
            const sessionToken = token;
            const current = syncedRef.current;
            applySynced({ ...(current ?? {}), ...patch });
            void pushSyncedPatch(patch).then((ok) => {
              if (!ok && current && sessionToken && sessionTokenRef.current === sessionToken) applySynced(current);
            });
          }}
        />

        <SectionHeading icon="grid-outline" title={t("settings.mobile.settings.hubs")} />
        <SettingsCard>
          <Text style={styles.choiceHelp}>{t("settings.mobile.settings.chooseWhatEachHubCan")}</Text>
          {hubs === null && !hubsError && <ActivityIndicator color={colors.cyan} style={{ marginTop: 12 }} />}
          {!!hubsError && <Text style={styles.syncError}>{hubsError}</Text>}
          {hubs !== null && hubs.length === 0 && <Text style={[styles.choiceHelp, { marginTop: 10 }]}>{t("settings.mobile.settings.youHavenTJoinedAny")}</Text>}
          {hubs?.map((hub) => {
            const level = hubLevel(hub.id);
            return (
              <View key={hub.id} style={styles.hubRow}>
                <Text style={styles.hubName} numberOfLines={1}>{hub.name}</Text>
                <View style={styles.qualityRow}>
                  {([
                    ["all", t("settings.notifications.levels.all")],
                    ["mentions", t("settings.notifications.presets.mentions")],
                    ["nothing", t("settings.notifications.levels.nothing")],
                  ] as const).map(([value, label]) => {
                    const active = level === value;
                    return (
                      <Pressable
                        key={value}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: active }}
                        accessibilityLabel={`${hub.name}: ${label}`}
                        style={[styles.qualityButton, active && styles.qualityButtonActive]}
                        onPress={() => { if (!active) setHubLevel(hub.id, value); }}
                      >
                        <Text style={[styles.qualityButtonText, active && styles.qualityButtonTextActive]} numberOfLines={1}>{label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            );
          })}
        </SettingsCard>
        </View>

        <View style={settingsPage !== "voice" ? styles.hidden : undefined}>
        <SectionHeading
          icon="headset-outline"
          title={t("settings.mobile.settings.voiceAudio2")}
        />

        <SettingsCard>
          <StatusHeader
            icon="headset-outline"
            title={t("settings.mobile.settings.voiceConnection")}
            detail={
              connected
                ? t("settings.mobile.settings.connectedToAVoiceRoom")
                : t("settings.mobile.settings.notConnectedToAVoice")
            }
            status={connected ? t("settings.gaming.live") : t("settings.mobile.settings.offline")}
            live={connected}
          />

          {connected && (
            <View style={styles.voiceActions}>
              <Pressable accessibilityRole="button"
                style={[
                  styles.voiceAction,
                  muted && styles.voiceActionActive,
                ]}
                onPress={toggleMute}
              >
                <Ionicons
                  name={muted ? "mic-off-outline" : "mic-outline"}
                  size={18}
                  color={muted ? colors.red : colors.text}
                />
                <Text
                  style={[
                    styles.voiceActionText,
                    muted && styles.voiceActionTextActive,
                  ]}
                >
                  {muted ? t("settings.notifications.events.unmute.label") : t("settings.notifications.events.mute.label")}
                </Text>
              </Pressable>

              <Pressable accessibilityRole="button"
                style={[
                  styles.voiceAction,
                  deafened && styles.voiceActionActive,
                ]}
                onPress={toggleDeafen}
              >
                <Ionicons
                  name={
                    deafened
                      ? "volume-mute-outline"
                      : "headset-outline"
                  }
                  size={18}
                  color={deafened ? colors.red : colors.text}
                />
                <Text
                  style={[
                    styles.voiceActionText,
                    deafened && styles.voiceActionTextActive,
                  ]}
                >
                  {deafened ? t("settings.notifications.events.undeafen.label") : t("settings.notifications.events.deafen.label")}
                </Text>
              </Pressable>
            </View>
          )}

          <Divider />

          <SettingToggle
            icon="sparkles-outline"
            title={t("settings.anchors.noiseSuppression.label")}
            detail={t("settings.mobile.settings.reduceSteadyBackgroundNoiseBefore")}
            value={settings.noiseSuppression}
            onValueChange={(value) =>
              updateSettings({ noiseSuppression: value })
            }
          />
          <SettingToggle
            icon="repeat-outline"
            title={t("settings.voice.processing.echo")}
            detail={t("settings.mobile.settings.reduceSpeakerEchoFeedingBack")}
            value={settings.echoCancellation}
            onValueChange={(value) =>
              updateSettings({ echoCancellation: value })
            }
          />
          <SettingToggle
            icon="pulse-outline"
            title={t("settings.voice.processing.gain")}
            detail={t("settings.mobile.settings.letWebrtcAutomaticallyBalanceMicrophone")}
            value={settings.autoGainControl}
            onValueChange={(value) =>
              updateSettings({ autoGainControl: value })
            }
          />
          <SettingToggle
            icon="hand-left-outline"
            title={t("settings.voice.mode.pushToTalk")}
            detail={t("settings.mobile.voice.pushToTalkHelp")}
            value={settings.pushToTalk}
            onValueChange={(value) => updateSettings({ pushToTalk: value })}
          />
          <SettingToggle
            icon="mic-off-outline"
            title={t("settings.mobile.settings.joinVoiceMuted")}
            detail={t("settings.mobile.settings.startEveryNewVoiceRoom")}
            value={settings.joinMuted}
            onValueChange={(value) =>
              updateSettings({ joinMuted: value })
            }
          />

          <View style={styles.choiceBlock}>
            <View style={styles.choiceHeading}>
              <Ionicons
                name="desktop-outline"
                size={17}
                color={colors.cyan}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.choiceTitle}>
                  {t("settings.mobile.settings.screenShareQuality")}
                </Text>
                <Text style={styles.choiceHelp}>
                  {t("settings.mobile.settings.resolutionRequestedWhenYouStart")}
                </Text>
              </View>
            </View>

            <View style={styles.qualityRow}>
              {([
                ["dataSaver", t("settings.mobile.settings.quality.saver")],
                ["balanced", t("settings.mobile.settings.quality.balanced")],
                ["full", t("settings.mobile.settings.quality.full")],
              ] as const).map(([value, label]) => {
                const active =
                  settings.screenShareQuality === value;

                return (
                  <Pressable accessibilityRole="button"
                    key={value}
                    style={[
                      styles.qualityButton,
                      active && styles.qualityButtonActive,
                    ]}
                    onPress={() =>
                      updateSettings({
                        screenShareQuality: value,
                      })
                    }
                  >
                    <Text
                      style={[
                        styles.qualityButtonText,
                        active &&
                          styles.qualityButtonTextActive,
                      ]}
                    >
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.restartHint}>
            <Ionicons
              name="information-circle-outline"
              size={15}
              color={colors.cyan}
            />
            <Text style={styles.restartHintText}>
              {t("settings.mobile.settings.captureProcessingChangesApplyNext")}
            </Text>
          </View>

          <Pressable accessibilityRole="button"
            style={[
              styles.micCheck,
              micChecking && styles.buttonDisabled,
            ]}
            onPress={() => void checkMicrophone()}
            disabled={micChecking}
          >
            {micChecking ? (
              <ActivityIndicator color={colors.cyan} size="small" />
            ) : (
              <Ionicons
                name="mic-outline"
                size={17}
                color={colors.cyan}
              />
            )}
            <Text style={styles.micCheckText}>
              {micChecking ? t("settings.mobile.settings.checkingMicrophone") : t("settings.mobile.settings.checkMicrophone")}
            </Text>
          </Pressable>

          {!!micNotice && (
            <View
              style={[
                styles.micNotice,
                micNotice === t("settings.mobile.settings.microphoneIsReady") &&
                  styles.micNoticeSuccess,
              ]}
            >
              <Ionicons
                name={
                  micNotice === t("settings.mobile.settings.microphoneIsReady")
                    ? "checkmark-circle-outline"
                    : "alert-circle-outline"
                }
                size={15}
                color={
                  micNotice === t("settings.mobile.settings.microphoneIsReady")
                    ? colors.green
                    : colors.yellow
                }
              />
              <Text
                style={[
                  styles.micNoticeText,
                  micNotice === t("settings.mobile.settings.microphoneIsReady") &&
                    styles.micNoticeTextSuccess,
                ]}
              >
                {micNotice}
              </Text>
            </View>
          )}

          <Pressable accessibilityRole="button"
            style={styles.resetButton}
            onPress={resetSettings}
          >
            <Ionicons
              name="refresh-outline"
              size={15}
              color={colors.muted}
            />
            <Text style={styles.resetButtonText}>
              {t("settings.mobile.settings.resetVoiceSettings")}
            </Text>
          </Pressable>
        </SettingsCard>
        </View>
      </ScrollView>
    </Screen>
  );
}
