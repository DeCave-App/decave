import { useState, useRef, useEffect } from "react";
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

export default function SettingsScreen() {
  const [settingsPage, setSettingsPage] = useState<"menu" | "notifications" | "voice">("menu");
  const { user, token, logout } = useSession();

  const confirmLogout = () => {
    Alert.alert("Log out?", "You'll need to sign in again on this device.", [
      { text: "Cancel", style: "cancel" },
      { text: "Log out", style: "destructive", onPress: () => void logout() },
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
      .catch(() => { if (active) setSyncError("Couldn't load your account settings. Changes are saved on this phone."); });
    return () => { active = false; };
  }, [token]);

  useEffect(() => {
    if (settingsPage !== "notifications" || !token) return;
    let active = true;
    setHubsError("");
    apiJson<Hub[]>("/api/servers", {}, token)
      .then((list) => { if (active) setHubs(Array.isArray(list) ? list : []); })
      .catch((cause) => { if (active) setHubsError(cause instanceof Error ? cause.message : "Could not load your Hubs."); });
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
      if (prefs.clientSettings) applySynced(prefs.clientSettings);
      return true;
    } catch {
      if (sessionTokenRef.current !== sessionToken) return false;
      setSyncError("Couldn't sync to your account. Your choices are saved on this phone.");
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
      setQuietError("Use a 24-hour time like 22:00.");
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
            title: "DeCave microphone access",
            message:
              "DeCave needs your microphone so you can talk in voice rooms.",
            buttonPositive: "Allow",
            buttonNegative: "Not now",
          },
        );

        if (result !== PermissionsAndroid.RESULTS.GRANTED) {
          setMicNotice("Microphone permission is not enabled.");
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
      setMicNotice("Microphone is ready.");
    } catch {
      setMicNotice("DeCave could not open the microphone.");
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
          <Pressable accessibilityRole="button" accessibilityLabel="Back" style={styles.backButton} onPress={() => router.back()} hitSlop={8}>
            <Ionicons name="chevron-back" size={22} color={colors.cyan} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text maxFontSizeMultiplier={1.3} style={styles.kicker}>DECAVE CONTROL CENTER</Text>
            <Text style={styles.title}>Settings</Text>
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
            accessibilityLabel="Account and security"
          >
            <View style={styles.accountRing}>
              <Avatar username={user?.username ?? "?"} avatarUrl={user?.avatarUrl} size={44} />
            </View>
            <View style={styles.menuRowCopy}>
              <Text maxFontSizeMultiplier={1.3} style={styles.accountName} numberOfLines={1}>{user?.username ?? "Your account"}</Text>
              <Text style={styles.menuRowDetail} numberOfLines={1}>{user?.email ?? "Account, email, password"}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.lilac} />
          </Pressable>

          <MenuSection title="ACCOUNT SETTINGS">
            <SettingsMenuRow icon="person-circle-outline" tint="#A78BFA" title="Account & Security" detail="Password, account access, disable or delete" onPress={() => router.push("/account-security" as any)} />
            <SettingsMenuRow icon="color-palette-outline" tint="#F472B6" title="Appearance" detail="Theme, skin, and visual preferences" onPress={() => router.push("/appearance" as any)} />
            <SettingsMenuRow icon="desktop-outline" tint="#67E8F9" title="Devices & Sessions" detail="Review and log out active devices" onPress={() => router.push("/devices" as any)} />
            <SettingsMenuRow icon="hand-left-outline" tint="#FB923C" title="Privacy & Safety" detail="Friend requests, activity and blocked accounts" onPress={() => router.push("/privacy" as any)} />
            <SettingsMenuRow icon="shield-checkmark-outline" tint="#34D399" title="My Reports" detail="Track reports and safety cases you submitted" onPress={() => router.push("/my-reports" as any)} />
            <SettingsMenuRow icon="qr-code-outline" tint="#FBBF24" title="Scan QR Code" detail="Sign in to DeCave on web or desktop" onPress={() => router.push("/scan-login" as any)} last />
          </MenuSection>

          <MenuSection title="APP SETTINGS">
            <SettingsMenuRow icon="headset-outline" tint="#A78BFA" title="Voice & Audio" detail="Microphone processing and screen share quality" value={connected ? "Connected" : undefined} onPress={() => setSettingsPage("voice")} />
            <SettingsMenuRow icon="notifications-outline" tint="#F472B6" title="Notifications & Privacy" detail="Alerts, sounds, mentions, and preview privacy" value={notificationSettings.enabled ? "On" : "Off"} onPress={() => setSettingsPage("notifications")} last />
          </MenuSection>

          <MenuSection title="SUPPORT">
            <SettingsMenuRow icon="help-circle-outline" tint="#67E8F9" title="Help & Feedback" detail="Contact DeCave support" onPress={() => void Linking.openURL("mailto:support@de-cave.com?subject=DeCave%20mobile%20support")} />
            <SettingsMenuRow icon="document-lock-outline" tint="#34D399" title="Privacy Policy" detail="What DeCave collects and how it is used" onPress={() => void Linking.openURL("https://de-cave.com/privacy")} />
            <SettingsMenuRow icon="document-text-outline" tint="#FBBF24" title="Terms of Service" detail="The rules for using DeCave" onPress={() => void Linking.openURL("https://de-cave.com/terms")} />
            <SettingsMenuRow icon="information-circle-outline" tint="#A29DB2" title="About DeCave" detail="Mobile app and service information" value="0.1.0" last />
          </MenuSection>

          <Pressable
            style={({ pressed }) => [styles.logoutButton, pressed && styles.menuRowPressed]}
            onPress={confirmLogout}
            accessibilityRole="button"
          >
            <Ionicons name="log-out-outline" size={18} color="#FCA5A5" />
            <Text style={styles.logoutText}>Log out</Text>
          </Pressable>
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.top}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back"
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
          <Text maxFontSizeMultiplier={1.3} style={styles.kicker}>APP SETTINGS</Text>
          <Text style={styles.title}>{settingsPage === "voice" ? "Voice & Audio" : "Notifications & Privacy"}</Text>
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
              {settingsPage === "voice" ? "Clear, comfortable voice" : "Alerts without oversharing"}
            </Text>
            <Text style={styles.introText}>
              {settingsPage === "voice"
                ? "Tune microphone processing and how calls behave on this device."
                : "Choose what can notify you and how much message content appears outside DeCave."}
            </Text>
          </View>
        </View>

        <View style={settingsPage !== "notifications" ? styles.hidden : undefined}>
        <SectionHeading
          icon="notifications-outline"
          title="PRIVACY & NOTIFICATIONS"
        />

        <SettingsCard>
          <StatusHeader
            icon="notifications-outline"
            title="Device notifications"
            detail="Control message alerts shown by this device."
            status={
              permissionState === "checking"
                ? "CHECKING"
                : permissionState === "granted"
                  ? "ALLOWED"
                  : "BLOCKED"
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
                Enable notifications
              </Text>
            </Pressable>
          )}

          <Divider />

          <SettingToggle
            icon="notifications"
            title="Notifications"
            detail="Master switch for DeCave message notifications."
            value={notificationSettings.enabled}
            onValueChange={(value) =>
              changeNotificationSettings({ enabled: value })
            }
          />
          <SettingToggle
            icon="volume-medium-outline"
            title="Notification sounds"
            detail="Play a sound when DeCave presents a message alert."
            value={notificationSettings.sound}
            onValueChange={(value) =>
              changeNotificationSettings({ sound: value })
            }
          />
          <SettingToggle
            icon="chatbubble-outline"
            title="Private messages"
            detail="Notify when a friend sends you a direct message."
            value={notificationSettings.dms}
            onValueChange={(value) =>
              changeNotificationSettings({ dms: value })
            }
          />
          <SettingToggle
            icon="people-outline"
            title="Group chats"
            detail="Notify when somebody posts in one of your group chats."
            value={notificationSettings.groups}
            onValueChange={(value) =>
              changeNotificationSettings({ groups: value })
            }
          />
          <SettingToggle
            icon="grid-outline"
            title="Hub messages"
            detail="Notify for Hub text messages while that room is not open."
            value={notificationSettings.hubMessages}
            onValueChange={(value) =>
              changeNotificationSettings({ hubMessages: value })
            }
          />
          <SettingToggle
            icon="at-outline"
            title="Mentions"
            detail="Notify for @yourname and @everyone mentions."
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
                  Notification preview
                </Text>
                <Text style={styles.choiceHelp}>
                  Choose how much private content can appear outside DeCave.
                </Text>
              </View>
            </View>

            <View style={styles.previewStack}>
              {([
                ["full", "Full preview", "Sender + message text"],
                ["sender", "Sender only", "Hide the message text"],
                ["hidden", "Hidden", "Generic DeCave alert only"],
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
              Reset notification settings
            </Text>
          </Pressable>
          {!!syncError && <Text style={styles.syncError}>{syncError}</Text>}
        </SettingsCard>

        <SectionHeading icon="moon-outline" title="QUIET HOURS" />
        <SettingsCard>
          <SettingToggle
            icon="moon-outline"
            title="Quiet hours"
            detail="Silence notifications on all your devices at night."
            value={quietHours.enabled}
            onValueChange={(value) => void saveQuietHours({ ...quietHours, enabled: value })}
          />
          <View style={[styles.timeRow, !quietHours.enabled && styles.buttonDisabled]}>
            <View style={styles.timeField}>
              <Text style={styles.timeLabel}>From</Text>
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
                accessibilityLabel="Quiet hours start time"
              />
            </View>
            <View style={styles.timeField}>
              <Text style={styles.timeLabel}>Until</Text>
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
                accessibilityLabel="Quiet hours end time"
              />
            </View>
          </View>
          <Text style={styles.timeHint}>Use 24-hour time. Times follow this phone's time zone.</Text>
          {!!quietError && <Text style={styles.syncError}>{quietError}</Text>}
          <SettingToggle
            icon="at-outline"
            title="Still notify me about direct messages and mentions"
            detail="Important messages still come through during quiet hours."
            value={quietHours.allowMentions}
            onValueChange={(value) => void saveQuietHours({ ...quietHours, allowMentions: value })}
          />
        </SettingsCard>

        <SectionHeading icon="grid-outline" title="HUBS" />
        <SettingsCard>
          <Text style={styles.choiceHelp}>Choose what each Hub can notify you about. Mentions only is the default.</Text>
          {hubs === null && !hubsError && <ActivityIndicator color={colors.cyan} style={{ marginTop: 12 }} />}
          {!!hubsError && <Text style={styles.syncError}>{hubsError}</Text>}
          {hubs !== null && hubs.length === 0 && <Text style={[styles.choiceHelp, { marginTop: 10 }]}>You haven't joined any Hubs yet.</Text>}
          {hubs?.map((hub) => {
            const level = hubLevel(hub.id);
            return (
              <View key={hub.id} style={styles.hubRow}>
                <Text style={styles.hubName} numberOfLines={1}>{hub.name}</Text>
                <View style={styles.qualityRow}>
                  {([
                    ["all", "All messages"],
                    ["mentions", "Mentions only"],
                    ["nothing", "Nothing"],
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
          title="VOICE & AUDIO"
        />

        <SettingsCard>
          <StatusHeader
            icon="headset-outline"
            title="Voice connection"
            detail={
              connected
                ? "Connected to a Voice Room."
                : "Not connected to a Voice Room."
            }
            status={connected ? "LIVE" : "OFFLINE"}
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
                  {muted ? "Unmute" : "Mute"}
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
                  {deafened ? "Undeafen" : "Deafen"}
                </Text>
              </Pressable>
            </View>
          )}

          <Divider />

          <SettingToggle
            icon="sparkles-outline"
            title="Noise suppression"
            detail="Reduce steady background noise before your voice is sent."
            value={settings.noiseSuppression}
            onValueChange={(value) =>
              updateSettings({ noiseSuppression: value })
            }
          />
          <SettingToggle
            icon="repeat-outline"
            title="Echo cancellation"
            detail="Reduce speaker echo feeding back into your microphone."
            value={settings.echoCancellation}
            onValueChange={(value) =>
              updateSettings({ echoCancellation: value })
            }
          />
          <SettingToggle
            icon="pulse-outline"
            title="Automatic gain control"
            detail="Let WebRTC automatically balance microphone loudness."
            value={settings.autoGainControl}
            onValueChange={(value) =>
              updateSettings({ autoGainControl: value })
            }
          />
          <SettingToggle
            icon="mic-off-outline"
            title="Join voice muted"
            detail="Start every new Voice Room muted until you choose to speak."
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
                  Screen share quality
                </Text>
                <Text style={styles.choiceHelp}>
                  Resolution requested when you start sharing your mobile
                  screen.
                </Text>
              </View>
            </View>

            <View style={styles.qualityRow}>
              {([
                ["dataSaver", "Saver"],
                ["balanced", "Balanced"],
                ["full", "Full"],
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
              Capture-processing changes apply next time the microphone opens.
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
              {micChecking ? "Checking microphone…" : "Check microphone"}
            </Text>
          </Pressable>

          {!!micNotice && (
            <View
              style={[
                styles.micNotice,
                micNotice === "Microphone is ready." &&
                  styles.micNoticeSuccess,
              ]}
            >
              <Ionicons
                name={
                  micNotice === "Microphone is ready."
                    ? "checkmark-circle-outline"
                    : "alert-circle-outline"
                }
                size={15}
                color={
                  micNotice === "Microphone is ready."
                    ? colors.green
                    : colors.yellow
                }
              />
              <Text
                style={[
                  styles.micNoticeText,
                  micNotice === "Microphone is ready." &&
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
              Reset voice settings
            </Text>
          </Pressable>
        </SettingsCard>
        </View>
      </ScrollView>
    </Screen>
  );
}
