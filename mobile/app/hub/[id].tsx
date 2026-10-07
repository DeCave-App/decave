import {
  useWindowDimensions,
  Alert,
  View,
  Text,
  Pressable,
  ActivityIndicator,
  Image,
  ScrollView,
  RefreshControl,
} from "react-native";
import {
  SPLIT_MIN_WIDTH,
  type SplitRoom,
  type HubMember,
  type RoomType,
  roomTypeOf,
  byPosition,
  SplitContext,
  assetUrl,
} from "@/src/components/hub/hubShared";
import { useState, useMemo, useCallback, useEffect } from "react";
import { useLocalSearchParams, router } from "expo-router";
import { useSession } from "@/src/providers/SessionProvider";
import { useRealtime } from "@/src/providers/RealtimeProvider";
import { useVoice } from "@/src/providers/VoiceProvider";
import type { Hub, Channel, ForumPostPolicy } from "@/src/types";
import { apiJson } from "@/src/lib/api";
import { LoungeShell } from "@/src/components/LoungeShell";
import { Screen } from "@/src/components/Screen";
import { styles } from "@/src/components/hub/hubScreen.styles";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/src/theme";
import { ChannelSection, EmptySection, ChannelRow } from "@/src/components/hub/ChannelList";
import { ManageHubSheet } from "@/src/components/hub/ManageHubSheet";
import { RoomEditorSheet } from "@/src/components/hub/RoomEditorSheet";
import { ChannelView } from "@/app/channel/[id]";

