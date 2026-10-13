// The Hub's room list: sections, rows and the empty state.

import { View, Text, Pressable } from "react-native";
import { styles } from "./hubScreen.styles";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { colors } from "@/src/theme";
import type { Channel, Hub, VoiceParticipant } from "@/src/types";
import { roomTypeOf, SplitContext } from "./hubShared";
import { useUnread } from "@/src/providers/UnreadProvider";
import { useDrafts } from "@/src/lib/drafts";
import { useContext } from "react";
import { router } from "expo-router";
import { Avatar } from "@/src/components/Avatar";
import { parseRoomAccent } from "../../../../shared/room-style";

export function ChannelSection({
  title,
  icon,
  count,
  canManage,
  onAdd,
  children,
}: {
  title: string;
  icon: string;
  count: number;
  canManage: boolean;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation(["hub"]);
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionHeadingLeft}>
          <Ionicons name={icon as any} size={14} color={colors.cyan} />
          <Text style={styles.sectionTitle}>{title}</Text>
        </View>

        <View style={styles.sectionRight}>
          <View style={styles.countBadge}>
            <Text maxFontSizeMultiplier={1.3} style={styles.countText}>{count}</Text>
          </View>
          {canManage && (
            <Pressable accessibilityRole="button" accessibilityLabel={t("hub.mobile.rooms.add")} style={styles.sectionAdd} onPress={onAdd} hitSlop={8}>
              <Ionicons name="add" size={16} color={colors.cyan} />
            </Pressable>
          )}
        </View>
      </View>

      <View style={styles.sectionList}>{children}</View>
    </View>
  );
}

export function ChannelRow({
  channel,
  hub,
  connected,
  participants,
  canManage,
  onEdit,
}: {
  channel: Channel;
  hub: Hub;
  connected: boolean;
  participants: VoiceParticipant[];
  canManage: boolean;
  onEdit: () => void;
}) {
  const { t } = useTranslation(["hub"]);
  const isVoice = channel.type === "voice";
  const isForum = roomTypeOf(channel) === "forum";
  const roomIcon = channel.icon?.trim();
  const accent = parseRoomAccent(channel.accent) ?? null;
  const { rooms, markRoomRead } = useUnread();
  const unreadCount = rooms[String(channel.id)] ?? 0;
  const hasDraft = !!useDrafts()[`room:${channel.id}`];
  const splitView = useContext(SplitContext);
  const selectedInSplit = splitView?.selected?.id === channel.id;

  const openRoom = () => {
    markRoomRead(channel.id);
    if (splitView && !isVoice) {
      splitView.select({ id: channel.id, name: channel.name, forum: isForum });
      return;
    }
    if (isVoice) {
      router.push(
        `/voice/${channel.id}?hubId=${hub.id}&name=${encodeURIComponent(
          channel.name,
        )}${hub.isSquad ? "&squad=1" : ""}`,
      );
      return;
    }

    router.push(
      `/channel/${channel.id}?hubId=${hub.id}&name=${encodeURIComponent(
        channel.name,
      )}${isForum ? "&forum=1" : ""}`,
    );
  };

  return (
    <View
      style={[
        styles.room,
        selectedInSplit && styles.roomSelected,
        isVoice && styles.voiceRoom,
        connected && styles.voiceConnected,
      ]}
    >
      <Pressable accessibilityRole="button"
        style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
          styles.roomMain,
          (pressed || hovered) && styles.roomPressed,
        ]}
        onPress={openRoom}
      >
        <View
          style={[
            styles.roomIcon,
            isVoice && styles.voiceIcon,
            connected && styles.voiceIconConnected,
            accent && !connected && { borderColor: accent, backgroundColor: `${accent}26` },
          ]}
        >
          {roomIcon ? (
            <Text style={styles.roomEmoji}>{roomIcon}</Text>
          ) : (
            <Ionicons
              name={isVoice ? "volume-high" : isForum ? "albums" : "chatbubble-ellipses"}
              size={18}
              color={connected ? colors.green : (accent ?? colors.cyan)}
            />
          )}
        </View>

        <View style={styles.roomCopy}>
          <View style={styles.roomNameRow}>
            <Text style={[styles.roomName, unreadCount > 0 && { color: colors.strong }]} numberOfLines={1}>
              {channel.name}
            </Text>
            {hasDraft && <Text maxFontSizeMultiplier={1.3} style={styles.draftTag}>{t("hub.mobile.rooms.draft")}</Text>}
            {unreadCount > 0 && (
              <View style={styles.unreadBadge}>
                <Text maxFontSizeMultiplier={1.3} style={styles.unreadBadgeText}>{unreadCount > 99 ? "99+" : unreadCount}</Text>
              </View>
            )}

            {channel.private && (
              <View style={styles.privateBadge}>
                <Ionicons name="lock-closed" size={10} color={colors.muted} />
                <Text style={styles.privateText}>{t("hub.sidebar.private")}</Text>
              </View>
            )}
          </View>

          <Text style={[styles.roomMeta, connected && styles.connectedText]}>
            {isVoice
              ? connected
                ? t("hub.mobile.rooms.connected")
                : participants.length > 0
                  ? t("hub.voicePanel.peopleInVoice", { count: participants.length })
                  : t("hub.mobile.rooms.voiceJoin")
              : isForum
                ? t("hub.roomSettings.type.forum.label")
                : t("hub.mobile.rooms.textRoom")}
          </Text>

          {isVoice && participants.length > 0 && (
            <View style={styles.voiceOccupancy}>
              <View style={styles.voiceAvatarStack}>
                {participants.slice(0, 3).map((participant, index) => (
                  <View
                    key={participant.connectionId}
                    style={[
                      styles.voiceAvatarWrap,
                      index > 0 && styles.voiceAvatarOverlap,
                    ]}
                  >
                    <Avatar
                      username={participant.username}
                      avatarUrl={participant.avatarUrl}
                      size={24}
                    />
                  </View>
                ))}
                {participants.length > 3 && (
                  <View style={[styles.voiceMore, styles.voiceAvatarOverlap]}>
                    <Text style={styles.voiceMoreText}>
                      +{participants.length - 3}
                    </Text>
                  </View>
                )}
              </View>

              <Text style={styles.voiceNames} numberOfLines={1}>
                {participants
                  .slice(0, 3)
                  .map((participant) => participant.username)
                  .join(", ")}
                {participants.length > 3 ? "…" : ""}
              </Text>
            </View>
          )}
        </View>
      </Pressable>

      <View style={styles.roomActions}>
        {connected && (
          <View style={styles.connectedBadge}>
            <View style={styles.connectedDot} />
            <Text maxFontSizeMultiplier={1.3} style={styles.connectedBadgeText}>{t("hub.sidebar.voice.live")}</Text>
          </View>
        )}

        {canManage ? (
          <Pressable
            style={styles.editRoomButton}
            onPress={onEdit}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t("hub.mobile.rooms.edit", { name: channel.name })}
          >
            <Ionicons name="ellipsis-horizontal" size={18} color={colors.text} />
          </Pressable>
        ) : (
          !connected && (
            <View style={styles.chevronWrap}>
              <Ionicons name="chevron-forward" size={18} color={colors.muted} />
            </View>
          )
        )}
      </View>
    </View>
  );
}

export function EmptySection({ text }: { text: string }) {
  return (
    <View style={styles.emptySection}>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}
