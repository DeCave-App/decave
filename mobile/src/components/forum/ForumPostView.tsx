import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRealtime } from "@/src/providers/RealtimeProvider";
import {
  canBeSolved,
  deleteForumMessage,
  fetchForumReplies,
  FORUM_REPLY_MAX,
  forumMessageFromFrame,
  forumPollVoteToggles,
  forumScore,
  forumVoteKey,
  patchForumPost,
  postTypeOf,
  relativeTime,
  splitBodyImages,
  toggleForumReaction,
  type ForumEntry,
  type ForumMessage,
  type ForumPostStatePatch,
} from "@/src/lib/forum-api";
import { canMarkSolved, canPinOrLock, isForumStaff, type ForumViewer } from "@/src/lib/forum-viewer";
import type { HubAsset } from "@/src/lib/hub-assets";
import { renderMessageText } from "@/src/components/channel/messageFormat";
import { MessageImage } from "@/src/components/MessageMedia";
import { Avatar } from "@/src/components/Avatar";
import ReportSheet, { REPORT_CONFIRMATION_MS, type MobileReportTarget } from "@/src/components/ReportSheet";
import { ForumLfgBlock, ForumMediaBlock, ForumPollBlock, TypeBadge } from "./ForumPostExtras";
import { impactHaptic, tapHaptic } from "@/src/lib/haptics";
import { colors } from "@/src/theme";

