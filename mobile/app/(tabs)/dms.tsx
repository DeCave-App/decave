import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  useWindowDimensions,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Screen } from "@/src/components/Screen";
import { Avatar } from "@/src/components/Avatar";
import { apiJson } from "@/src/lib/api";
import { useSession } from "@/src/providers/SessionProvider";
import { useRealtime } from "@/src/providers/RealtimeProvider";
import { useUnread } from "@/src/providers/UnreadProvider";
import { SkeletonRows } from "@/src/components/Skeleton";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import { useMutedUsers } from "@/src/providers/MutedUsersProvider";
import { successHaptic, tapHaptic } from "@/src/lib/haptics";
import { DmView } from "@/app/dm/[id]";
import { LoadError } from "@/src/components/LoadError";
import { colors } from "@/src/theme";
import { useDrafts } from "@/src/lib/drafts";
import type {
  AccountUser,
  DmConversation,
  GroupChat,
  SocialState,
} from "@/src/types";
import { decryptConversationPreviews, groupPreview, rememberGroup } from "@/src/lib/e2ee/client";

type DmPreference = { favorite: boolean; archived: boolean };
type ListFilter = "all" | "unread" | "requests";
type ListView = "chats" | "archived" | "groups";

function formatRelativeTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";

  const diff = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(diff / 60_000);

  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;

  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

const SPLIT_MIN_WIDTH = 700;

