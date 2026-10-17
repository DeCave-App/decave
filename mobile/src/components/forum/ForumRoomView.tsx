import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSession } from "@/src/providers/SessionProvider";
import { useRealtime } from "@/src/providers/RealtimeProvider";
import { useUnread } from "@/src/providers/UnreadProvider";
import { apiJson } from "@/src/lib/api";
import { cachedHub } from "@/src/lib/hub-list-cache";
import { useHubAssets } from "@/src/hooks/useHubAssets";
import { FORUM_SORTS } from "../../../../shared/forum";
import {
  displayForumPayload,
  fetchForumPosts,
  forumMessageFromFrame,
  forumScore,
  postTypeOf,
  relativeTime,
  roomForumTags,
  sortEntries,
  splitBodyImages,
  FORUM_TYPE_ICONS,
  type ForumEntry,
  type ForumMessage,
  type ForumSort,
} from "@/src/lib/forum-api";
import { isForumStaff, postRestriction, type ForumViewer, type ForumViewerRole } from "@/src/lib/forum-viewer";
import type { Hub } from "@/src/types";
import { VoiceFloatingBar } from "@/src/components/VoiceFloatingBar";
import { styles as roomStyles } from "@/src/components/channel/channelScreen.styles";
import { ForumComposeSheet } from "./ForumComposeSheet";
import { ForumPostView } from "./ForumPostView";
import { ForumPollBlock } from "./ForumPostExtras";
import { impactHaptic } from "@/src/lib/haptics";
import { colors } from "@/src/theme";

type MemberWithRoles = { userId: string; customRoles?: ForumViewerRole[] };

/**
 * A forum room: posts sorted and filtered like web (Active / New / Top /
 * Unanswered, tags, search), each opening as its own thread page, and a New
 * post button for every post type.
 */