/** One forum post with its replies, like web's thread view (src/features/forum/ForumView.tsx). */
export function ForumPostView({
  entry,
  roomId,
  roomName,
  token,
  viewer,
  hubAssets,
  onClose,
  onEntryChange,
  onMessageChange,
  onDeleted,
}: {
  entry: ForumEntry | null;
  roomId: number;
  roomName: string;
  token: string | null;
  viewer: ForumViewer;
  hubAssets: readonly HubAsset[];
  onClose: () => void;
  onEntryChange: (postId: string, patch: Partial<Pick<ForumEntry, "pinned" | "locked" | "solvedReplyId" | "replyCount" | "lastActivityAt">>) => void;
  onMessageChange: (message: ForumMessage) => void;
  onDeleted: (postId: string) => void;
}) {
  const { t } = useTranslation(["forum", "common", "chat"]);
  const insets = useSafeAreaInsets();
  const { send, subscribe } = useRealtime();
  const postId = entry?.message.id ?? null;
  const [replies, setReplies] = useState<ForumMessage[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState("");
  const [reportTarget, setReportTarget] = useState<MobileReportTarget | null>(null);
  const loadGenerationRef = useRef(0);

  const load = useCallback(
    async (more: boolean) => {
      if (!token || !postId) return;
      const generation = ++loadGenerationRef.current;
      setLoading(true);
      setLoadError("");
      try {
        const page = await fetchForumReplies(token, roomId, postId, more ? cursor : null);
        if (generation !== loadGenerationRef.current) return;
        setReplies((current) => {
          if (!more) return page.replies;
          const seen = new Set(current.map((reply) => reply.id));
          return [...current, ...page.replies.filter((reply) => !seen.has(reply.id))];
        });
        setCursor(page.nextCursor);
      } catch (cause) {
        if (generation === loadGenerationRef.current) setLoadError(cause instanceof Error ? cause.message : t("forum.view.loadRepliesFailed"));
      } finally {
        if (generation === loadGenerationRef.current) setLoading(false);
      }
    },
    [token, roomId, postId, cursor, t],
  );

  useEffect(() => {
    setReplies([]);
    setCursor(null);
    setInput("");
    if (postId) void load(false);
    // Reload only when another post opens.
  }, [postId]);

  // Live replies, edits and deletions for the open post.
  useEffect(() => {
    if (!postId) return;
    return subscribe((event) => {
      const data = event as Record<string, unknown>;
      const message = forumMessageFromFrame(data, roomId);
      if (message?.replyToId === postId) {
        setReplies((current) => (current.some((reply) => reply.id === message.id) || cursor ? current : [...current, message]));
        return;
      }
      if (data.type === "MESSAGE_UPDATED" && data.message && typeof data.message === "object") {
        const updated = data.message as ForumMessage;
        if (updated.replyToId === postId) setReplies((current) => current.map((reply) => (reply.id === updated.id ? { ...reply, ...updated } : reply)));
        return;
      }
      if (data.type === "MESSAGE_DELETED" && typeof data.messageId === "string") {
        setReplies((current) => current.filter((reply) => reply.id !== data.messageId));
      }
    });
  }, [subscribe, postId, roomId, cursor]);

  if (!entry) return null;
  const { message, payload } = entry;
  const staff = isForumStaff(viewer);
  const canReply = viewer.canPostInHub && (!entry.locked || staff);
  const canSolve = canBeSolved(payload) && canMarkSolved(viewer, message.userId);
  const canModerate = canPinOrLock(viewer);
  const mine = !!message.userId && message.userId === viewer.userId;
  const { text: bodyText, images } = splitBodyImages(payload.body);
  const up = message.reactions?.forum_vote_up ?? [];
  const down = message.reactions?.forum_vote_down ?? [];

  const react = async (target: ForumMessage, emoji: string) => {
    if (!token) return;
    try {
      const updated = await toggleForumReaction(token, roomId, target.id, emoji);
      if (!updated) return;
      if (updated.replyToId) setReplies((current) => current.map((reply) => (reply.id === updated.id ? { ...reply, ...updated } : reply)));
      else onMessageChange(updated);
    } catch (cause) {
      Alert.alert(t("forum.view.updateFailed"), cause instanceof Error ? cause.message : t("forum.view.updateFailed"));
    }
  };

  const votePoll = async (optionIndex: number) => {
    if (!payload.poll) return;
    let current = message;
    for (const key of forumPollVoteToggles(current.reactions, viewer.userId, optionIndex, payload.poll.multi)) {
      if (!token) return;
      try {
        const updated = await toggleForumReaction(token, roomId, current.id, key);
        if (updated) {
          current = updated;
          onMessageChange(updated);
        }
      } catch (cause) {
        Alert.alert(t("forum.view.updateFailed"), cause instanceof Error ? cause.message : t("forum.view.updateFailed"));
        return;
      }
    }
  };

  const runPatch = async (patch: ForumPostStatePatch, label: string) => {
    if (!token || busy) return;
    setBusy(label);
    try {
      const state = await patchForumPost(token, roomId, message.id, patch);
      onEntryChange(message.id, {
        pinned: state.pinned,
        locked: state.locked,
        solvedReplyId: state.solvedReplyId,
        replyCount: state.replyCount,
        lastActivityAt: state.lastActivityAt,
      });
      impactHaptic();
    } catch (cause) {
      Alert.alert(t("forum.view.updateFailed"), cause instanceof Error ? cause.message : t("forum.view.updateFailed"));
    } finally {
      setBusy("");
    }
  };

  const remove = (target: ForumMessage) => {
    Alert.alert(t("chat.mobile.channel.deleteMessage"), t("chat.mobile.channel.thisRemovesTheMessageFor"), [
      { text: t("common.actions.cancel"), style: "cancel" },
      {
        text: t("common.actions.delete"),
        style: "destructive",
        onPress: () =>
          void (async () => {
            if (!token) return;
            try {
              await deleteForumMessage(token, roomId, target.id);
              if (target.id === message.id) onDeleted(message.id);
              else setReplies((current) => current.filter((reply) => reply.id !== target.id));
            } catch (cause) {
              Alert.alert(t("chat.mobile.channel.couldNotDeleteMessage"), cause instanceof Error ? cause.message : t("chat.mobile.channel.pleaseTryAgain"));
            }
          })(),
      },
    ]);
  };

  const report = (target: ForumMessage, isPost: boolean) =>
    setReportTarget({
      targetType: target.attachment ? "attachment" : "message",
      targetId: target.id,
      subjectUserId: target.userId,
      subjectUsername: target.username,
      contextType: "channel",
      contextId: String(roomId),
      contextLabel: isPost ? `#${roomName} · ${payload.title}` : `#${roomName}`,
    });

  const openActions = () => {
    const actions: { text: string; style?: "destructive" | "cancel"; onPress?: () => void }[] = [];
    if (canModerate) {
      actions.push({ text: entry.pinned ? t("forum.view.unpin") : t("forum.view.pin"), onPress: () => void runPatch({ pinned: !entry.pinned }, "pin") });
      actions.push({ text: entry.locked ? t("forum.view.unlock") : t("forum.view.lock"), onPress: () => void runPatch({ locked: !entry.locked }, "lock") });
    }
    if (canSolve && entry.solvedReplyId) actions.push({ text: t("forum.view.unmarkSolved"), onPress: () => void runPatch({ solvedReplyId: null }, "solve") });
    if (!mine) actions.push({ text: t("forum.view.reportPost"), onPress: () => report(message, true) });
    if (mine) actions.push({ text: t("chat.messages.deleteMessage"), style: "destructive", onPress: () => remove(message) });
    actions.push({ text: t("common.actions.cancel"), style: "cancel" });
    Alert.alert(t("forum.view.actions"), undefined, actions);
  };

  const sendReply = () => {
    const text = input.trim().slice(0, FORUM_REPLY_MAX);
    if (!text || !canReply) return;
    if (send({ type: "CHAT_MESSAGE", text, channelId: roomId, replyToId: message.id, attachment: null })) {
      impactHaptic();
      setInput("");
    } else {
      Alert.alert(t("forum.view.sendFailed"), t("forum.view.reconnecting"));
    }
  };

  const header = (
    <View style={styles.post}>
      <View style={styles.badges}>
        <TypeBadge type={postTypeOf(payload)} />
        {entry.pinned && <Badge icon="pin" text={t("forum.view.pinned")} />}
        {entry.locked && <Badge icon="lock-closed" text={t("forum.view.locked")} />}
        {!!entry.solvedReplyId && <Badge icon="checkmark-circle" text={t("forum.view.solved")} tone="green" />}
      </View>
      <Text style={styles.title} accessibilityRole="header">{payload.title}</Text>
      <View style={styles.authorRow}>
        <Avatar username={message.username} avatarUrl={message.avatarUrl} size={24} />
        <Text style={styles.author}>{message.username}</Text>
        <Text style={styles.time}>{relativeTime(message.timestamp)}</Text>
      </View>
      {payload.tags.length > 0 && (
        <View style={styles.tags}>
          {payload.tags.map((tag) => <Text key={tag} style={styles.tag}>#{tag}</Text>)}
        </View>
      )}
      {!!payload.iconUrl && <MessageImage url={payload.iconUrl} title={payload.title} token={token} authenticated={payload.iconUrl.startsWith("/")} />}
      {!!bodyText && <Text style={styles.body}>{renderMessageText(bodyText, undefined, hubAssets)}</Text>}
      {images.map((image, index) => (
        <MessageImage key={`${image.url}:${index}`} url={image.url} title={image.alt || t("forum.richText.image")} token={token} authenticated={image.url.startsWith("/")} />
      ))}
      {payload.poll && <ForumPollBlock poll={payload.poll} reactions={message.reactions} viewerId={viewer.userId} onVote={(index) => void votePoll(index)} />}
      {payload.lfg && <ForumLfgBlock lfg={payload.lfg} />}
      {payload.media && <ForumMediaBlock media={payload.media} token={token} />}
      {message.attachment && message.attachment.mimeType.startsWith("image/") && (
        <MessageImage url={message.attachment.url} title={message.attachment.name} token={token} authenticated />
      )}
      <View style={styles.voteRow}>
        <VoteButton icon="arrow-up" active={up.includes(viewer.userId)} label={t("forum.view.upvote", { count: up.length })} onPress={() => void react(message, forumVoteKey("up"))} />
        <Text style={styles.score}>{forumScore(message)}</Text>
        <VoteButton icon="arrow-down" active={down.includes(viewer.userId)} label={t("forum.view.downvote", { count: down.length })} onPress={() => void react(message, forumVoteKey("down"))} />
        <View style={{ flex: 1 }} />
        <Text style={styles.time}>{t("forum.view.replies", { count: Math.max(entry.replyCount, replies.length) })}</Text>
      </View>
    </View>
  );

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.topBar}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("forum.view.back")} hitSlop={8} onPress={onClose} style={styles.topButton}>
            <Ionicons name="chevron-down" size={22} color={colors.cyan} />
          </Pressable>
          <Text style={styles.topTitle} numberOfLines={1}>{t("forum.view.threadNamed", { title: payload.title })}</Text>
          {busy ? (
            <ActivityIndicator color={colors.cyan} />
          ) : (
            <Pressable accessibilityRole="button" accessibilityLabel={t("forum.view.actions")} hitSlop={8} onPress={openActions} style={styles.topButton}>
              <Ionicons name="ellipsis-horizontal" size={20} color={colors.text} />
            </Pressable>
          )}
        </View>

        <FlatList
          data={replies}
          keyExtractor={(reply) => reply.id}
          ListHeaderComponent={header}
          contentContainerStyle={{ paddingBottom: 16 }}
          keyboardDismissMode="on-drag"
          renderItem={({ item }) => {
            const solved = entry.solvedReplyId === item.id;
            const replyMine = !!item.userId && item.userId === viewer.userId;
            return (
              <Pressable
                style={[styles.reply, solved && styles.replySolved]}
                onLongPress={() => {
                  tapHaptic();
                  const actions: { text: string; style?: "destructive" | "cancel"; onPress?: () => void }[] = [];
                  if (canSolve)
                    actions.push(
                      solved
                        ? { text: t("forum.view.unmark"), onPress: () => void runPatch({ solvedReplyId: null }, "solve") }
                        : { text: t("forum.view.markSolution"), onPress: () => void runPatch({ solvedReplyId: item.id }, "solve") },
                    );
                  if (!replyMine) actions.push({ text: t("forum.view.report"), onPress: () => report(item, false) });
                  if (replyMine) actions.push({ text: t("chat.messages.deleteMessage"), style: "destructive", onPress: () => remove(item) });
                  actions.push({ text: t("common.actions.cancel"), style: "cancel" });
                  Alert.alert(item.username, undefined, actions);
                }}
              >
                <View style={styles.authorRow}>
                  <Avatar username={item.username} avatarUrl={item.avatarUrl} size={22} />
                  <Text style={styles.author}>{item.username}</Text>
                  {item.userId === message.userId && <Text style={styles.authorTag}>{t("forum.view.author")}</Text>}
                  <Text style={styles.time}>{relativeTime(item.timestamp)}</Text>
                </View>
                {solved && <Text style={styles.solution}>{t("forum.view.solution")}</Text>}
                {!!item.text && <Text style={styles.replyText}>{renderMessageText(item.text, undefined, hubAssets)}</Text>}
                {item.attachment && item.attachment.mimeType.startsWith("image/") && (
                  <MessageImage url={item.attachment.url} title={item.attachment.name} token={token} authenticated />
                )}
                {canSolve && !solved && (
                  <Pressable accessibilityRole="button" style={styles.markButton} onPress={() => void runPatch({ solvedReplyId: item.id }, "solve")}>
                    <Ionicons name="checkmark-circle-outline" size={15} color={colors.green} />
                    <Text style={styles.markText}>{t("forum.view.markSolution")}</Text>
                  </Pressable>
                )}
              </Pressable>
            );
          }}
          ListEmptyComponent={
            loading ? (
              <Text style={styles.empty}>{t("forum.view.loadingReplies")}</Text>
            ) : loadError ? (
              <Pressable accessibilityRole="button" onPress={() => void load(false)}>
                <Text style={[styles.empty, { color: colors.red }]}>{loadError} · {t("forum.view.retry")}</Text>
              </Pressable>
            ) : (
              <Text style={styles.empty}>{canSolve ? t("forum.view.noRepliesHelp") : t("forum.view.noReplies")}</Text>
            )
          }
          ListFooterComponent={
            cursor ? (
              <Pressable accessibilityRole="button" style={styles.more} disabled={loading} onPress={() => void load(true)}>
                {loading ? <ActivityIndicator color={colors.cyan} /> : <Text style={styles.markText}>{t("forum.view.loadMoreReplies")}</Text>}
              </Pressable>
            ) : null
          }
        />

        <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 10) }]}>
          {!canReply ? (
            <Text style={styles.lockedNote}>{!viewer.canPostInHub ? t("forum.restriction.ownerOnly") : t("forum.view.lockedNote")}</Text>
          ) : (
            <>
              {entry.locked && <Text style={styles.lockedNote}>{t("forum.view.lockedStaff")}</Text>}
              <View style={styles.composerRow}>
                <TextInput
                  value={input}
                  onChangeText={setInput}
                  placeholder={t("forum.view.replyTo", { name: message.username })}
                  placeholderTextColor={colors.faint}
                  maxLength={FORUM_REPLY_MAX}
                  multiline
                  style={styles.input}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("forum.view.send")}
                  disabled={!input.trim()}
                  style={[styles.send, !input.trim() && { opacity: 0.4 }]}
                  onPress={sendReply}
                >
                  <Ionicons name="arrow-up" size={20} color="#fff" />
                </Pressable>
              </View>
            </>
          )}
        </View>
        <ReportSheet
          visible={reportTarget !== null}
          token={token}
          target={reportTarget}
          onClose={() => setReportTarget(null)}
          onSubmitted={() => setTimeout(() => setReportTarget(null), REPORT_CONFIRMATION_MS)}
        />
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Badge({ icon, text, tone }: { icon: keyof typeof Ionicons.glyphMap; text: string; tone?: "green" }) {
  const color = tone === "green" ? colors.green : colors.muted;
  return (
    <View style={styles.badge}>
      <Ionicons name={icon} size={11} color={color} />
      <Text maxFontSizeMultiplier={1.3} style={[styles.badgeText, { color }]}>{text}</Text>
    </View>
  );
}

