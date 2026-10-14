import { useLocalSearchParams, router } from "expo-router";
import { CallVerificationMark } from "@/src/providers/DmE2eeProvider";
import { useSession } from "@/src/providers/SessionProvider";
import { useRealtime } from "@/src/providers/RealtimeProvider";
import { useVoiceSettings } from "@/src/providers/VoiceSettingsProvider";
import { useVoice } from "@/src/providers/VoiceProvider";
import { useRef, useState, useEffect, useMemo } from "react";
import type { VoiceParticipant } from "@/src/types";
import ReportSheet, { type MobileReportTarget } from "@/src/components/ReportSheet";
import { saveLastVoiceRoom } from "@/src/lib/last-voice-room";
import { Alert, View, Pressable, Text, ScrollView, ActivityIndicator, StyleSheet, Modal } from "react-native";
import { apiJson } from "@/src/lib/api";
import { Screen } from "@/src/components/Screen";
import { styles } from "@/src/components/voice-room/voiceRoom.styles";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/src/theme";
import { Avatar } from "@/src/components/Avatar";
import { StatusIcon, InlineToggle, QualityButton, MoreItem, VoiceControl, ActionButton, VolumeStepper } from "@/src/components/voice-room/VoiceRoomControls";
import { RTCView } from "react-native-webrtc";
import { impactHaptic, tapHaptic } from "@/src/lib/haptics";
import { SoundboardSheet } from "@/src/components/Soundboard";
import { useSpeakerRoute } from "@/src/hooks/useSpeakerRoute";
import { useTranslation } from "react-i18next";