export default function HubScreen() {
  const { width } = useWindowDimensions();
  const split = width >= SPLIT_MIN_WIDTH;
  const [splitRoom, setSplitRoom] = useState<SplitRoom | null>(null);
  const splitValue = useMemo(() => (split ? { selected: splitRoom, select: setSplitRoom } : null), [split, splitRoom]);
  const params = useLocalSearchParams<{ id: string }>();
  const hubId = Number(params.id);
  const { token } = useSession();
  const { send } = useRealtime();
  const { voiceChannelId, voiceStatus, participants } = useVoice();

  const [hub, setHub] = useState<Hub | null>(null);
  const [loadError, setLoadError] = useState("");

  const [manageHubOpen, setManageHubOpen] = useState(false);
  const [hubName, setHubName] = useState("");
  const [hubDescription, setHubDescription] = useState("");
  const [hubCategory, setHubCategory] = useState("");
  const [hubVisibility, setHubVisibility] =
    useState<"private" | "public">("private");
  const [hubSaving, setHubSaving] = useState(false);
  const [hubManageError, setHubManageError] = useState("");

  const [members, setMembers] = useState<HubMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);

  const [roomEditorOpen, setRoomEditorOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState<Channel | null>(null);
  const [roomName, setRoomName] = useState("");
  const [roomType, setRoomType] = useState<RoomType>("text");
  const [roomIcon, setRoomIcon] = useState("💬");
  const [roomGuidelines, setRoomGuidelines] = useState("");
  const [roomPostPolicy, setRoomPostPolicy] = useState<ForumPostPolicy>("everyone");
  const [roomPrivate, setRoomPrivate] = useState(false);
  const [roomMemberIds, setRoomMemberIds] = useState<string[]>([]);
  const [roomBusy, setRoomBusy] = useState(false);
  const [roomError, setRoomError] = useState("");

  const [refreshing, setRefreshing] = useState(false);
  const loadHub = useCallback(async () => {
    if (!token || !hubId) return;
    setLoadError("");

    try {
      const value = await apiJson<Hub>(`/api/servers/${hubId}`, {}, token);
      setHub(value);
      send({ type: "JOIN_SERVER", serverId: hubId });
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "Could not load this Hub.",
      );
    }
  }, [token, hubId, send]);

  useEffect(() => {
    void loadHub();
  }, [loadHub]);

  const textChannels = useMemo(
    () => hub?.channels.filter((channel) => roomTypeOf(channel) === "text").sort(byPosition) ?? [],
    [hub],
  );

  const forumChannels = useMemo(
    () => hub?.channels.filter((channel) => roomTypeOf(channel) === "forum").sort(byPosition) ?? [],
    [hub],
  );

  const voiceChannels = useMemo(
    () => hub?.channels.filter((channel) => roomTypeOf(channel) === "voice").sort(byPosition) ?? [],
    [hub],
  );

  const canManageHub =
    hub?.myRole === "owner" || hub?.myRole === "admin";
  const isHubOwner = hub?.myRole === "owner";

  const selectableMembers = useMemo(
    () => members.filter((member) => member.role === "member"),
    [members],
  );

  const loadMembers = async () => {
    if (!token || !hub) return;
    setMembersLoading(true);
    try {
      const values = await apiJson<HubMember[]>(
        `/api/servers/${hub.id}/members`,
        {},
        token,
      );
      setMembers(Array.isArray(values) ? values : []);
    } catch (error) {
      setRoomError(
        error instanceof Error ? error.message : "Could not load Hub members.",
      );
    } finally {
      setMembersLoading(false);
    }
  };

  const openHubManager = () => {
    if (!hub || !canManageHub) return;
    router.push(`/hub-admin/${hub.id}` as any); // DECAVE_PARITY_HUB_ADMIN
  };

  const saveHub = async () => {
    if (!token || !hub || !canManageHub || hubSaving) return;
    const name = hubName.trim();
    if (!name) {
      setHubManageError("Enter a Hub name.");
      return;
    }

    setHubSaving(true);
    setHubManageError("");

    try {
      await apiJson<Hub>(
        `/api/servers/${hub.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            icon: hub.icon,
          }),
        },
        token,
      );

      await apiJson<Hub>(
        `/api/servers/${hub.id}/settings`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            description: hubDescription.trim(),
            category: hubCategory.trim() || "Gaming",
          }),
        },
        token,
      );

      if (isHubOwner && hubVisibility !== hub.visibility) {
        await apiJson<Hub>(
          `/api/servers/${hub.id}/visibility`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ visibility: hubVisibility }),
          },
          token,
        );
      }

      await loadHub();
      setManageHubOpen(false);
    } catch (error) {
      setHubManageError(
        error instanceof Error ? error.message : "Could not update the Hub.",
      );
    } finally {
      setHubSaving(false);
    }
  };

  const openCreateRoom = async (type: RoomType = "text") => {
    setEditingRoom(null);
    setRoomName("");
    setRoomType(type);
    setRoomIcon(type === "voice" ? "🔊" : type === "forum" ? "📌" : "💬");
    setRoomGuidelines("");
    setRoomPostPolicy("everyone");
    setRoomPrivate(false);
    setRoomMemberIds([]);
    setRoomError("");
    setRoomEditorOpen(true);
    await loadMembers();
  };

  const openEditRoom = async (channel: Channel) => {
    if (!token || !canManageHub) return;
    setEditingRoom(channel);
    setRoomName(channel.name);
    setRoomType(roomTypeOf(channel));
    setRoomIcon(channel.icon ?? "");
    setRoomGuidelines(channel.forumGuidelines ?? "");
    setRoomPostPolicy(channel.forumPostPolicy ?? "everyone");
    setRoomPrivate(Boolean(channel.private));
    setRoomMemberIds([]);
    setRoomError("");
    setRoomEditorOpen(true);

    await loadMembers();

    try {
      const access = await apiJson<{ private?: boolean; memberIds?: string[] }>(
        `/api/channels/${channel.id}/access`,
        {},
        token,
      );
      setRoomPrivate(access.private === true);
      setRoomMemberIds(
        Array.isArray(access.memberIds) ? access.memberIds : [],
      );
    } catch (error) {
      setRoomError(
        error instanceof Error
          ? error.message
          : "Could not load room access.",
      );
    }
  };

  const toggleRoomMember = (userId: string) => {
    setRoomMemberIds((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId],
    );
  };

  const saveRoom = async () => {
    if (!token || !hub || !canManageHub || roomBusy) return;
    const name = roomName.trim();

    if (!name) {
      setRoomError("Enter a room name.");
      return;
    }

    setRoomBusy(true);
    setRoomError("");

    try {
      if (editingRoom) {
        await apiJson(
          `/api/channels/${editingRoom.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name,
              icon: roomIcon,
              private: roomPrivate,
              memberIds: roomPrivate ? roomMemberIds : [],
              ...(roomType === "forum"
                ? {
                    forumGuidelines: roomGuidelines,
                    // Role/member lists are only editable on desktop; keep them as-is.
                    ...(roomPostPolicy === "everyone" || roomPostPolicy === "staff"
                      ? { forumPostPolicy: roomPostPolicy }
                      : {}),
                  }
                : {}),
            }),
          },
          token,
        );
      } else {
        await apiJson(
          `/api/servers/${hub.id}/channels`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name,
              type: roomType,
              icon: roomIcon,
              private: roomPrivate,
              memberIds: roomPrivate ? roomMemberIds : [],
              ...(roomType === "forum"
                ? { forumGuidelines: roomGuidelines, forumPostPolicy: roomPostPolicy }
                : {}),
            }),
          },
          token,
        );
      }

      await loadHub();
      setRoomEditorOpen(false);
    } catch (error) {
      setRoomError(
        error instanceof Error ? error.message : "Could not save the room.",
      );
    } finally {
      setRoomBusy(false);
    }
  };

  const roomGroup = (type: RoomType) =>
    type === "voice" ? voiceChannels : type === "forum" ? forumChannels : textChannels;

  const moveRoom = async (direction: -1 | 1) => {
    if (!token || !hub || !editingRoom || roomBusy) return;
    const ordered = [...roomGroup(roomTypeOf(editingRoom))];
    const from = ordered.findIndex((room) => room.id === editingRoom.id);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= ordered.length) return;
    const [moved] = ordered.splice(from, 1);
    ordered.splice(to, 0, moved);
    setRoomBusy(true);
    setRoomError("");
    try {
      await apiJson(
        `/api/servers/${hub.id}/channels/reorder`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderedIds: ordered.map((room) => room.id) }),
        },
        token,
      );
      await loadHub();
    } catch (error) {
      setRoomError(
        error instanceof Error ? error.message : "Could not move the room.",
      );
    } finally {
      setRoomBusy(false);
    }
  };

  const editingIndex = editingRoom
    ? roomGroup(roomTypeOf(editingRoom)).findIndex((room) => room.id === editingRoom.id)
    : -1;
  const editingGroupSize = editingRoom ? roomGroup(roomTypeOf(editingRoom)).length : 0;

  const deleteRoom = () => {
    if (!token || !editingRoom || roomBusy) return;

    Alert.alert(
      `Delete ${editingRoom.name}?`,
      "Messages saved in this room may also be removed. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void (async () => {
              if (!token || !editingRoom) return;
              setRoomBusy(true);
              setRoomError("");
              try {
                await apiJson(
                  `/api/channels/${editingRoom.id}`,
                  { method: "DELETE" },
                  token,
                );
                await loadHub();
                setRoomEditorOpen(false);
              } catch (error) {
                setRoomError(
                  error instanceof Error
                    ? error.message
                    : "Could not delete the room.",
                );
              } finally {
                setRoomBusy(false);
              }
            })();
          },
        },
      ],
    );
  };

  if (!hub) {
    return (
      <LoungeShell>
      <Screen>
        <View style={styles.loading}>
          {loadError ? (
            <>
              <Ionicons
                name="warning-outline"
                size={28}
                color={colors.red}
              />
              <Text style={styles.loadError}>{loadError}</Text>
              <Pressable accessibilityRole="button" style={styles.retryButton} onPress={() => void loadHub()}>
                <Text style={styles.retryButtonText}>Try again</Text>
              </Pressable>
            </>
          ) : (
            <ActivityIndicator color={colors.cyan} />
          )}
        </View>
      </Screen>
    </LoungeShell>
    );
  }

  return (
    <LoungeShell>
      <Screen>
      <SplitContext.Provider value={splitValue}>
      <View style={split ? styles.splitRow : styles.splitFill}>
      <View style={split ? styles.splitList : styles.splitFill}>
      <View style={styles.top}>
        <Pressable
          style={styles.backButton}
          onPress={() => router.back()}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={23} color={colors.cyan} />
        </Pressable>

        <View style={styles.hubIconWrap}>
          {assetUrl(hub.iconUrl) ? (
            <Image
              source={{ uri: assetUrl(hub.iconUrl)! }}
              style={styles.hubIconImage}
            />
          ) : (
            <View
              style={[
                styles.hubIconFallback,
                hub.accent ? { backgroundColor: hub.accent } : null,
              ]}
            >
              <Text style={styles.hubIconFallbackText}>
                {(hub.icon || hub.name || "H").slice(0, 1).toUpperCase()}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.topCopy}>
          <View style={styles.titleRow}>
            <Text style={styles.title} numberOfLines={1} maxFontSizeMultiplier={1.4}>
              {hub.name}
            </Text>
            {hub.visibility === "private" && (
              <Ionicons name="lock-closed" size={13} color={colors.faint} />
            )}
          </View>
          <Text style={styles.meta} numberOfLines={1} maxFontSizeMultiplier={1.3}>
            {hub.onlineCount ?? 0} online · {hub.memberCount ?? 0} members
            {hub.myRole ? ` · ${hub.myRole.toUpperCase()}` : ""}
          </Text>
        </View>

        {canManageHub && (
          <Pressable
            style={styles.manageButton}
            onPress={openHubManager}
            accessibilityRole="button"
            accessibilityLabel="Manage Hub"
          >
            <Ionicons name="settings-outline" size={19} color={colors.text} />
          </Pressable>
        )}
      </View>

      <ScrollView keyboardDismissMode="on-drag"
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.cyan} onRefresh={() => { setRefreshing(true); void loadHub().finally(() => setRefreshing(false)); }} />}
      >
        {!!hub.description && (
          <View style={styles.descriptionCard}>
            <Text style={styles.description}>{hub.description}</Text>
          </View>
        )}

        {canManageHub && (
          <Pressable accessibilityRole="button" style={styles.adminStrip} onPress={openHubManager}>
            <View style={styles.adminStripIcon}>
              <Ionicons name="construct-outline" size={18} color={colors.cyan} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.adminStripTitle}>Manage this Hub</Text>
              <Text style={styles.adminStripText}>
                Edit Hub details, create rooms, and manage existing rooms.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
          </Pressable>
        )}

        <ChannelSection
          title="TEXT ROOMS"
          icon="chatbubble-ellipses-outline"
          count={textChannels.length}
          canManage={canManageHub}
          onAdd={() => void openCreateRoom("text")}
        >
          {textChannels.length === 0 ? (
            <EmptySection text="No text rooms in this Hub." />
          ) : (
            textChannels.map((channel) => (
              <ChannelRow
                key={channel.id}
                channel={channel}
                hub={hub}
                connected={false}
                participants={[]}
                canManage={canManageHub}
                onEdit={() => void openEditRoom(channel)}
              />
            ))
          )}
        </ChannelSection>

        {(forumChannels.length > 0 || canManageHub) && (
          <ChannelSection
            title="FORUMS"
            icon="albums-outline"
            count={forumChannels.length}
            canManage={canManageHub}
            onAdd={() => void openCreateRoom("forum")}
          >
            {forumChannels.length === 0 ? (
              <EmptySection text="No forums in this Hub." />
            ) : (
              forumChannels.map((channel) => (
                <ChannelRow
                  key={channel.id}
                  channel={channel}
                  hub={hub}
                  connected={false}
                  participants={[]}
                  canManage={canManageHub}
                  onEdit={() => void openEditRoom(channel)}
                />
              ))
            )}
          </ChannelSection>
        )}

        <ChannelSection
          title="VOICE ROOMS"
          icon="volume-high-outline"
          count={voiceChannels.length}
          canManage={canManageHub}
          onAdd={() => void openCreateRoom("voice")}
        >
          {voiceChannels.length === 0 ? (
            <EmptySection text="No voice rooms in this Hub." />
          ) : (
            voiceChannels.map((channel) => {
              const connected =
                voiceChannelId === channel.id &&
                voiceStatus === "connected";

              return (
                <ChannelRow
                  key={channel.id}
                  channel={channel}
                  hub={hub}
                  connected={connected}
                  participants={participants.filter(
                    (participant) => participant.channelId === channel.id,
                  )}
                  canManage={canManageHub}
                  onEdit={() => void openEditRoom(channel)}
                />
              );
            })
          )}
        </ChannelSection>
      </ScrollView>

      <ManageHubSheet
        visible={manageHubOpen}
        hub={hub}
        isOwner={isHubOwner}
        name={hubName}
        description={hubDescription}
        category={hubCategory}
        visibility={hubVisibility}
        busy={hubSaving}
        error={hubManageError}
        onName={setHubName}
        onDescription={setHubDescription}
        onCategory={setHubCategory}
        onVisibility={setHubVisibility}
        onClose={() => {
          if (!hubSaving) setManageHubOpen(false);
        }}
        onSave={() => void saveHub()}
        onCreateRoom={() => {
          setManageHubOpen(false);
          void openCreateRoom("text");
        }}
      />

      <RoomEditorSheet
        visible={roomEditorOpen}
        editing={editingRoom}
        name={roomName}
        type={roomType}
        icon={roomIcon}
        guidelines={roomGuidelines}
        postPolicy={roomPostPolicy}
        canMoveUp={editingIndex > 0}
        canMoveDown={editingIndex >= 0 && editingIndex < editingGroupSize - 1}
        isPrivate={roomPrivate}
        memberIds={roomMemberIds}
        members={selectableMembers}
        membersLoading={membersLoading}
        busy={roomBusy}
        error={roomError}
        onName={setRoomName}
        onType={(value) => {
          setRoomType(value);
          if (!editingRoom) setRoomIcon(value === "voice" ? "🔊" : value === "forum" ? "📌" : "💬");
        }}
        onIcon={setRoomIcon}
        onGuidelines={setRoomGuidelines}
        onPostPolicy={setRoomPostPolicy}
        onMove={(direction) => void moveRoom(direction)}
        onPrivate={setRoomPrivate}
        onToggleMember={toggleRoomMember}
        onClose={() => {
          if (!roomBusy) setRoomEditorOpen(false);
        }}
        onSave={() => void saveRoom()}
        onDelete={deleteRoom}
      />
      </View>
      {split && (
        <View style={styles.splitPane}>
          {splitRoom ? (
            <ChannelView
              key={splitRoom.id}
              embedded
              params={{ id: String(splitRoom.id), hubId: String(hub.id), name: splitRoom.name, forum: splitRoom.forum ? "1" : undefined, squad: hub.isSquad ? "1" : undefined }}
            />
          ) : (
            <View style={styles.splitEmpty}>
              <Ionicons name="chatbubbles-outline" size={34} color={colors.faint} />
              <Text style={styles.splitEmptyText}>Pick a room to start chatting</Text>
            </View>
          )}
        </View>
      )}
      </View>
      </SplitContext.Provider>
    </Screen>
    </LoungeShell>
  );
}