export default function DmsScreen() {
  const { width } = useWindowDimensions();
  const split = width >= SPLIT_MIN_WIDTH;
  const [splitDm, setSplitDm] = useState<{ id: string; username: string } | null>(null);
  const { token } = useSession();
  const { dms: unreadDms, markDmRead } = useUnread();
  const { mutedIds, toggleMute } = useMutedUsers();
  const drafts = useDrafts();
  const { lastEvent } = useRealtime();

  const [items, setItems] = useState<DmConversation[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [groups, setGroups] = useState<GroupChat[]>([]);
  const [friends, setFriends] = useState<AccountUser[]>([]);
  const [incoming, setIncoming] = useState<AccountUser[]>([]);
  const [prefs, setPrefs] = useState<Record<string, DmPreference>>({});
  const [filter, setFilter] = useState<ListFilter>("all");
  const [view, setView] = useState<ListView>("chats");
  const [refreshing, setRefreshing] = useState(false);

  const [composerOpen, setComposerOpen] = useState(false);
  const [friendQuery, setFriendQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [groupName, setGroupName] = useState("");
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState("");

  const load = async () => {
    if (!token) return;

    try {
      const [dmData, groupData, socialData] = await Promise.all([
        apiJson<{ conversations: DmConversation[] }>("/api/dms", {}, token),
        apiJson<{ groups: GroupChat[] }>("/api/groups", {}, token),
        apiJson<SocialState>("/api/social", {}, token),
      ]);

      setItems(await decryptConversationPreviews(dmData.conversations ?? []));
      // Encrypted group previews are decrypted on the phone.
      const groupList = groupData.groups ?? [];
      const previews = await Promise.all(groupList.map((group) => groupPreview(group)));
      groupList.forEach(rememberGroup);
      setGroups(groupList.map((group, index) => ({ ...group, latestMessage: previews[index] })));
      setFriends(socialData.friends ?? []);
      setIncoming(socialData.incoming ?? []);
      setLoadError("");
      // Favorites / archived are non-critical; keep the list usable if this fails.
      apiJson<{ preferences?: Array<{ userId: string; favorite: boolean; archived: boolean }> }>("/api/social/dm-preferences", {}, token)
        .then((data) => {
          const next: Record<string, DmPreference> = {};
          for (const item of data.preferences ?? []) {
            if (item?.userId) next[item.userId] = { favorite: item.favorite === true, archived: item.archived === true };
          }
          setPrefs(next);
        })
        .catch(() => {});
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load conversations.");
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => {
    void load();
  }, [token]);

  useEffect(() => {
    const type = lastEvent?.type;

    if (
      type === "DM_MESSAGE" ||
      type === "DM_MESSAGE_UPDATED" ||
      type === "GROUP_MESSAGE" ||
      type === "GROUP_CHAT_UPDATED" ||
      type === "GROUP_CHAT_REMOVED" ||
      type === "SOCIAL_REFRESH" ||
      type === "SOCIAL_STATE"
    ) {
      void load();
    }
  }, [lastEvent]);

  const archivedCount = useMemo(
    () => items.filter((dm) => prefs[dm.user.id]?.archived).length,
    [items, prefs],
  );

  const visibleDms = useMemo(() => {
    const archived = view === "archived";
    return items
      .filter((dm) => (prefs[dm.user.id]?.archived ?? false) === archived)
      .filter((dm) => archived || filter !== "unread" || !!unreadDms[dm.user.id])
      .sort(
        (a, b) =>
          Number(prefs[b.user.id]?.favorite ?? false) - Number(prefs[a.user.id]?.favorite ?? false) ||
          Date.parse(b.latestTimestamp || "") - Date.parse(a.latestTimestamp || ""),
      );
  }, [items, prefs, view, filter, unreadDms]);

  const sortedGroups = useMemo(
    () => [...groups].sort((a, b) => Date.parse(b.latestTimestamp || "") - Date.parse(a.latestTimestamp || "")),
    [groups],
  );

  const unreadTotal = useMemo(
    () => items.filter((dm) => !(prefs[dm.user.id]?.archived ?? false) && !!unreadDms[dm.user.id]).length,
    [items, prefs, unreadDms],
  );

  const updatePref = async (userId: string, patch: Partial<DmPreference>) => {
    if (!token) return;
    const previous = prefs[userId] ?? { favorite: false, archived: false };
    setPrefs((current) => ({ ...current, [userId]: { ...previous, ...patch } }));
    try {
      await apiJson(`/api/social/dm-preferences/${encodeURIComponent(userId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }, token);
      successHaptic();
    } catch (error) {
      setPrefs((current) => ({ ...current, [userId]: previous }));
      Alert.alert("Could not update chat", error instanceof Error ? error.message : "Please try again.");
    }
  };

  const respondToRequest = async (user: AccountUser, action: "accept" | "reject") => {
    if (!token) return;
    try {
      await apiJson(`/api/friends/${encodeURIComponent(user.id)}/${action}`, { method: "POST" }, token);
      await load();
    } catch (error) {
      Alert.alert("Could not update request", error instanceof Error ? error.message : "Please try again.");
    }
  };

  const filteredFriends = useMemo(() => {
    const query = friendQuery.trim().toLowerCase();
    if (!query) return friends;

    return friends.filter((friend) =>
      friend.username.toLowerCase().includes(query),
    );
  }, [friendQuery, friends]);

  const selectedFriends = useMemo(
    () => friends.filter((friend) => selectedIds.includes(friend.id)),
    [friends, selectedIds],
  );

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const openComposer = () => {
    setSelectedIds([]);
    setGroupName("");
    setFriendQuery("");
    setNotice("");
    setComposerOpen(true);
  };

  const closeComposer = () => {
    setComposerOpen(false);
    setFriendQuery("");
    setSelectedIds([]);
    setGroupName("");
    setNotice("");
  };

  const openDirect = (friend: AccountUser) => {
    closeComposer();
    router.push(
      `/dm/${encodeURIComponent(friend.id)}?username=${encodeURIComponent(
        friend.username,
      )}`,
    );
  };

  const toggleGroupMember = (userId: string) => {
    setSelectedIds((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId],
    );
  };

  const createGroup = async () => {
    if (!token || selectedIds.length < 2 || creating) return;

    setCreating(true);
    setNotice("");

    try {
      const data = await apiJson<{ group: GroupChat }>(
        "/api/groups",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: groupName.trim(),
            memberIds: selectedIds,
          }),
        },
        token,
      );

      closeComposer();
      await load();
      router.push(`/group/${encodeURIComponent(data.group.id)}`);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Could not create group chat.",
      );
    } finally {
      setCreating(false);
    }
  };

  return (
    <Screen>
      <View style={split ? styles.splitRow : styles.splitFill}>
      <ScrollView keyboardDismissMode="on-drag"
        style={split ? styles.splitList : undefined}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor={colors.cyan}
          />
        }
      >
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text maxFontSizeMultiplier={1.3} style={styles.kicker}>PRIVATE CHAT</Text>
            <Text style={styles.title}>Messages</Text>
            <Text style={styles.subtitle}>
              Your direct messages, favorites first.
            </Text>
          </View>

          <Pressable
            style={styles.plus}
            onPress={openComposer}
           
            accessibilityRole="button"
            accessibilityLabel="Start a new conversation"
          >
            <Ionicons name="create-outline" size={22} color="#fff" />
          </Pressable>
        </View>

        

        {view === "chats" ? (
          <View style={styles.chips} accessibilityRole="tablist">
            {(["all", "unread", "requests"] as const).map((key) => {
              const active = filter === key;
              const label =
                key === "all"
                  ? "All"
                  : key === "unread"
                    ? `Unread${unreadTotal ? ` · ${unreadTotal}` : ""}`
                    : `Requests${incoming.length ? ` · ${incoming.length}` : ""}`;
              return (
                <Pressable
                  key={key}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => setFilter(key)}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : (
          <Pressable accessibilityRole="button" style={styles.backRow} onPress={() => setView("chats")}>
            <Ionicons name="chevron-back" size={16} color={colors.cyan} />
            <Text style={styles.backRowText}>Back to chats</Text>
            <Text style={styles.backRowTitle}>{view === "archived" ? "Archived" : "Group chats"}</Text>
          </Pressable>
        )}

        {!loaded ? (
          <SkeletonRows rows={6} />
        ) : loadError && items.length === 0 && groups.length === 0 ? (
          <LoadError message={loadError} onRetry={() => void load()} />
        ) : view === "chats" && filter === "requests" ? (
          incoming.length === 0 ? (
            <Text style={styles.listEmpty}>No message requests right now.</Text>
          ) : (
            <View style={styles.conversationList}>
              {incoming.map((user) => (
                <View key={user.id} style={styles.row}>
                  <Avatar username={user.username} avatarUrl={user.avatarUrl} online={user.online} size={46} />
                  <View style={styles.rowCopy}>
                    <Text style={styles.name} numberOfLines={1}>{user.username}</Text>
                    <Text style={styles.preview} numberOfLines={1}>Wants to be friends</Text>
                  </View>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Accept ${user.username}`} style={styles.acceptButton} onPress={() => void respondToRequest(user, "accept")}>
                    <Text style={styles.acceptText}>Accept</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Ignore ${user.username}`} style={styles.ignoreButton} onPress={() => void respondToRequest(user, "reject")}>
                    <Text style={styles.ignoreText}>Ignore</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )
        ) : view === "groups" ? (
          <View style={styles.conversationList}>
            {sortedGroups.map((group) => (
              <Pressable accessibilityRole="button"
                key={group.id}
                style={({ pressed }) => [
                  styles.row,
                  pressed && styles.rowPressed,
                ]}
                onPress={() =>
                  router.push(`/group/${encodeURIComponent(group.id)}`)
                }
              >
                <View style={styles.groupAvatar}>
                  <Ionicons
                    name="people"
                    size={21}
                    color={colors.cyan}
                  />
                </View>

                <View style={styles.rowCopy}>
                  <View style={styles.rowHead}>
                    <Text style={styles.name} numberOfLines={1}>
                      {group.name}
                    </Text>
                    <Text style={styles.time}>
                      {formatRelativeTime(group.latestTimestamp)}
                    </Text>
                  </View>

                  <Text style={styles.preview} numberOfLines={1}>
                    {drafts[`group:${group.id}`] ? (
                      <Text maxFontSizeMultiplier={1.3} style={styles.draftTag}>Draft: <Text style={styles.preview}>{drafts[`group:${group.id}`]}</Text></Text>
                    ) : (
                      group.latestMessage || `${group.memberCount} members`
                    )}
                  </Text>
                </View>

                <View style={styles.memberBadge}>
                  <Ionicons
                    name="people-outline"
                    size={11}
                    color={colors.muted}
                  />
                  <Text maxFontSizeMultiplier={1.3} style={styles.memberBadgeText}>
                    {group.memberCount}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
        ) : items.length === 0 && groups.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Ionicons
                name="chatbubbles-outline"
                size={28}
                color={colors.cyan}
              />
            </View>
            <Text style={styles.emptyTitle}>No conversations yet</Text>
            <Text style={styles.emptyText}>
              Start a DM with a friend or create a group conversation.
            </Text>
            <View style={styles.emptyActions}>
              <Pressable accessibilityRole="button" style={styles.emptyAction} onPress={openComposer}>
                <Text style={styles.emptyActionText}>New conversation</Text>
              </Pressable>
              <Pressable accessibilityRole="button" style={[styles.emptyAction, styles.emptyActionSecondary]} onPress={() => router.navigate("/friends")}>
                <Text style={[styles.emptyActionText, styles.emptyActionSecondaryText]}>Add friends</Text>
              </Pressable>
            </View>
          </View>
        ) : visibleDms.length === 0 ? (
          <Text style={styles.listEmpty}>
            {view === "archived" ? "No archived chats." : filter === "unread" ? "You have no unread conversations." : "No conversations yet. Use the compose button to message a friend."}
          </Text>
        ) : (
          <View style={styles.conversationList}>
            {visibleDms.map((item) => {
                const unreadHere = !!unreadDms[item.user.id];
                const mutedHere = mutedIds.has(item.user.id);
                const favorite = prefs[item.user.id]?.favorite ?? false;
                const archived = prefs[item.user.id]?.archived ?? false;
                return (
                  <ReanimatedSwipeable
                    key={item.user.id}
                    friction={2}
                    rightThreshold={40}
                    overshootRight={false}
                    renderRightActions={(_progress, _drag, swipeable) => (
                      <View style={styles.swipeActions}>
                        {unreadHere && (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Mark ${item.user.username} as read`}
                            style={[styles.swipeAction, { backgroundColor: colors.violet }]}
                            onPress={() => {
                              tapHaptic();
                              swipeable.close();
                              markDmRead(item.user.id);
                            }}
                          >
                            <Ionicons name="checkmark-done" size={18} color="#fff" />
                            <Text style={styles.swipeActionText}>Read</Text>
                          </Pressable>
                        )}
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={favorite ? `Unfavorite ${item.user.username}` : `Favorite ${item.user.username}`}
                          style={[styles.swipeAction, { backgroundColor: colors.panel2 }]}
                          onPress={() => {
                            swipeable.close();
                            void updatePref(item.user.id, { favorite: !favorite });
                          }}
                        >
                          <Ionicons name={favorite ? "star" : "star-outline"} size={18} color={colors.yellow} />
                          <Text style={[styles.swipeActionText, { color: colors.text }]}>{favorite ? "Unstar" : "Star"}</Text>
                        </Pressable>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={archived ? `Unarchive ${item.user.username}` : `Archive ${item.user.username}`}
                          style={[styles.swipeAction, { backgroundColor: colors.panel2 }]}
                          onPress={() => {
                            swipeable.close();
                            void updatePref(item.user.id, { archived: !archived });
                          }}
                        >
                          <Ionicons name={archived ? "arrow-undo-outline" : "archive-outline"} size={18} color={colors.text} />
                          <Text style={[styles.swipeActionText, { color: colors.text }]}>{archived ? "Restore" : "Archive"}</Text>
                        </Pressable>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={mutedHere ? `Unmute ${item.user.username}` : `Mute ${item.user.username}`}
                          style={[styles.swipeAction, { backgroundColor: colors.panel2 }]}
                          onPress={() => {
                            swipeable.close();
                            toggleMute(item.user.id)
                              .then(() => successHaptic())
                              .catch((error) => Alert.alert("Could not update mute", error instanceof Error ? error.message : "Please try again."));
                          }}
                        >
                          <Ionicons name={mutedHere ? "notifications-outline" : "notifications-off-outline"} size={18} color={colors.text} />
                          <Text style={[styles.swipeActionText, { color: colors.text }]}>{mutedHere ? "Unmute" : "Mute"}</Text>
                        </Pressable>
                      </View>
                    )}
                  >
                  <Pressable accessibilityRole="button"
                    accessibilityLabel={`${item.user.username}${favorite ? ", favorite" : ""}`}
                    accessibilityHint="Swipe left for read, star, archive and mute"
                    style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                      styles.row,
                      (pressed || hovered) && styles.rowPressed,
                      split && splitDm?.id === item.user.id && styles.rowSelected,
                    ]}
                    onPress={() => {
                      if (split) {
                        setSplitDm({ id: item.user.id, username: item.user.username });
                        return;
                      }
                      router.push(
                        `/dm/${encodeURIComponent(
                          item.user.id,
                        )}?username=${encodeURIComponent(item.user.username)}`,
                      );
                    }}
                  >
                    <Avatar
                      username={item.user.username}
                      avatarUrl={item.user.avatarUrl}
                      online={item.user.online}
                      size={50}
                    />

                    <View style={styles.rowCopy}>
                      <View style={styles.rowHead}>
                        <View style={styles.groupNameRow}>
                          <Text style={styles.name} numberOfLines={1}>
                            {item.user.username}
                          </Text>
                          {favorite && <Ionicons name="star" size={12} color={colors.yellow} accessibilityElementsHidden />}
                        </View>
                        <Text style={styles.time}>
                          {formatRelativeTime(item.latestTimestamp)}
                        </Text>
                      </View>

                      <Text style={styles.preview} numberOfLines={1}>
                        {drafts[`dm:${item.user.id}`] ? (
                          <Text maxFontSizeMultiplier={1.3} style={styles.draftTag}>Draft: <Text style={styles.preview}>{drafts[`dm:${item.user.id}`]}</Text></Text>
                        ) : (
                          item.latestMessage || "Open conversation"
                        )}
                      </Text>
                    </View>

                    {unreadHere && (
                      <View style={styles.unreadBadge}>
                        <Text maxFontSizeMultiplier={1.3} style={styles.unreadBadgeText}>
                          {unreadDms[item.user.id] > 99 ? "99+" : unreadDms[item.user.id]}
                        </Text>
                      </View>
                    )}
                  </Pressable>
                  </ReanimatedSwipeable>
                );
            })}
          </View>
        )}

        {loaded && view === "chats" && filter !== "requests" && (
          <View style={styles.footLinks}>
            {groups.length > 0 && (
              <Pressable accessibilityRole="button" style={styles.footLink} onPress={() => setView("groups")}>
                <Ionicons name="people-outline" size={15} color={colors.muted} />
                <Text style={styles.footLinkText}>Group chats ({groups.length})</Text>
              </Pressable>
            )}
            <Pressable accessibilityRole="button" style={styles.footLink} onPress={() => setView("archived")}>
              <Ionicons name="archive-outline" size={15} color={colors.muted} />
              <Text style={styles.footLinkText}>Archived ({archivedCount})</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
      {split && (
        <View style={styles.splitPane}>
          {splitDm ? (
            <DmView key={splitDm.id} embedded params={{ id: splitDm.id, username: splitDm.username }} onClosed={() => { setSplitDm(null); void load(); }} />
          ) : (
            <View style={styles.splitEmpty}>
              <Ionicons name="chatbubbles-outline" size={34} color={colors.faint} />
              <Text style={styles.splitEmptyText}>Pick a conversation</Text>
            </View>
          )}
        </View>
      )}
      </View>

      <Modal
        visible={composerOpen}
        transparent
        animationType="fade"
        onRequestClose={closeComposer}
      >
        <Pressable style={styles.overlay} onPress={closeComposer}>
          <Pressable style={styles.modal} onPress={() => {}}>
            <View style={styles.modalGrabber} />

            <View style={styles.modalHeader}>
              <View style={styles.modalHeadingIcon}>
                <Ionicons
                  name="chatbubble-ellipses-outline"
                  size={22}
                  color={colors.cyan}
                />
              </View>

              <View style={{ flex: 1 }}>
                <Text maxFontSizeMultiplier={1.3} style={styles.modalKicker}>NEW CONVERSATION</Text>
                <Text style={styles.modalTitle}>Choose friends</Text>
              </View>

              <Pressable accessibilityRole="button" accessibilityLabel="Close"
                style={styles.modalClose}
                onPress={closeComposer}
                hitSlop={8}
              >
                <Ionicons name="close" size={20} color={colors.muted} />
              </Pressable>
            </View>

            <View style={styles.search}>
              <Ionicons name="search" size={18} color={colors.faint} />
              <TextInput
                value={friendQuery}
                onChangeText={setFriendQuery}
                placeholder="Search friends"
                placeholderTextColor={colors.faint}
                style={styles.searchInput}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {!!friendQuery && (
                <Pressable accessibilityRole="button" accessibilityLabel="Clear" onPress={() => setFriendQuery("")} hitSlop={8}>
                  <Ionicons
                    name="close-circle"
                    size={18}
                    color={colors.faint}
                  />
                </Pressable>
              )}
            </View>

            {selectedFriends.length > 0 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.selectedRail}
              >
                {selectedFriends.map((friend) => (
                  <Pressable accessibilityRole="button"
                    key={friend.id}
                    style={styles.selectedChip}
                    onPress={() => toggleGroupMember(friend.id)}
                  >
                    <Text style={styles.selectedChipText}>
                      {friend.username}
                    </Text>
                    <Ionicons
                      name="close"
                      size={13}
                      color={colors.muted}
                    />
                  </Pressable>
                ))}
              </ScrollView>
            )}

            <Text style={styles.modalHelp}>
              Tap Message for a 1-to-1 DM. Select at least two friends to
              create a group.
            </Text>

            <ScrollView keyboardDismissMode="on-drag"
              style={styles.friendList}
              contentContainerStyle={{ paddingBottom: 8 }}
              showsVerticalScrollIndicator={false}
            >
              {filteredFriends.length === 0 ? (
                <View style={styles.friendEmpty}>
                  <Text style={styles.friendEmptyText}>
                    {friends.length === 0
                      ? "Add friends first, then they will appear here."
                      : "No friends match your search."}
                  </Text>
                </View>
              ) : (
                filteredFriends.map((friend) => {
                  const selected = selectedIds.includes(friend.id);

                  return (
                    <View key={friend.id} style={styles.friendRow}>
                      <Pressable accessibilityRole="button" accessibilityLabel={selected ? `Deselect ${friend.username}` : `Select ${friend.username}`}
                        style={[
                          styles.check,
                          selected && styles.checkSelected,
                        ]}
                        onPress={() => toggleGroupMember(friend.id)}
                      >
                        {selected && (
                          <Ionicons
                            name="checkmark"
                            size={16}
                            color="#fff"
                          />
                        )}
                      </Pressable>

                      <Avatar
                        username={friend.username}
                        avatarUrl={friend.avatarUrl}
                        online={friend.online}
                        size={42}
                      />

                      <View style={styles.friendCopy}>
                        <Text style={styles.friendName} numberOfLines={1}>
                          {friend.username}
                        </Text>
                        <View style={styles.friendStatusRow}>
                          <View
                            style={[
                              styles.friendStatusDot,
                              !friend.online && styles.friendStatusDotOffline,
                            ]}
                          />
                          <Text style={styles.friendStatus}>
                            {friend.online ? "Online" : "Offline"}
                          </Text>
                        </View>
                      </View>

                      <Pressable accessibilityRole="button"
                        style={styles.messageButton}
                        onPress={() => openDirect(friend)}
                      >
                        <Ionicons
                          name="chatbubble-outline"
                          size={15}
                          color={colors.cyan}
                        />
                        <Text style={styles.messageButtonText}>Message</Text>
                      </Pressable>
                    </View>
                  );
                })
              )}
            </ScrollView>

            <View style={styles.groupArea}>
              <Text style={styles.fieldLabel}>GROUP NAME</Text>
              <TextInput
                value={groupName}
                onChangeText={setGroupName}
                placeholder="Optional group name"
                placeholderTextColor={colors.faint}
                maxLength={48}
                style={styles.groupNameInput}
              />

              {!!notice && (
                <View style={styles.notice}>
                  <Ionicons
                    name="alert-circle-outline"
                    size={16}
                    color={colors.yellow}
                  />
                  <Text style={styles.noticeText}>{notice}</Text>
                </View>
              )}

              <Pressable accessibilityRole="button"
                style={[
                  styles.createGroup,
                  (selectedIds.length < 2 || creating) &&
                    styles.createGroupDisabled,
                ]}
                disabled={selectedIds.length < 2 || creating}
                onPress={() => void createGroup()}
              >
                <Ionicons name="people" size={17} color="#fff" />
                <Text style={styles.createGroupText}>
                  {creating
                    ? "Creating…"
                    : selectedIds.length < 2
                      ? "Select 2+ friends"
                      : `Create group · ${selectedIds.length + 1} members`}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  draftTag: { color: colors.red, fontWeight: "800" },
  unreadBadge: { minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.red },
  unreadBadgeText: { color: "#FFFFFF", fontSize: 11, fontWeight: "900" },
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 28,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
    marginBottom: 18,
  },
  kicker: {
    color: colors.cyan,
    fontSize: 12,
    letterSpacing: 2,
    fontWeight: "900",
  },
  title: {
    color: colors.text,
    fontSize: 32,
    lineHeight: 37,
    fontWeight: "900",
    marginTop: 3,
  },
  subtitle: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 16,
    marginTop: 4,
  },
  plus: {
    width: 44,
    height: 44,
    borderRadius: 15,
    backgroundColor: colors.violet,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  summaryRow: {
    flexDirection: "row",
    gap: 8,
  },
  summaryCard: {
    flex: 1,
    minHeight: 66,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 15,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
  },
  summaryValue: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "900",
    marginTop: 3,
  },
  summaryLabel: {
    color: colors.faint,
    fontSize: 11,
    fontWeight: "800",
    marginTop: 1,
  },
  onlineDot: {
    width: 10,
    height: 10,
    borderRadius: 99,
    backgroundColor: colors.green,
    marginVertical: 4,
  },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 24,
    marginBottom: 9,
  },
  sectionTitle: {
    color: colors.muted,
    fontSize: 12,
    letterSpacing: 1.5,
    fontWeight: "900",
  },
  sectionCount: {
    color: colors.cyan,
    fontSize: 12,
    fontWeight: "900",
  },
  conversationList: {
    gap: 8,
  },
  row: {
    minHeight: 74,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    padding: 11,
    borderRadius: 18,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowPressed: {
    opacity: 0.78,
    borderColor: "rgba(95,225,255,.30)",
  },
  rowCopy: {
    flex: 1,
    minWidth: 0,
  },
  rowHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  groupNameRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  name: {
    flexShrink: 1,
    color: colors.text,
    fontWeight: "900",
    fontSize: 14,
  },
  time: {
    color: colors.faint,
    fontSize: 12,
    fontWeight: "700",
  },
  preview: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 5,
  },
  openIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.panel2,
  },
  groupAvatar: {
    width: 50,
    height: 50,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.cyanSoft,
    borderWidth: 1,
    borderColor: "rgba(95,225,255,.24)",
  },
  groupChip: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 99,
    backgroundColor: colors.violetSoft,
  },
  groupChipText: {
    color: "#B9AFFF",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.6,
  },
  memberBadge: {
    minWidth: 36,
    height: 30,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingHorizontal: 7,
    borderRadius: 10,
    backgroundColor: colors.panel2,
  },
  memberBadgeText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "900",
  },
  emptyActions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8 },
  emptyActionSecondary: { backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border },
  emptyActionSecondaryText: { color: colors.cyan },
  splitFill: { flex: 1 },
  splitRow: { flex: 1, flexDirection: "row" },
  splitList: { width: 380, flexGrow: 0 },
  splitPane: { flex: 1, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border },
  splitEmpty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  splitEmptyText: { color: colors.muted, fontSize: 14, fontWeight: "700" },
  rowSelected: { borderColor: colors.cyan },
  chips: { flexDirection: "row", gap: 7, marginBottom: 12 },
  chip: { minHeight: 34, paddingHorizontal: 13, borderRadius: 99, alignItems: "center", justifyContent: "center", backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.cyanSoft, borderColor: colors.cyan },
  chipText: { color: colors.muted, fontSize: 12, fontWeight: "800" },
  chipTextActive: { color: colors.cyan },
  backRow: { minHeight: 36, flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 12 },
  backRowText: { color: colors.cyan, fontSize: 13, fontWeight: "800" },
  backRowTitle: { flex: 1, textAlign: "right", color: colors.muted, fontSize: 13, fontWeight: "800" },
  listEmpty: { color: colors.muted, fontSize: 13, textAlign: "center", paddingVertical: 28, paddingHorizontal: 16 },
  acceptButton: { height: 32, paddingHorizontal: 11, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.violet },
  acceptText: { color: "#fff", fontSize: 12, fontWeight: "900" },
  ignoreButton: { height: 32, paddingHorizontal: 11, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.panel2 },
  ignoreText: { color: colors.muted, fontSize: 12, fontWeight: "900" },
  footLinks: { marginTop: 14, gap: 4, alignItems: "center" },
  footLink: { minHeight: 36, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10 },
  footLinkText: { color: colors.muted, fontSize: 13, fontWeight: "800" },
  swipeActions: { flexDirection: "row", gap: 6, marginLeft: 8 },
  swipeAction: { width: 76, borderRadius: 16, alignItems: "center", justifyContent: "center", gap: 4 },
  swipeActionText: { color: "#fff", fontSize: 12, fontWeight: "900" },
  empty: {
    alignItems: "center",
    paddingHorizontal: 24,
    paddingVertical: 34,
    borderRadius: 20,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyIcon: {
    width: 54,
    height: 54,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.cyanSoft,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "900",
    marginTop: 13,
  },
  emptyText: {
    maxWidth: 280,
    color: colors.muted,
    fontSize: 13,
    lineHeight: 17,
    textAlign: "center",
    marginTop: 5,
  },
  emptyAction: {
    marginTop: 15,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 11,
    backgroundColor: colors.violet,
  },
  emptyActionText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "900",
  },

  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: colors.overlay,
  },
  modal: {
    maxHeight: "90%",
    paddingHorizontal: 16,
    paddingTop: 9,
    paddingBottom: 22,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  modalGrabber: {
    width: 38,
    height: 4,
    alignSelf: "center",
    borderRadius: 99,
    backgroundColor: colors.faint,
    opacity: 0.48,
    marginBottom: 14,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  modalHeadingIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.cyanSoft,
  },
  modalKicker: {
    color: colors.cyan,
    fontSize: 11,
    letterSpacing: 1.7,
    fontWeight: "900",
  },
  modalTitle: {
    color: colors.text,
    fontSize: 21,
    fontWeight: "900",
    marginTop: 2,
  },
  modalClose: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.panel2,
  },
  search: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    marginTop: 16,
    borderRadius: 14,
    backgroundColor: colors.input,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 12,
    paddingVertical: 0,
  },
  selectedRail: {
    gap: 7,
    paddingTop: 10,
    paddingRight: 8,
  },
  selectedChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 99,
    backgroundColor: colors.violetSoft,
    borderWidth: 1,
    borderColor: "rgba(124,92,255,.25)",
  },
  selectedChipText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "800",
  },
  modalHelp: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 15,
    marginTop: 11,
    marginBottom: 7,
  },
  friendList: {
    maxHeight: 305,
  },
  friendEmpty: {
    minHeight: 90,
    alignItems: "center",
    justifyContent: "center",
  },
  friendEmptyText: {
    color: colors.muted,
    textAlign: "center",
    fontSize: 12,
  },
  friendRow: {
    minHeight: 62,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: 9,
  },
  check: {
    width: 27,
    height: 27,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.input,
  },
  checkSelected: {
    backgroundColor: colors.violet,
    borderColor: colors.violet,
  },
  friendCopy: {
    flex: 1,
    minWidth: 0,
  },
  friendName: {
    color: colors.text,
    fontWeight: "800",
    fontSize: 12,
  },
  friendStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 3,
  },
  friendStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 99,
    backgroundColor: colors.green,
  },
  friendStatusDotOffline: {
    backgroundColor: colors.faint,
  },
  friendStatus: {
    color: colors.muted,
    fontSize: 13,
  },
  messageButton: {
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(95,225,255,.25)",
    paddingHorizontal: 9,
  },
  messageButtonText: {
    color: colors.cyan,
    fontWeight: "800",
    fontSize: 13,
  },
  groupArea: {
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  fieldLabel: {
    color: colors.muted,
    fontSize: 11,
    letterSpacing: 1.2,
    fontWeight: "900",
    marginBottom: 6,
  },
  groupNameInput: {
    minHeight: 44,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.input,
    color: colors.text,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 12,
  },
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
  },
  noticeText: {
    flex: 1,
    color: colors.yellow,
    fontSize: 12,
  },
  createGroup: {
    minHeight: 47,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    marginTop: 10,
    borderRadius: 13,
    backgroundColor: colors.violet,
  },
  createGroupDisabled: {
    opacity: 0.42,
  },
  createGroupText: {
    color: "#fff",
    fontWeight: "900",
    fontSize: 12,
  },
});