export default function VoiceRoomScreen() {
  const { t } = useTranslation(["voice", "common", "hub"]);
  const params = useLocalSearchParams<{
    id: string;
    hubId?: string;
    name?: string;
    squad?: string;
  }>();

  const channelId = Number(params.id);
  const roomName =
    typeof params.name === "string" && params.name
      ? decodeURIComponent(params.name)
      : t("voice.mobile.room.roomFallback");

  const { user, token } = useSession();
  const { connectionState, connectionId, lastEvent } = useRealtime();
  const { settings, updateSettings } = useVoiceSettings();

  const {
    voiceChannelId,
    participants,
    voiceStatus,
    voiceError,
    captureStatus,
    captureStatusMessage,
    recoveryState,
    recoveryAttempt,
    retryVoice,
    speakingUserIds,
    speakingAvailable,
    muted,
    deafened,
    serverMuted,
    serverDeafened,
    screenSharing,
    cameraSharing,
    localCameraStream,
    screenShareError,
    remoteVideos,
    locallyMutedUserIds,
    userVolumes,
    setUserVolume,
    pingMs,
    joinVoice,
    leaveVoice,
    toggleMute,
    toggleDeafen,
    startCamera,
    stopCamera,
    startScreenShare,
    stopScreenShare,
    toggleLocalUserMute,
    moderateParticipant,
  } = useVoice();
  const speakerRoute = useSpeakerRoute();

  const autoAttemptedChannelRef = useRef<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [soundboardOpen, setSoundboardOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [expandedVideo, setExpandedVideo] = useState<string | null>(null);
  const [chatUnread, setChatUnread] = useState(0);
  const [selectedParticipant, setSelectedParticipant] =
    useState<VoiceParticipant | null>(null);
  const [reportTarget, setReportTarget] = useState<MobileReportTarget | null>(null);

  const realtimeReady =
    connectionState === "connected" && Boolean(connectionId);

  useEffect(() => {
    if (
      lastEvent?.type === "ROOM_ACTIVITY" &&
      Number(lastEvent.channelId) === channelId
    ) {
      setChatUnread((current) => Math.min(999, current + 1));
    }
  }, [lastEvent, channelId]);

  useEffect(() => {
    if (!channelId) return;
    if (!realtimeReady) return;
    if (voiceChannelId === channelId || voiceStatus === "joining") return;
    if (autoAttemptedChannelRef.current === channelId) return;

    autoAttemptedChannelRef.current = channelId;
    void joinVoice(channelId);
  }, [
    channelId,
    realtimeReady,
    voiceChannelId,
    voiceStatus,
  ]);

  const roomParticipants = useMemo(
    () =>
      participants.filter(
        (participant) => participant.channelId === channelId,
      ),
    [participants, channelId],
  );

  const selfParticipant = useMemo(
    () =>
      roomParticipants.find(
        (participant) => participant.userId === user?.id,
      ) ?? null,
    [roomParticipants, user?.id],
  );

  const visibleVideos = useMemo(() => {
    const roomIds = new Set(
      roomParticipants.map((participant) => participant.connectionId),
    );

    return Object.values(remoteVideos).filter((video) =>
      roomIds.has(video.connectionId),
    );
  }, [remoteVideos, roomParticipants]);

  const connected = voiceChannelId === channelId;
  const streamCount = visibleVideos.length + (connected && localCameraStream ? 1 : 0);
  const joining = !connected && voiceStatus === "joining";
  const isSquadRoom = params.squad === "1";

  // Remember the room once connected so Home and the app-icon quick action can rejoin it.
  useEffect(() => {
    if (voiceStatus !== "connected" || voiceChannelId !== channelId) return;
    void saveLastVoiceRoom({ channelId, hubId: Number(params.hubId) || 0, name: roomName, squad: isSquadRoom });
  }, [voiceStatus, voiceChannelId, channelId, params.hubId, roomName, isSquadRoom]);

  const leaveSquadRoom = () => {
    if (!token || !params.hubId) return;
    Alert.alert(t("voice.mobile.room.leaveSquadRoom"), t("voice.mobile.room.youWillLeaveThisSquad"), [
      { text: t("common.actions.cancel"), style: "cancel" },
      { text: t("common.actions.leave"), style: "destructive", onPress: () => void (async () => {
        try {
          await apiJson(`/api/squad-finder/rooms/${encodeURIComponent(String(params.hubId))}/leave`, { method: "POST" }, token);
          if (connected) leaveVoice();
          router.replace("/hubs");
        } catch (error) { Alert.alert(t("voice.mobile.room.couldNotLeave"), error instanceof Error ? error.message : t("voice.mobile.room.pleaseTryAgain")); }
      }) },
    ]);
  };

  const canModerate = (target: VoiceParticipant): boolean => {
    if (!selfParticipant || target.userId === user?.id) return false;

    if (selfParticipant.role === "owner") {
      return target.role === "admin" || target.role === "member";
    }

    if (selfParticipant.role === "admin") {
      return target.role === "member";
    }

    return false;
  };

  const retryJoin = () => {
    if (recoveryState !== "idle") {
      retryVoice();
      return;
    }
    if (!channelId || joining) return;
    autoAttemptedChannelRef.current = channelId;
    void joinVoice(channelId);
  };

  const closePersonSheet = () => setSelectedParticipant(null);

  const openRoomChat = () => {
    setChatUnread(0);
    router.push(`/channel/${channelId}?hubId=${params.hubId ?? ""}&name=${encodeURIComponent(roomName)}&voice=1${isSquadRoom ? "&squad=1" : ""}`);
  };

  const openDirectMessage = (participant: VoiceParticipant) => {
    closePersonSheet();
    router.push(
      `/dm/${encodeURIComponent(
        participant.userId,
      )}?username=${encodeURIComponent(participant.username)}`,
    );
  };

  const confirmKick = (participant: VoiceParticipant) => {
    Alert.alert(
      t("voice.mobile.room.disconnectFromVoiceRoom"),
      t("voice.mobile.room.removeUsernameFromThisVoice", { username: participant.username }),
      [
        { text: t("common.actions.cancel"), style: "cancel" },
        {
          text: t("voice.mobile.room.disconnect"),
          style: "destructive",
          onPress: () => {
            moderateParticipant(participant.connectionId, "kick");
            closePersonSheet();
          },
        },
      ],
    );
  };

  return (
    <Screen>
      <View style={styles.top}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("common.actions.back")}
          style={styles.headerButton}
          onPress={() => router.back()}
          hitSlop={8}
        >
          <Ionicons name="chevron-back" size={22} color={colors.cyan} />
        </Pressable>

        <View style={styles.roomIcon}>
          <Ionicons name="volume-high" size={18} color={colors.cyan} />
        </View>

        <View style={styles.headerCopy}>
          <Text maxFontSizeMultiplier={1.3} style={styles.kicker}>{t("voice.mobile.room.voiceRoom")}</Text>
          <Text style={styles.title} numberOfLines={1} maxFontSizeMultiplier={1.4}>
            {roomName}
          </Text>
          <View style={styles.securityRow}>
            <Ionicons
              name="shield-checkmark-outline"
              size={11}
              color={colors.faint}
            />
            <Text style={styles.encryptionLabel} numberOfLines={1} maxFontSizeMultiplier={1.3}>
              {pingMs != null ? t("voice.mobile.room.encryptedPing", { ping: pingMs }) : t("voice.mobile.room.encrypted")}
            </Text>
            {pingMs != null && (
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: pingMs < 120 ? colors.green : pingMs < 250 ? colors.yellow : colors.red }} />
            )}
          </View>
        </View>

        <Pressable accessibilityRole="button"
          style={styles.headerButton}
          onPress={openRoomChat}
          hitSlop={8}
          accessibilityLabel={t("voice.mobile.room.openRoomChat")}
        >
          <Ionicons name="chatbubble-ellipses-outline" size={19} color={colors.cyan} />
          {chatUnread > 0 && (
            <View style={styles.chatUnreadBadge}>
              <Text style={styles.chatUnreadText}>{chatUnread > 99 ? "99+" : chatUnread}</Text>
            </View>
          )}
        </Pressable>

        {isSquadRoom && (
          <Pressable accessibilityRole="button" style={styles.headerButton} onPress={leaveSquadRoom} hitSlop={8} accessibilityLabel={t("voice.mobile.room.leaveSquadRoom2")}>
            <Ionicons name="exit-outline" size={19} color={colors.red} />
          </Pressable>
        )}

        <View
          style={[
            styles.stateBadge,
            connected && styles.stateBadgeConnected,
            joining && styles.stateBadgeJoining,
          ]}
        >
          <View
            style={[
              styles.stateDot,
              connected && styles.stateDotConnected,
              joining && styles.stateDotJoining,
            ]}
          />
          <Text
            style={[
              styles.stateText,
              connected && styles.stateTextConnected,
              joining && styles.stateTextJoining,
            ]}
          >
            {connected ? t("voice.lobby.live") : joining ? t("voice.mobile.room.joining") : t("voice.mobile.room.offline")}
          </Text>
        </View>
      </View>

      <ScrollView keyboardDismissMode="on-drag"
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {joining && (
          <View style={styles.statusCard}>
            <View style={styles.statusIcon}>
              <ActivityIndicator color={colors.cyan} size="small" />
            </View>
            <View style={styles.statusCopy}>
              <Text style={styles.statusTitle}>{t("voice.mobile.room.joiningVoice")}</Text>
              <Text style={styles.statusText}>
                {t("voice.mobile.room.openingYourMicrophoneAndWaiting")}
              </Text>
            </View>
          </View>
        )}

        {recoveryState !== "idle" && (
          <View style={styles.warningCard}>
            <Ionicons
              name={recoveryState === "failed" ? "alert-circle-outline" : "sync-outline"}
              size={19}
              color={recoveryState === "failed" ? colors.red : colors.yellow}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.warningTitle}>
                {recoveryState === "failed" ? t("common.mobile.home.voiceNeedsAttention") : t("common.mobile.home.recoveringVoice")}
              </Text>
              <Text style={styles.warningText}>
                {recoveryState === "failed"
                  ? t("voice.mobile.room.theRoomCouldNotRecover")
                  : recoveryAttempt ? t("voice.mobile.room.rejoiningAttempt", { attempt: recoveryAttempt }) : t("voice.mobile.room.rejoining")}
              </Text>
            </View>
            {recoveryState === "failed" && realtimeReady && (
              <Pressable accessibilityRole="button" style={styles.retry} onPress={retryJoin}>
                <Text style={styles.retryText}>{t("common.actions.retry")}</Text>
              </Pressable>
            )}
          </View>
        )}

        {!realtimeReady && !connected && (
          <View style={styles.warningCard}>
            <Ionicons
              name="cloud-offline-outline"
              size={19}
              color={colors.yellow}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.warningTitle}>{t("voice.mobile.room.realtimeIsReconnecting")}</Text>
              <Text style={styles.warningText}>
                {t("voice.mobile.room.voiceWillBecomeAvailableWhen")}
              </Text>
            </View>
          </View>
        )}

        {!!voiceError && (
          <View style={styles.errorCard}>
            <Ionicons
              name="alert-circle-outline"
              size={20}
              color={colors.red}
            />
            <View style={styles.errorCopy}>
              <Text style={styles.errorTitle}>{t("voice.mobile.room.voiceConnection")}</Text>
              <Text style={styles.errorText}>{voiceError}</Text>
            </View>
            {!connected && !joining && realtimeReady && (
              <Pressable accessibilityRole="button" style={styles.retry} onPress={retryJoin}>
                <Text style={styles.retryText}>{t("common.actions.retry")}</Text>
              </Pressable>
            )}
          </View>
        )}

        {!!screenShareError && (
          <View style={styles.errorCard}>
            <Ionicons
              name="desktop-outline"
              size={20}
              color={colors.red}
            />
            <View style={styles.errorCopy}>
              <Text style={styles.errorTitle}>{t("voice.mobile.room.screenSharing")}</Text>
              <Text style={styles.errorText}>{screenShareError}</Text>
            </View>
          </View>
        )}

        <View style={styles.peopleHeading}>
          <View>
            <Text maxFontSizeMultiplier={1.3} style={styles.sectionKicker}>{t("voice.mobile.room.people")}</Text>
            <Text style={styles.sectionTitle}>
              {roomParticipants.length === 1
                ? t("voice.mobile.room.n1Connected")
                : t("voice.mobile.room.countConnected", { count: roomParticipants.length })}
            </Text>
            {connected && !speakingAvailable && roomParticipants.length > 1 && (
              <Text style={styles.activityHint}>{t("voice.mobile.room.voiceActivityMeterUnavailableOn")}</Text>
            )}
          </View>

          {connected && (
            <View style={styles.connectedPill}>
              <View style={styles.connectedPillDot} />
              <Text maxFontSizeMultiplier={1.3} style={styles.connectedPillText}>{t("voice.mobile.room.inRoom")}</Text>
            </View>
          )}
        </View>

        {roomParticipants.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Ionicons
                name="headset-outline"
                size={27}
                color={connected ? colors.green : colors.violet}
              />
            </View>
            <Text style={styles.emptyTitle}>
              {connected ? t("voice.mobile.room.youReFirstHere") : t("voice.mobile.room.noOneIsConnected")}
            </Text>
            <Text style={styles.emptyText}>
              {connected
                ? t("voice.mobile.room.stayHereAndYourFriends")
                : joining
                  ? t("voice.mobile.room.yourRoomMembershipIsBeing")
                  : t("voice.mobile.room.joinTheRoomToStart")}
            </Text>
          </View>
        ) : (
          <View style={styles.people}>
            {roomParticipants.map((participant) => {
              const localMuted = locallyMutedUserIds.includes(
                participant.userId,
              );
              const isSelf = participant.userId === user?.id;
              const participantMuted =
                participant.muted ||
                participant.serverMuted ||
                localMuted;
              const participantDeafened =
                participant.deafened || participant.serverDeafened;

              return (
                <Pressable
                  key={participant.connectionId}
                  style={({ pressed }) => [
                    styles.person,
                    isSelf && styles.personSelf,
                    speakingUserIds.includes(participant.userId) && styles.personSpeaking,
                    pressed && styles.personPressed,
                  ]}
                  onPress={() => setSelectedParticipant(participant)}
                  accessibilityRole="button"
                  accessibilityLabel={speakingUserIds.includes(participant.userId) ? t("voice.mobile.room.speaking", { username: participant.username }) : participant.username}
                >
                  <Avatar
                    username={participant.username}
                    avatarUrl={participant.avatarUrl}
                    size={56}
                  />

                  <View style={styles.personCopy}>
                    <View style={styles.personNameRow}>
                      <Text style={styles.personName} numberOfLines={1}>
                        {participant.username}
                      </Text>
                      <CallVerificationMark connectionId={participant.connectionId} />
                      {isSelf && (
                        <View style={styles.youChip}>
                          <Text style={styles.youChipText}>{t("voice.mobile.room.you")}</Text>
                        </View>
                      )}
                    </View>

                    <Text style={styles.personMeta}>
                      {speakingUserIds.includes(participant.userId)
                        ? t("voice.mobile.room.speaking")
                        : localMuted
                        ? t("voice.mobile.room.mutedByYou")
                        : participant.serverMuted
                          ? t("voice.mobile.room.serverMuted")
                          : participant.serverDeafened
                            ? t("voice.mobile.room.serverDeafened")
                            : participant.deafened
                              ? t("voice.mobile.room.deafened")
                              : participant.muted
                                ? t("voice.mobile.room.muted")
                                : participant.screenSharing
                                  ? t("common.admin.overview.metrics.sharing")
                                  : t("common.connection.connected")}
                    </Text>
                  </View>

                  <View style={styles.personIndicators}>
                    {speakingAvailable && speakingUserIds.includes(participant.userId) && (
                      <StatusIcon name="mic-outline" tone="cyan" />
                    )}
                    {participant.screenSharing && (
                      <StatusIcon
                        name="desktop-outline"
                        tone="cyan"
                      />
                    )}
                    {participantDeafened && (
                      <StatusIcon
                        name="volume-mute-outline"
                        tone="red"
                      />
                    )}
                    <StatusIcon
                      name={
                        participantMuted
                          ? "mic-off-outline"
                          : "mic-outline"
                      }
                      tone={participantMuted ? "red" : "green"}
                    />
                  </View>
                </Pressable>
              );
            })}

            <Text style={styles.holdHint}>
              {t("voice.mobile.room.tapAPersonForVolume")}
            </Text>
          </View>
        )}

        {(visibleVideos.length > 0 || (connected && localCameraStream)) && (
          <View style={styles.videoSection}>
            <View style={styles.peopleHeading}>
              <View>
                <Text maxFontSizeMultiplier={1.3} style={styles.sectionKicker}>{t("voice.lobby.live")}</Text>
                <Text style={styles.sectionTitle}>
                  {streamCount === 1
                    ? t("voice.mobile.room.n1SharedStream")
                    : t("voice.mobile.room.countSharedStreams", { count: streamCount })}
                </Text>
              </View>
            </View>

            <View style={styles.videoGrid}>
              {connected && localCameraStream && (
                <View style={styles.videoCard}>
                  <RTCView
                    streamURL={localCameraStream.toURL()}
                    style={styles.video}
                    objectFit="cover"
                    mirror
                  />
                  <View style={styles.videoFooter}>
                    <View style={styles.videoNameRow}>
                      <Ionicons name="videocam-outline" size={14} color={colors.cyan} />
                      <Text style={styles.videoName}>{t("hub.voiceStage.youCamera")}</Text>
                    </View>
                  </View>
                </View>
              )}
              {visibleVideos.map((video) => {
                const participant = roomParticipants.find(
                  (item) =>
                    item.connectionId === video.connectionId,
                );

                return (
                  <Pressable
                    key={video.connectionId}
                    style={styles.videoCard}
                    onPress={() => setExpandedVideo(video.connectionId)}
                    accessibilityRole="button"
                    accessibilityLabel={t("voice.mobile.room.expandUsernameSStream", { username: video.username })}
                  >
                    <RTCView
                      streamURL={video.stream.toURL()}
                      style={styles.video}
                      objectFit="contain"
                      mirror={false}
                    />
                    <View style={styles.videoFooter}>
                      <View style={styles.videoNameRow}>
                        <Ionicons
                          name="desktop-outline"
                          size={14}
                          color={colors.cyan}
                        />
                        <Text style={styles.videoName}>
                          {video.username}
                        </Text>
                      </View>
                      <Text style={styles.videoMeta}>
                        {participant?.screenSharing
                          ? t("voice.mobile.room.screenShareTapToExpand")
                          : t("voice.mobile.room.videoTapToExpand")}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}

        {settingsOpen && connected && (
          <View style={styles.settingsCard}>
            <View style={styles.settingsHeadingRow}>
              <View style={styles.settingsHeadingIcon}>
                <Ionicons
                  name="options-outline"
                  size={20}
                  color={colors.cyan}
                />
              </View>
              <View style={styles.settingsHeadingCopy}>
                <Text style={styles.settingsTitle}>{t("voice.mobile.room.voiceControls")}</Text>
                <Text style={styles.settingsHelp}>
                  {t("voice.mobile.room.quickSettingsForThisDevice")}
                </Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel={t("common.actions.close")}
                style={styles.settingsClose}
                onPress={() => setSettingsOpen(false)}
              >
                <Ionicons name="close" size={18} color={colors.muted} />
              </Pressable>
            </View>

            <InlineToggle
              title={t("voice.mobile.room.noiseSuppression")}
              value={settings.noiseSuppression}
              onValueChange={(value) =>
                updateSettings({ noiseSuppression: value })
              }
            />
            <InlineToggle
              title={t("voice.mobile.room.echoCancellation")}
              value={settings.echoCancellation}
              onValueChange={(value) =>
                updateSettings({ echoCancellation: value })
              }
            />
            <InlineToggle
              title={t("voice.mobile.room.automaticGain")}
              value={settings.autoGainControl}
              onValueChange={(value) =>
                updateSettings({ autoGainControl: value })
              }
            />
            <InlineToggle
              title={t("voice.mobile.room.joinNewRoomsMuted")}
              value={settings.joinMuted}
              onValueChange={(value) =>
                updateSettings({ joinMuted: value })
              }
            />

            <Text style={styles.qualityLabel}>{t("voice.mobile.room.screenShareQuality")}</Text>
            <View style={styles.qualityRow}>
              <QualityButton
                label={t("voice.mobile.room.saver")}
                value="dataSaver"
                selected={settings.screenShareQuality}
                onSelect={(value) =>
                  updateSettings({ screenShareQuality: value })
                }
              />
              <QualityButton
                label={t("voice.mobile.room.balanced")}
                value="balanced"
                selected={settings.screenShareQuality}
                onSelect={(value) =>
                  updateSettings({ screenShareQuality: value })
                }
              />
              <QualityButton
                label={t("voice.mobile.room.full")}
                value="full"
                selected={settings.screenShareQuality}
                onSelect={(value) =>
                  updateSettings({ screenShareQuality: value })
                }
              />
            </View>

            {!!captureStatusMessage && (
              <View style={styles.captureStatus}>
                <Ionicons
                  name={captureStatus === "unsupported" ? "warning-outline" : "checkmark-circle-outline"}
                  size={15}
                  color={captureStatus === "unsupported" ? colors.yellow : colors.green}
                />
                <Text style={styles.captureHint}>{captureStatusMessage}</Text>
              </View>
            )}
            <Text style={styles.captureHint}>
              {t("voice.mobile.room.screenQualityAppliesOnThe")}
            </Text>

            <Pressable accessibilityRole="button"
              style={styles.fullSettingsButton}
              onPress={() => router.push("/settings")}
            >
              <Text style={styles.fullSettingsText}>{t("voice.mobile.room.openFullSettings")}</Text>
              <Ionicons
                name="chevron-forward"
                size={15}
                color={colors.violet}
              />
            </Pressable>
          </View>
        )}
      </ScrollView>

      {moreOpen && connected && (
        <Pressable accessibilityRole="button"
          accessibilityLabel={t("voice.mobile.room.closeMenu")}
          style={StyleSheet.absoluteFill}
          onPress={() => setMoreOpen(false)}
        />
      )}
      {moreOpen && connected && (
        <View style={styles.moreMenu}>
          <MoreItem
            icon={screenSharing ? "stop-circle-outline" : "desktop-outline"}
            label={screenSharing ? t("voice.mobile.room.stopSharingScreen") : t("voice.mobile.room.shareScreen")}
            onPress={() => {
              setMoreOpen(false);
              if (screenSharing) stopScreenShare();
              else void startScreenShare();
            }}
          />
          {!!Number(params.hubId) && (
            <MoreItem icon="musical-notes-outline" label={t("voice.mobile.room.soundboard")} onPress={() => { setMoreOpen(false); setSoundboardOpen(true); }} />
          )}
          <MoreItem
            icon="options-outline"
            label={settingsOpen ? t("voice.mobile.room.hideVoiceSettings") : t("voice.mobile.room.voiceSettings")}
            onPress={() => { setMoreOpen(false); setSettingsOpen((current) => !current); }}
          />
        </View>
      )}

      <View style={styles.controls}>
        {connected ? (
          <View style={styles.voiceControls}>
            <VoiceControl
              icon={
                muted || serverMuted
                  ? "mic-off-outline"
                  : "mic-outline"
              }
              label={serverMuted ? t("voice.mobile.room.locked") : muted ? t("voice.mobile.room.unmute") : t("voice.mobile.room.mute")}
              active={muted || serverMuted}
              danger={muted || serverMuted}
              disabled={serverMuted}
              onPress={() => { impactHaptic(); toggleMute(); }}
            />

            <VoiceControl
              icon={
                deafened || serverDeafened
                  ? "volume-mute-outline"
                  : "headset-outline"
              }
              label={
                serverDeafened
                  ? t("voice.mobile.room.locked")
                  : deafened
                    ? t("voice.mobile.room.hear")
                    : t("common.profileMenu.deafen")
              }
              active={deafened || serverDeafened}
              danger={deafened || serverDeafened}
              disabled={serverDeafened}
              onPress={() => { impactHaptic(); toggleDeafen(); }}
            />

            {speakerRoute.available && (
              <VoiceControl
                icon={speakerRoute.external ? "bluetooth-outline" : speakerRoute.speakerOn ? "volume-high-outline" : "phone-portrait-outline"}
                label={speakerRoute.external ? speakerRoute.outputName || t("voice.mobile.room.headphones") : speakerRoute.speakerOn ? t("voice.mobile.room.speaker") : t("voice.mobile.room.phone")}
                active={speakerRoute.speakerOn}
                disabled={speakerRoute.external}
                onPress={() => { tapHaptic(); speakerRoute.toggleSpeaker(); }}
              />
            )}

            <VoiceControl
              icon="videocam-outline"
              label={cameraSharing ? t("voice.mobile.room.cameraOff") : t("voice.mobile.room.camera")}
              active={cameraSharing}
              onPress={() => {
                if (cameraSharing) stopCamera();
                else void startCamera();
              }}
            />

            <VoiceControl
              icon="ellipsis-horizontal"
              label={t("voice.mobile.room.more")}
              active={moreOpen || screenSharing || settingsOpen}
              onPress={() => { tapHaptic(); setMoreOpen((current) => !current); }}
            />

            <VoiceControl
              icon="call-outline"
              label={t("common.actions.leave")}
              danger
              onPress={() => {
                impactHaptic();
                leaveVoice();
                router.back();
              }}
            />
          </View>
        ) : (
          <Pressable accessibilityRole="button"
            style={[
              styles.join,
              (joining || !realtimeReady) && styles.joinDisabled,
            ]}
            disabled={joining || !realtimeReady}
            onPress={retryJoin}
          >
            {joining ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Ionicons
                name="headset-outline"
                size={19}
                color="#fff"
              />
            )}
            <Text style={styles.joinText}>
              {joining
                ? t("voice.mobile.room.joiningVoice2")
                : realtimeReady
                  ? t("voice.mobile.room.joinVoice")
                  : t("voice.mobile.room.waitingForRealtime")}
            </Text>
          </Pressable>
        )}
      </View>

      <Modal
        visible={selectedParticipant !== null}
        transparent
        animationType="fade"
        onRequestClose={closePersonSheet}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={closePersonSheet}
        >
          <Pressable style={styles.personSheet} onPress={() => {}}>
            {selectedParticipant && (
              <>
                <View style={styles.sheetGrabber} />

                <View style={styles.sheetHeader}>
                  <Avatar
                    username={selectedParticipant.username}
                    avatarUrl={selectedParticipant.avatarUrl}
                    size={54}
                  />
                  <View style={styles.sheetCopy}>
                    <Text style={styles.sheetName}>
                      {selectedParticipant.username}
                    </Text>
                    <Text style={styles.sheetMeta}>
                      {selectedParticipant.role
                        ? `${selectedParticipant.role
                            .charAt(0)
                            .toUpperCase()}${selectedParticipant.role.slice(1)}`
                        : t("voice.mobile.room.voiceMember")}
                    </Text>
                  </View>
                  <Pressable accessibilityRole="button" accessibilityLabel={t("common.actions.close")}
                    style={styles.sheetCloseButton}
                    onPress={closePersonSheet}
                  >
                    <Ionicons
                      name="close"
                      size={19}
                      color={colors.muted}
                    />
                  </Pressable>
                </View>

                {selectedParticipant.userId !== user?.id && (
                  <>
                    <ActionButton
                      icon="chatbubble-outline"
                      label={t("voice.mobile.room.message")}
                      detail={t("voice.mobile.room.openADirectConversation")}
                      onPress={() =>
                        openDirectMessage(selectedParticipant)
                      }
                    />
                    <ActionButton
                      icon="flag-outline"
                      label={t("voice.mobile.room.reportUser")}
                      detail={t("voice.mobile.room.sendAPrivateTrustSafety")}
                      onPress={() => {
                        const participant = selectedParticipant;
                        closePersonSheet();
                        setReportTarget({
                          targetType: "voice_participant",
                          targetId: participant.userId,
                          subjectUserId: participant.userId,
                          subjectUsername: participant.username,
                          contextType: "voice",
                          contextId: String(channelId),
                          contextLabel: roomName,
                        });
                      }}
                    />
                    <ActionButton
                      icon={
                        locallyMutedUserIds.includes(
                          selectedParticipant.userId,
                        )
                          ? "volume-high-outline"
                          : "volume-mute-outline"
                      }
                      label={
                        locallyMutedUserIds.includes(
                          selectedParticipant.userId,
                        )
                          ? t("voice.mobile.room.unmuteForMe")
                          : t("voice.mobile.room.muteForMe")
                      }
                      detail={t("voice.mobile.room.onlyChangesWhatYouHear")}
                      onPress={() => {
                        toggleLocalUserMute(
                          selectedParticipant.userId,
                        );
                        closePersonSheet();
                      }}
                    />
                    <VolumeStepper
                      value={userVolumes[selectedParticipant.userId] ?? 1}
                      onChange={(value) => setUserVolume(selectedParticipant.userId, value)}
                    />
                  </>
                )}

                {canModerate(selectedParticipant) && (
                  <View style={styles.moderationBlock}>
                    <Text style={styles.moderationTitle}>{t("voice.mobile.room.moderation")}</Text>

                    <ActionButton
                      icon={
                        selectedParticipant.serverMuted
                          ? "mic-outline"
                          : "mic-off-outline"
                      }
                      label={
                        selectedParticipant.serverMuted
                          ? t("voice.mobile.room.removeServerMute")
                          : t("voice.mobile.room.serverMute")
                      }
                      detail={t("voice.mobile.room.controlWhetherThisPersonCan")}
                      onPress={() => {
                        moderateParticipant(
                          selectedParticipant.connectionId,
                          selectedParticipant.serverMuted
                            ? "unmute"
                            : "mute",
                        );
                        closePersonSheet();
                      }}
                    />

                    <ActionButton
                      icon={
                        selectedParticipant.serverDeafened
                          ? "headset-outline"
                          : "volume-mute-outline"
                      }
                      label={
                        selectedParticipant.serverDeafened
                          ? t("voice.mobile.room.removeServerDeafen")
                          : t("voice.mobile.room.serverDeafen")
                      }
                      detail={t("voice.mobile.room.preventThisPersonFromHearing")}
                      onPress={() => {
                        moderateParticipant(
                          selectedParticipant.connectionId,
                          selectedParticipant.serverDeafened
                            ? "undeafen"
                            : "deafen",
                        );
                        closePersonSheet();
                      }}
                    />

                    <ActionButton
                      icon="call-outline"
                      label={t("voice.mobile.room.disconnectFromRoom")}
                      detail={t("voice.mobile.room.removeThisPersonFromThe")}
                      danger
                      onPress={() => confirmKick(selectedParticipant)}
                    />
                  </View>
                )}
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={expandedVideo !== null} animationType="fade" supportedOrientations={["portrait", "landscape"]} onRequestClose={() => setExpandedVideo(null)}>
        <View style={{ flex: 1, backgroundColor: "#000" }}>
          {(() => {
            const video = visibleVideos.find((item) => item.connectionId === expandedVideo);
            return video ? <RTCView streamURL={video.stream.toURL()} style={{ flex: 1 }} objectFit="contain" mirror={false} /> : null;
          })()}
          <Pressable accessibilityRole="button"
            accessibilityLabel={t("voice.mobile.room.closeStream")}
            onPress={() => setExpandedVideo(null)}
            style={{ position: "absolute", top: 54, left: 16, width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.16)" }}
          >
            <Ionicons name="close" size={22} color="#FFFFFF" />
          </Pressable>
        </View>
      </Modal>
      <SoundboardSheet
        visible={soundboardOpen}
        hubId={Number(params.hubId) || 0}
        onClose={() => setSoundboardOpen(false)}
      />
      <ReportSheet
        visible={reportTarget !== null}
        token={token}
        target={reportTarget}
        onClose={() => setReportTarget(null)}
        onSubmitted={() => setTimeout(() => setReportTarget(null), 900)}
      />
    </Screen>
  );
}