export function ForumRoomView({
  channelId,
  hubId,
  name,
  embedded,
}: {
  channelId: number;
  hubId: number;
  name: string;
  embedded: boolean;
}) {
  const { t } = useTranslation(["forum", "chat", "common"]);
  const { token, user } = useSession();
  const { connectionState, send, subscribe } = useRealtime();
  const { setOpenRoom } = useUnread();
  const hubAssets = useHubAssets(hubId, token);

  const [hub, setHub] = useState<Hub | null>(() => cachedHub(token, hubId));
  const [myRoles, setMyRoles] = useState<ForumViewerRole[]>([]);
  const [sort, setSort] = useState<ForumSort>("active");
  const [tag, setTag] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [posts, setPosts] = useState<ForumEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [openPostId, setOpenPostId] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const loadGenerationRef = useRef(0);

  useEffect(() => {
    if (!embedded) return;
    setOpenRoom(channelId);
    return () => setOpenRoom(null);
  }, [embedded, channelId, setOpenRoom]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  // The room's tags and posting policy, and my custom roles (who counts as forum staff).
  useEffect(() => {
    if (!token || !hubId) return;
    let cancelled = false;
    void apiJson<Hub>(`/api/servers/${hubId}`, {}, token)
      .then((value) => {
        if (!cancelled) setHub(value);
      })
      .catch(() => undefined);
    void apiJson<MemberWithRoles[]>(`/api/servers/${hubId}/members`, {}, token)
      .then((members) => {
        if (cancelled || !Array.isArray(members)) return;
        setMyRoles(members.find((member) => member.userId === user?.id)?.customRoles ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [token, hubId, user?.id]);

  const room = hub?.channels?.find((channel) => channel.id === channelId) ?? null;
  const viewer: ForumViewer = useMemo(
    () => ({
      userId: user?.id ?? "",
      hubRole: hub?.myRole,
      customRoles: myRoles,
      canPostInHub: (hub?.ownerOnlyPosting !== true || hub?.myRole === "owner") && room?.canPost !== false,
    }),
    [user?.id, hub?.myRole, hub?.ownerOnlyPosting, room?.canPost, myRoles],
  );
  const restriction = room ? postRestriction(room, viewer, {}) : null;
  const restrictionText = restriction
    ? restriction.key === "namedRoles"
      ? t("forum.restriction.namedRoles", { roles: restriction.roles, count: restriction.count })
      : t(`forum.restriction.${restriction.key}`)
    : null;
  const roomTags = useMemo(() => roomForumTags(room), [room]);
  const filterTags = useMemo(() => {
    if (roomTags.length) return roomTags;
    const seen = new Map<string, string>();
    posts.forEach((entry) => entry.payload.tags.forEach((item) => { if (!seen.has(item.toLowerCase())) seen.set(item.toLowerCase(), item); }));
    return Array.from(seen.values()).sort((a, b) => a.localeCompare(b)).slice(0, 20);
  }, [roomTags, posts]);

  const load = useCallback(
    async (more: boolean) => {
      if (!token) return;
      const generation = ++loadGenerationRef.current;
      if (!more) setLoading(true);
      setLoadError("");
      try {
        const page = await fetchForumPosts(token, channelId, { sort, tag, q: debouncedQuery, cursor: more ? cursor : null });
        if (generation !== loadGenerationRef.current) return;
        setPosts((current) => {
          if (!more) return page.posts;
          const seen = new Set(current.map((entry) => entry.message.id));
          return [...current, ...page.posts.filter((entry) => !seen.has(entry.message.id))];
        });
        setCursor(page.nextCursor);
      } catch (cause) {
        if (generation === loadGenerationRef.current) setLoadError(cause instanceof Error ? cause.message : t("forum.view.loadPostsFailed"));
      } finally {
        if (generation === loadGenerationRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [token, channelId, sort, tag, debouncedQuery, cursor, t],
  );

  useEffect(() => {
    void load(false);
    // Reload when the room or a filter changes, not when the cursor moves.
  }, [token, channelId, sort, tag, debouncedQuery]);

  const patchEntry = useCallback(
    (postId: string, patch: (entry: ForumEntry) => ForumEntry) =>
      setPosts((current) => sortEntries(current.map((entry) => (entry.message.id === postId ? patch(entry) : entry)), sort)),
    [sort],
  );

  // Live: new posts, reply counts, edits, deletions and pin/lock/solve changes.
  useEffect(
    () =>
      subscribe((event) => {
        const data = event as Record<string, unknown>;
        const message = forumMessageFromFrame(data, channelId);
        if (message) {
          if (message.replyToId) {
            const postId = message.replyToId;
            patchEntry(postId, (entry) => ({ ...entry, replyCount: entry.replyCount + 1, lastActivityAt: message.timestamp }));
            return;
          }
          const payload = displayForumPayload(message);
          if (!payload) return;
          if (tag && !payload.tags.some((item) => item.toLowerCase() === tag.toLowerCase())) return;
          const q = debouncedQuery.toLowerCase();
          if (q && !payload.title.toLowerCase().includes(q) && !payload.body.toLowerCase().includes(q)) return;
          const entry: ForumEntry = { message, payload, replyCount: 0, lastActivityAt: message.timestamp, pinned: false, locked: false, solvedReplyId: null };
          setPosts((current) => (current.some((item) => item.message.id === message.id) ? current : sortEntries([entry, ...current], sort)));
          return;
        }
        if (data.type === "MESSAGE_UPDATED" && data.message && typeof data.message === "object") {
          const updated = data.message as ForumMessage;
          if (Number(updated.channelId) !== channelId || updated.replyToId) return;
          const payload = displayForumPayload(updated);
          if (payload) patchEntry(updated.id, (entry) => ({ ...entry, message: { ...entry.message, ...updated }, payload }));
          return;
        }
        if (data.type === "MESSAGE_DELETED" && typeof data.messageId === "string") {
          const messageId = data.messageId;
          setPosts((current) => current.filter((entry) => entry.message.id !== messageId));
          setOpenPostId((current) => (current === messageId ? null : current));
          return;
        }
        if (data.type === "FORUM_POST_UPDATED" && typeof data.postId === "string") {
          patchEntry(data.postId, (entry) => ({
            ...entry,
            replyCount: typeof data.replyCount === "number" ? data.replyCount : entry.replyCount,
            lastActivityAt: typeof data.lastActivityAt === "string" ? data.lastActivityAt : entry.lastActivityAt,
            pinned: typeof data.pinned === "boolean" ? data.pinned : entry.pinned,
            locked: typeof data.locked === "boolean" ? data.locked : entry.locked,
            solvedReplyId: data.solvedReplyId === null || typeof data.solvedReplyId === "string" ? (data.solvedReplyId as string | null) : entry.solvedReplyId,
          }));
        }
      }),
    [subscribe, channelId, patchEntry, sort, tag, debouncedQuery],
  );

  const publish = (text: string): boolean => {
    if (!send({ type: "CHAT_MESSAGE", text, channelId, replyToId: null, attachment: null })) return false;
    impactHaptic();
    return true;
  };

  const openPost = posts.find((entry) => entry.message.id === openPostId) ?? null;
  const filtersActive = Boolean(tag || debouncedQuery || sort === "unanswered");

  return (
    <View style={roomStyles.flex}>
      <View style={roomStyles.top}>
        {!embedded && (
          <Pressable accessibilityRole="button" accessibilityLabel={t("common.actions.back")} style={roomStyles.backButton} onPress={() => router.back()} hitSlop={8}>
            <Ionicons name="chevron-back" size={23} color={colors.cyan} />
          </Pressable>
        )}
        <View style={roomStyles.channelIcon}>
          <Ionicons name="albums" size={17} color={colors.cyan} />
        </View>
        <View style={roomStyles.topCopy}>
          <Text style={roomStyles.title} numberOfLines={1} maxFontSizeMultiplier={1.4}>{name}</Text>
          <View style={roomStyles.statusRow}>
            <View style={[roomStyles.statusDot, connectionState !== "connected" && roomStyles.statusDotWaiting]} />
            <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={[roomStyles.status, connectionState !== "connected" && roomStyles.statusWaiting]}>
              {connectionState === "connected" ? t("forum.view.kicker") : t("chat.mobile.channel.connecting")}
            </Text>
          </View>
        </View>
      </View>
      {!embedded && <VoiceFloatingBar style={{ marginTop: 6, marginBottom: 4 }} />}

      <FlatList
        data={posts}
        keyExtractor={(entry) => entry.message.id}
        contentContainerStyle={styles.list}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.cyan} onRefresh={() => { setRefreshing(true); void load(false); }} />}
        ListHeaderComponent={
          <View style={styles.controls}>
            {!!room?.forumGuidelines && (
              <View style={styles.guidelines}>
                <Text style={styles.guidelinesTitle}>{t("forum.view.guidelines")}</Text>
                <Text style={styles.guidelinesText}>{room.forumGuidelines}</Text>
              </View>
            )}
            <View style={styles.search}>
              <Ionicons name="search" size={16} color={colors.faint} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={t("forum.view.searchPlaceholder")}
                accessibilityLabel={t("forum.view.search")}
                placeholderTextColor={colors.faint}
                returnKeyType="search"
                style={styles.searchInput}
              />
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityLabel={t("forum.view.sort")}>
              {FORUM_SORTS.map((item) => (
                <Chip key={item} label={t(`forum.sort.${item}`)} on={sort === item} onPress={() => setSort(item)} />
              ))}
            </ScrollView>
            {filterTags.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityLabel={t("forum.view.filterTag")}>
                <Chip label={t("forum.view.allTags")} on={!tag} onPress={() => setTag(null)} />
                {filterTags.map((item) => (
                  <Chip key={item} label={`#${item}`} on={tag?.toLowerCase() === item.toLowerCase()} onPress={() => setTag(tag?.toLowerCase() === item.toLowerCase() ? null : item)} />
                ))}
              </ScrollView>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <PostCard entry={item} viewerId={viewer.userId} onPress={() => setOpenPostId(item.message.id)} />
        )}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator style={{ marginTop: 40 }} color={colors.cyan} />
          ) : loadError ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyTitle}>{t("forum.view.feedErrorTitle")}</Text>
              <Text style={styles.emptyText}>{loadError}</Text>
              <Pressable accessibilityRole="button" onPress={() => void load(false)}><Text style={styles.link}>{t("forum.view.retry")}</Text></Pressable>
            </View>
          ) : (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyTitle}>{filtersActive ? t("forum.view.noMatch") : t("forum.view.empty")}</Text>
              <Text style={styles.emptyText}>{filtersActive ? t("forum.view.noMatchHint") : t("forum.view.emptyHint")}</Text>
              {filtersActive ? (
                <Pressable accessibilityRole="button" onPress={() => { setTag(null); setQuery(""); setSort("active"); }}><Text style={styles.link}>{t("forum.view.clearFilters")}</Text></Pressable>
              ) : !restriction ? (
                <Pressable accessibilityRole="button" onPress={() => setComposeOpen(true)}><Text style={styles.link}>{t("forum.view.createFirst")}</Text></Pressable>
              ) : null}
            </View>
          )
        }
        ListFooterComponent={
          cursor ? (
            <Pressable accessibilityRole="button" style={styles.more} onPress={() => void load(true)}>
              <Text style={styles.link}>{t("forum.view.loadMore")}</Text>
            </Pressable>
          ) : null
        }
      />

      {restriction ? (
        <Text style={styles.restriction}>{restrictionText}</Text>
      ) : (
        <Pressable
          accessibilityRole="button"
          style={styles.fab}
          onPress={() => {
            if (!token) return;
            if (connectionState !== "connected") {
              Alert.alert(t("forum.view.newPost"), t("forum.view.reconnecting"));
              return;
            }
            setComposeOpen(true);
          }}
        >
          <Ionicons name="create-outline" size={20} color="#061018" />
          <Text style={styles.fabText}>{t("forum.view.newPost")}</Text>
        </Pressable>
      )}

      <ForumComposeSheet
        visible={composeOpen}
        roomId={channelId}
        roomName={name}
        roomTags={roomTags}
        token={token}
        canLockReplies={isForumStaff(viewer)}
        restriction={restrictionText}
        onClose={() => setComposeOpen(false)}
        onPublish={publish}
      />
      {openPost && (
        <ForumPostView
          entry={openPost}
          roomId={channelId}
          roomName={name}
          token={token}
          viewer={viewer}
          hubAssets={hubAssets}
          onClose={() => setOpenPostId(null)}
          onEntryChange={(postId, patch) => patchEntry(postId, (entry) => ({ ...entry, ...patch }))}
          onMessageChange={(message) => {
            const payload = displayForumPayload(message);
            patchEntry(message.id, (entry) => ({ ...entry, message: { ...entry.message, ...message }, payload: payload ?? entry.payload }));
          }}
          onDeleted={(postId) => {
            setOpenPostId(null);
            setPosts((current) => current.filter((entry) => entry.message.id !== postId));
          }}
        />
      )}
    </View>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.chip, on && styles.chipOn]} onPress={onPress}>
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

function PostCard({ entry, viewerId, onPress }: { entry: ForumEntry; viewerId: string; onPress: () => void }) {
  const { t } = useTranslation(["forum"]);
  const { message, payload } = entry;
  const preview = splitBodyImages(payload.body).text.replace(/\s+/g, " ").trim();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={payload.title} style={({ pressed }) => [styles.card, pressed && { opacity: 0.8 }]} onPress={onPress}>
      <View style={styles.cardTop}>
        <Text style={styles.cardIcon}>{FORUM_TYPE_ICONS[postTypeOf(payload)]}</Text>
        <Text style={styles.cardTitle} numberOfLines={2}>{payload.title}</Text>
        {entry.pinned && <Ionicons name="pin" size={14} color={colors.cyan} accessibilityLabel={t("forum.view.pinned")} />}
        {entry.locked && <Ionicons name="lock-closed" size={14} color={colors.muted} accessibilityLabel={t("forum.view.locked")} />}
        {!!entry.solvedReplyId && <Ionicons name="checkmark-circle" size={15} color={colors.green} accessibilityLabel={t("forum.view.solved")} />}
      </View>
      {!!preview && <Text style={styles.cardPreview} numberOfLines={2}>{preview}</Text>}
      {payload.poll && <ForumPollBlock poll={payload.poll} reactions={message.reactions} viewerId={viewerId} compact />}
      {payload.tags.length > 0 && (
        <View style={styles.cardTags}>
          {payload.tags.map((item) => <Text key={item} style={styles.cardTag}>#{item}</Text>)}
        </View>
      )}
      <View style={styles.cardMeta}>
        <Text style={styles.metaText} numberOfLines={1}>{message.username} · {relativeTime(entry.lastActivityAt)}</Text>
        <View style={styles.metaItem}>
          <Ionicons name="arrow-up" size={12} color={colors.muted} />
          <Text style={styles.metaText}>{forumScore(message)}</Text>
        </View>
        <View style={styles.metaItem}>
          <Ionicons name="chatbubble-outline" size={12} color={colors.muted} />
          <Text style={styles.metaText}>{entry.replyCount}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 14, paddingBottom: 96, gap: 10 },
  controls: { gap: 10, paddingTop: 8, paddingBottom: 4 },
  guidelines: { padding: 12, borderRadius: 14, backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border, gap: 4 },
  guidelinesTitle: { color: colors.cyan, fontSize: 12, fontWeight: "900", textTransform: "uppercase" },
  guidelinesText: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  search: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, height: 42, borderRadius: 12, backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border },
  searchInput: { flex: 1, color: colors.text, fontSize: 15 },
  chips: { gap: 8, paddingRight: 8 },
  chip: { paddingHorizontal: 12, height: 32, justifyContent: "center", borderRadius: 99, backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border },
  chipOn: { borderColor: colors.cyan, backgroundColor: colors.cyanSoft },
  chipText: { color: colors.muted, fontSize: 13, fontWeight: "800" },
  chipTextOn: { color: colors.cyan },
  card: { padding: 14, gap: 8, borderRadius: 16, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border },
  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  cardIcon: { fontSize: 16, lineHeight: 21 },
  cardTitle: { flex: 1, color: colors.text, fontSize: 16, fontWeight: "900", lineHeight: 21 },
  cardPreview: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  cardTags: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  cardTag: { color: colors.cyan, fontSize: 12, fontWeight: "800" },
  cardMeta: { flexDirection: "row", alignItems: "center", gap: 12 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 3 },
  metaText: { flexShrink: 1, color: colors.faint, fontSize: 12, fontWeight: "700" },
  emptyBox: { alignItems: "center", gap: 8, paddingVertical: 40, paddingHorizontal: 20 },
  emptyTitle: { color: colors.text, fontSize: 16, fontWeight: "900" },
  emptyText: { color: colors.muted, fontSize: 13, textAlign: "center", lineHeight: 18 },
  link: { color: colors.cyan, fontSize: 14, fontWeight: "800" },
  more: { alignItems: "center", padding: 14 },
  restriction: { margin: 12, padding: 12, borderRadius: 12, color: colors.muted, fontSize: 13, lineHeight: 18, backgroundColor: colors.panel2 },
  fab: { position: "absolute", right: 16, bottom: 20, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 18, height: 50, borderRadius: 25, backgroundColor: colors.cyan, shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  fabText: { color: "#061018", fontSize: 15, fontWeight: "900" },
});
