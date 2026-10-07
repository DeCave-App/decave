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

export default function VoiceRoomScreen() {
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
      : "Voice Room";

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
  const joining = !connected && voiceStatus === "joining";
  const isSquadRoom = params.squad === "1";

  // Remember the room once connected so Home and the app-icon quick action can rejoin it.
  useEffect(() => {
    if (voiceStatus !== "connected" || voiceChannelId !== channelId) return;
    void saveLastVoiceRoom({ channelId, hubId: Number(params.hubId) || 0, name: roomName, squad: isSquadRoom });
  }, [voiceStatus, voiceChannelId, channelId, params.hubId, roomName, isSquadRoom]);

  const leaveSquadRoom = () => {
    if (!token || !params.hubId) return;
    Alert.alert("Leave squad room?", "You will leave this squad's voice and messages.", [
      { text: "Cancel", style: "cancel" },
      { text: "Leave", style: "destructive", onPress: () => void (async () => {
        try {
          await apiJson(`/api/squad-finder/rooms/${encodeURIComponent(String(params.hubId))}/leave`, { method: "POST" }, token);
          if (connected) leaveVoice();
          router.replace("/hubs");
        } catch (error) { Alert.alert("Could not leave", error instanceof Error ? error.message : "Please try again."); }
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
      "Disconnect from Voice Room?",
      `Remove ${participant.username} from this Voice Room?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
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
        <Pressable accessibilityRole="button" accessibilityLabel="Back"
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
          <Text maxFontSizeMultiplier={1.3} style={styles.kicker}>VOICE ROOM</Text>
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
              Encrypted{pingMs != null ? ` · ${pingMs} ms` : ""}
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
          accessibilityLabel="Open room chat"
        >
          <Ionicons name="chatbubble-ellipses-outline" size={19} color={colors.cyan} />
          {chatUnread > 0 && (
            <View style={styles.chatUnreadBadge}>
              <Text style={styles.chatUnreadText}>{chatUnread > 99 ? "99+" : chatUnread}</Text>
            </View>
          )}
        </Pressable>

        {isSquadRoom && (
          <Pressable accessibilityRole="button" style={styles.headerButton} onPress={leaveSquadRoom} hitSlop={8} accessibilityLabel="Leave squad room">
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
            {connected ? "LIVE" : joining ? "JOINING" : "OFFLINE"}
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
              <Text style={styles.statusTitle}>Joining voice</Text>
              <Text style={styles.statusText}>
                Opening your microphone and waiting for the room confirmation…
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
                {recoveryState === "failed" ? "Voice needs attention" : "Recovering voice"}
              </Text>
              <Text style={styles.warningText}>
                {recoveryState === "failed"
                  ? "The room could not recover automatically. Retry when realtime is connected."
                  : `Rejoining this room${recoveryAttempt ? ` (attempt ${recoveryAttempt}/3)` : ""}…`}
              </Text>
            </View>
            {recoveryState === "failed" && realtimeReady && (
              <Pressable accessibilityRole="button" style={styles.retry} onPress={retryJoin}>
                <Text style={styles.retryText}>Retry</Text>
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
              <Text style={styles.warningTitle}>Realtime is reconnecting</Text>
              <Text style={styles.warningText}>
                Voice will become available when DeCave reconnects.
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
              <Text style={styles.errorTitle}>Voice connection</Text>
              <Text style={styles.errorText}>{voiceError}</Text>
            </View>
            {!connected && !joining && realtimeReady && (
              <Pressable accessibilityRole="button" style={styles.retry} onPress={retryJoin}>
                <Text style={styles.retryText}>Retry</Text>
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
              <Text style={styles.errorTitle}>Screen sharing</Text>
              <Text style={styles.errorText}>{screenShareError}</Text>
            </View>
          </View>
        )}

        <View style={styles.peopleHeading}>
          <View>
            <Text maxFontSizeMultiplier={1.3} style={styles.sectionKicker}>PEOPLE</Text>
            <Text style={styles.sectionTitle}>
              {roomParticipants.length === 1
                ? "1 connected"
                : `${roomParticipants.length} connected`}
            </Text>
            {connected && !speakingAvailable && roomParticipants.length > 1 && (
              <Text style={styles.activityHint}>Voice activity meter unavailable on this device</Text>
            )}
          </View>

          {connected && (
            <View style={styles.connectedPill}>
              <View style={styles.connectedPillDot} />
              <Text maxFontSizeMultiplier={1.3} style={styles.connectedPillText}>In room</Text>
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
              {connected ? "You’re first here" : "No one is connected"}
            </Text>
            <Text style={styles.emptyText}>
              {connected
                ? "Stay here and your friends can join you."
                : joining
                  ? "Your room membership is being confirmed."
                  : "Join the room to start talking."}
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
                  accessibilityLabel={`${participant.username}${speakingUserIds.includes(participant.userId) ? ", speaking" : ""}`}
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
                          <Text style={styles.youChipText}>YOU</Text>
                        </View>
                      )}
                    </View>

                    <Text style={styles.personMeta}>
                      {speakingUserIds.includes(participant.userId)
                        ? "Speaking"
                        : localMuted
                        ? "Muted by you"
                        : participant.serverMuted
                          ? "Server muted"
                          : participant.serverDeafened
                            ? "Server deafened"
                            : participant.deafened
                              ? "Deafened"
                              : participant.muted
                                ? "Muted"
                                : participant.screenSharing
                                  ? "Sharing screen"
                                  : "Connected"}
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
              Tap a person for volume and voice actions.
            </Text>
          </View>
        )}

        {visibleVideos.length > 0 && (
          <View style={styles.videoSection}>
            <View style={styles.peopleHeading}>
              <View>
                <Text maxFontSizeMultiplier={1.3} style={styles.sectionKicker}>LIVE</Text>
                <Text style={styles.sectionTitle}>
                  {visibleVideos.length === 1
                    ? "1 shared stream"
                    : `${visibleVideos.length} shared streams`}
                </Text>
              </View>
            </View>

            <View style={styles.videoGrid}>
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
                    accessibilityLabel={`Expand ${video.username}'s stream`}
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
                          ? "Screen share · tap to expand"
                          : "Video · tap to expand"}
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
                <Text style={styles.settingsTitle}>Voice controls</Text>
                <Text style={styles.settingsHelp}>
                  Quick settings for this device.
                </Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Close"
                style={styles.settingsClose}
                onPress={() => setSettingsOpen(false)}
              >
                <Ionicons name="close" size={18} color={colors.muted} />
              </Pressable>
            </View>

            <InlineToggle
              title="Noise suppression"
              value={settings.noiseSuppression}
              onValueChange={(value) =>
                updateSettings({ noiseSuppression: value })
              }
            />
            <InlineToggle
              title="Echo cancellation"
              value={settings.echoCancellation}
              onValueChange={(value) =>
                updateSettings({ echoCancellation: value })
              }
            />
            <InlineToggle
              title="Automatic gain"
              value={settings.autoGainControl}
              onValueChange={(value) =>
                updateSettings({ autoGainControl: value })
              }
            />
            <InlineToggle
              title="Join new rooms muted"
              value={settings.joinMuted}
              onValueChange={(value) =>
                updateSettings({ joinMuted: value })
              }
            />

            <Text style={styles.qualityLabel}>SCREEN SHARE QUALITY</Text>
            <View style={styles.qualityRow}>
              <QualityButton
                label="Saver"
                value="dataSaver"
                selected={settings.screenShareQuality}
                onSelect={(value) =>
                  updateSettings({ screenShareQuality: value })
                }
              />
              <QualityButton
                label="Balanced"
                value="balanced"
                selected={settings.screenShareQuality}
                onSelect={(value) =>
                  updateSettings({ screenShareQuality: value })
                }
              />
              <QualityButton
                label="Full"
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
              Screen quality applies on the next share. Microphone processing
              changes are applied to this call when the runtime supports them.
            </Text>

            <Pressable accessibilityRole="button"
              style={styles.fullSettingsButton}
              onPress={() => router.push("/settings")}
            >
              <Text style={styles.fullSettingsText}>Open full settings</Text>
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
          accessibilityLabel="Close menu"
          style={StyleSheet.absoluteFill}
          onPress={() => setMoreOpen(false)}
        />
      )}
      {moreOpen && connected && (
        <View style={styles.moreMenu}>
          <MoreItem
            icon={screenSharing ? "stop-circle-outline" : "desktop-outline"}
            label={screenSharing ? "Stop sharing screen" : "Share screen"}
            onPress={() => {
              setMoreOpen(false);
              if (screenSharing) stopScreenShare();
              else void startScreenShare();
            }}
          />
          {!!Number(params.hubId) && (
            <MoreItem icon="musical-notes-outline" label="Soundboard" onPress={() => { setMoreOpen(false); setSoundboardOpen(true); }} />
          )}
          <MoreItem
            icon="options-outline"
            label={settingsOpen ? "Hide voice settings" : "Voice settings"}
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
              label={serverMuted ? "Locked" : muted ? "Unmute" : "Mute"}
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
                  ? "Locked"
                  : deafened
                    ? "Hear"
                    : "Deafen"
              }
              active={deafened || serverDeafened}
              danger={deafened || serverDeafened}
              disabled={serverDeafened}
              onPress={() => { impactHaptic(); toggleDeafen(); }}
            />

            {speakerRoute.available && (
              <VoiceControl
                icon={speakerRoute.external ? "bluetooth-outline" : speakerRoute.speakerOn ? "volume-high-outline" : "phone-portrait-outline"}
                label={speakerRoute.external ? speakerRoute.outputName || "Headphones" : speakerRoute.speakerOn ? "Speaker" : "Phone"}
                active={speakerRoute.speakerOn}
                disabled={speakerRoute.external}
                onPress={() => { tapHaptic(); speakerRoute.toggleSpeaker(); }}
              />
            )}

            <VoiceControl
              icon="videocam-outline"
              label={cameraSharing ? "Camera off" : "Camera"}
              active={cameraSharing}
              onPress={() => {
                if (cameraSharing) stopCamera();
                else void startCamera();
              }}
            />

            <VoiceControl
              icon="ellipsis-horizontal"
              label="More"
              active={moreOpen || screenSharing || settingsOpen}
              onPress={() => { tapHaptic(); setMoreOpen((current) => !current); }}
            />

            <VoiceControl
              icon="call-outline"
              label="Leave"
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
                ? "Joining voice…"
                : realtimeReady
                  ? "Join voice"
                  : "Waiting for realtime…"}
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
                        : "Voice member"}
                    </Text>
                  </View>
                  <Pressable accessibilityRole="button" accessibilityLabel="Close"
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
                      label="Message"
                      detail="Open a direct conversation"
                      onPress={() =>
                        openDirectMessage(selectedParticipant)
                      }
                    />
                    <ActionButton
                      icon="flag-outline"
                      label="Report user"
                      detail="Send a private Trust & Safety report"
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
                          ? "Unmute for me"
                          : "Mute for me"
                      }
                      detail="Only changes what you hear on this device"
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
                    <Text style={styles.moderationTitle}>MODERATION</Text>

                    <ActionButton
                      icon={
                        selectedParticipant.serverMuted
                          ? "mic-outline"
                          : "mic-off-outline"
                      }
                      label={
                        selectedParticipant.serverMuted
                          ? "Remove server mute"
                          : "Server mute"
                      }
                      detail="Control whether this person can transmit audio"
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
                          ? "Remove server deafen"
                          : "Server deafen"
                      }
                      detail="Prevent this person from hearing the room"
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
                      label="Disconnect from room"
                      detail="Remove this person from the current Voice Room"
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
            accessibilityLabel="Close stream"
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