function VoteButton({ icon, active, label, onPress }: { icon: "arrow-up" | "arrow-down"; active: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      hitSlop={6}
      style={[styles.vote, active && styles.voteOn]}
      onPress={() => {
        tapHaptic();
        onPress();
      }}
    >
      <Ionicons name={icon} size={16} color={active ? colors.cyan : colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  topBar: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  topButton: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: colors.panel2 },
  topTitle: { flex: 1, color: colors.text, fontSize: 15, fontWeight: "900" },
  post: { padding: 16, gap: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  badge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 99, backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border },
  badgeText: { fontSize: 11, fontWeight: "800" },
  title: { color: colors.text, fontSize: 20, fontWeight: "900", lineHeight: 26 },
  authorRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  author: { color: colors.text, fontSize: 13, fontWeight: "800" },
  authorTag: { color: colors.cyan, fontSize: 10, fontWeight: "900", textTransform: "uppercase" },
  time: { color: colors.faint, fontSize: 12, fontWeight: "600" },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tag: { color: colors.cyan, fontSize: 12, fontWeight: "800" },
  body: { color: colors.text, fontSize: 15, lineHeight: 22 },
  voteRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  vote: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border },
  voteOn: { borderColor: colors.cyan, backgroundColor: colors.cyanSoft },
  score: { minWidth: 24, textAlign: "center", color: colors.text, fontSize: 14, fontWeight: "900" },
  reply: { paddingHorizontal: 16, paddingVertical: 12, gap: 6, borderBottomWidth: 1, borderBottomColor: colors.border },
  replySolved: { backgroundColor: "rgba(52, 211, 153, 0.08)" },
  solution: { color: colors.green, fontSize: 12, fontWeight: "900" },
  replyText: { color: colors.text, fontSize: 15, lineHeight: 21 },
  markButton: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", paddingVertical: 4 },
  markText: { color: colors.cyan, fontSize: 13, fontWeight: "800" },
  empty: { padding: 24, textAlign: "center", color: colors.muted, fontSize: 14 },
  more: { alignItems: "center", padding: 16 },
  composer: { paddingHorizontal: 12, paddingTop: 8, gap: 6, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.panel },
  composerRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  input: { flex: 1, minHeight: 42, maxHeight: 140, paddingHorizontal: 12, paddingTop: 11, paddingBottom: 11, borderRadius: 14, color: colors.text, backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border, fontSize: 15 },
  send: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: colors.violet },
  lockedNote: { color: colors.muted, fontSize: 13, lineHeight: 18, paddingVertical: 6 },
});
