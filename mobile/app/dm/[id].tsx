import { useEffect, useRef, useState } from "react";
import {
  ActionSheetIOS,
  Alert,
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { Avatar } from "@/src/components/Avatar";
import { useMutedUsers } from "@/src/providers/MutedUsersProvider";
import { SwipeToReply } from "@/src/components/SwipeToReply";
import { ComposerMediaSheet } from "@/src/components/ComposerMediaSheet";
import { MessageImage } from "@/src/components/MessageMedia";
import { DM_ATTACHMENT_PREFIX as MEDIA_ATTACHMENT_PREFIX, gifMessageText, isImageMime, parseGif, pickMedia, uploadAsset, type GiphyGif } from "@/src/lib/chat-media";
import { errorHaptic, impactHaptic, successHaptic, tapHaptic } from "@/src/lib/haptics";
import ReportSheet, { type MobileReportTarget } from "@/src/components/ReportSheet";
import { Screen } from "@/src/components/Screen";
import { API_BASE, apiFetch, apiJson } from "@/src/lib/api";
import { downloadLegacyAttachmentMobile, LegacyAttachmentError } from "@/src/lib/legacy-attachment-download";
import { useSession } from "@/src/providers/SessionProvider";
import { useRealtime } from "@/src/providers/RealtimeProvider";
import { useDirectCall } from "@/src/providers/DirectCallProvider";
import { SkeletonRows } from "@/src/components/Skeleton";
import { MessagePreview } from "@/src/components/MessagePreview";
import { useUnread } from "@/src/providers/UnreadProvider";
import { useHardwareKeyboard, useIsWide } from "@/src/lib/layout";
import { KeyboardAware } from "@/src/components/KeyboardAware";
import { SendFailedBanner } from "@/src/components/SendFailedBanner";
import { LoadError } from "@/src/components/LoadError";
import { LinkifiedText } from "@/src/components/LinkifiedText";
import { colors } from "@/src/theme";
import type { AccountUser, DirectMessage } from "@/src/types";
import { VoiceFloatingBar } from "@/src/components/VoiceFloatingBar";
import { useDraftInput } from "@/src/lib/drafts";

const DM_REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "😡", "🎉", "🔥", "👎", "✅"] as const;
const DM_ATTACHMENT_PREFIX = "__DECAVE_DM_ATTACHMENT__";

type LegacyDmAttachment = { name: string; mimeType: string; size: number; url: string };

function parseLegacyAttachment(text: string): LegacyDmAttachment | null {
  if (!text.startsWith(DM_ATTACHMENT_PREFIX)) return null;
  try {
    const value = JSON.parse(text.slice(DM_ATTACHMENT_PREFIX.length)) as Partial<LegacyDmAttachment>;
    if (typeof value.name !== "string" || typeof value.mimeType !== "string" || typeof value.url !== "string") return null;
    return { name: value.name, mimeType: value.mimeType, size: typeof value.size === "number" ? value.size : 0, url: value.url };
  } catch {
    return null;
  }
}

function formatMessageTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";

  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDayLabel(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";

  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (sameDay(date, today)) return "Today";
  if (sameDay(date, yesterday)) return "Yesterday";

  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function previewMessage(text: string): string {
  const preview = text.replace(/\s+/g, " ").trim();
  if (!preview) return "Message";
  return preview.length > 88 ? `${preview.slice(0, 85)}…` : preview;
}

const RUN_GAP_MS = 5 * 60 * 1000;

function inSameRun(a: DirectMessage, b: DirectMessage | undefined): boolean {
  if (!b || a.fromUserId !== b.fromUserId) return false;
  const gap = Math.abs(new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return gap < RUN_GAP_MS && formatDayLabel(a.timestamp) === formatDayLabel(b.timestamp);
}

type DmParams = { id: string; username?: string };

export default function DmScreen() {
  const params = useLocalSearchParams<DmParams>();
  return (
    <Screen>
      <DmView params={params} />
    </Screen>
  );
}

/**
 * A direct conversation. Full-screen on iPhone; the right-hand pane of the DMs
 * tab on iPad (embedded: no back button, `onClosed` when the chat is deleted).
 */
export function DmView({ params, embedded = false, onClosed }: { params: DmParams; embedded?: boolean; onClosed?: () => void }) {
  const targetId = params.id;
  const fallbackName =
    typeof params.username === "string" ? params.username : "Direct Message";

  const { token, user } = useSession();
  const wide = useIsWide();
  const hardwareKeyboard = useHardwareKeyboard();
  // Return sends only with a hardware keyboard on iPad; on-screen Return adds a line.
  const returnSends = wide && hardwareKeyboard;
  const {
    send,
    lastEvent,
    connectionState,
  } = useRealtime();
  const { startCall } = useDirectCall(); // DECAVE_FINAL_DM_PASS

  const [target, setTarget] = useState<AccountUser | null>(null);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [input, setInput, restoreDraft] = useDraftInput(`dm:${targetId}`, editingId != null);
  const [replyingTo, setReplyingTo] = useState<DirectMessage | null>(null);
  const [actionMessage, setActionMessage] = useState<DirectMessage | null>(null);
  const { setOpenDm } = useUnread();
  useEffect(() => {
    if (!embedded || !targetId) return;
    setOpenDm(targetId);
    return () => setOpenDm(null);
  }, [embedded, targetId, setOpenDm]);
  const { mutedIds, toggleMute } = useMutedUsers();
  const [reportTarget, setReportTarget] = useState<MobileReportTarget | null>(null);
  const listRef = useRef<FlatList<DirectMessage>>(null);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [peerReadAt, setPeerReadAt] = useState<string | null>(null);
  const [hasOlder, setHasOlder] = useState(true);
  const [nearBottom, setNearBottom] = useState(true);
  const nearBottomRef = useRef(true);
  const seenLastIdRef = useRef<string | null>(null);
  const loadGenerationRef = useRef(0);

  const downloadLegacyAttachment = async (attachment: LegacyDmAttachment) => {
    try {
      await downloadLegacyAttachmentMobile({
        url: attachment.url,
        filename: attachment.name,
        baseUrl: API_BASE,
        apiFetch,
        token,
        platform: Platform.OS,
      });
    } catch (error) {
      Alert.alert("Could not download attachment", error instanceof LegacyAttachmentError ? error.message : "The authenticated attachment download failed.");
    }
  };


  const load = async () => {
    if (!token || !targetId) return;
    const generation = ++loadGenerationRef.current;

    try {
      const data = await apiJson<{
        user: AccountUser;
        messages: DirectMessage[];
        peerReadAt?: string | null;
      }>(
        `/api/dms/${encodeURIComponent(targetId)}`,
        {},
        token,
      );

      if (generation !== loadGenerationRef.current) return;
      setTarget(data.user);
      setPeerReadAt(data.peerReadAt ?? null);
      const latest = data.messages ?? [];
      if (latest.length < 100) setHasOlder(false);
      setMessages((current) => {
        const latestIds = new Set(latest.map((item) => item.id));
        const firstLatest = latest[0]?.timestamp ?? "";
        const older = current.filter((item) => !latestIds.has(item.id) && item.timestamp < firstLatest);
        return [...older, ...latest];
      });
      setLoadError("");
    } catch (error) {
      if (generation !== loadGenerationRef.current) return;
      setLoadError(error instanceof Error ? error.message : "Could not load messages.");
    } finally {
      if (generation === loadGenerationRef.current) setLoaded(true);
    }
  };

  useEffect(() => {
    setTarget(null);
    setMessages([]);
    setActionMessage(null);
    setReplyingTo(null);
    setEditingId(null);
    void load();
  }, [targetId, token]);

  useEffect(() => {
    if (!lastEvent) return;

    if (lastEvent.type === "DM_READ") {
      const readerId = typeof lastEvent.readerId === "string" ? lastEvent.readerId : "";
      if (readerId && (readerId === target?.id || readerId === targetId) && typeof lastEvent.readAt === "string") {
        setPeerReadAt(lastEvent.readAt);
      }
      return;
    }

    if (
      lastEvent.type === "DM_MESSAGE" ||
      lastEvent.type === "DM_MESSAGE_UPDATED" ||
      lastEvent.type === "DM_MESSAGE_DELETED" ||
      lastEvent.type === "DM_REACTION_UPDATED"
    ) {
      void load();
    }
  }, [lastEvent]);

  const reactToMessage = async (message: DirectMessage, emoji: string) => {
    try {
      if (!token) return;
      const data = await apiJson<{ message: DirectMessage }>(
        `/api/dms/messages/${encodeURIComponent(message.id)}/reactions`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ emoji }) },
        token,
      );
      if (data.message) setMessages((current) => current.map((item) => item.id === data.message.id ? data.message : item));
      setActionMessage(null);
    } catch (error) {
      Alert.alert("Could not add reaction", error instanceof Error ? error.message : "Please try again.");
    }
  };

  const beginEdit = (message: DirectMessage) => {
    if (message.fromUserId !== user?.id) return;
    setReplyingTo(null);
    setEditingId(message.id);
    setInput(message.text, false);
  };

  const beginReply = (message: DirectMessage) => {
    setActionMessage(null);
    setEditingId(null);
    setReplyingTo(message);
  };

  const cancelEdit = () => {
    setEditingId(null);
    restoreDraft();
  };

  const saveEdit = async (text: string) => {
    if (!editingId) return;
    try {
      if (!token) return;
      const data = await apiJson<{ message: DirectMessage }>(
        `/api/dms/messages/${encodeURIComponent(editingId)}`,
        { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) },
        token,
      );
      if (data.message) setMessages((current) => current.map((item) => item.id === data.message.id ? data.message : item));
      setEditingId(null);
      restoreDraft();
    } catch (error) {
      Alert.alert(
        "Could not edit message",
        error instanceof Error ? error.message : "The message was not changed.",
      );
    }
  };

  const deleteMessage = (message: DirectMessage) => {
    setActionMessage(null);
    Alert.alert("Delete message?", "This removes the message for both people.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => void (async () => {
          try {
            if (!token) return;
            await apiJson(`/api/dms/messages/${encodeURIComponent(message.id)}`, { method: "DELETE" }, token);
            setMessages((current) => current.filter((item) => item.id !== message.id));
          } catch (error) {
            Alert.alert("Could not delete message", error instanceof Error ? error.message : "Please try again.");
          }
        })(),
      },
    ]);
  };

  const deleteConversation = () => {
    const username = target?.username || fallbackName;
    Alert.alert(
      `Delete conversation with ${username}?`,
      "This clears the conversation from this account only. A new message will make it appear again.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete conversation",
          style: "destructive",
          onPress: () => void (async () => {
            if (!token || !targetId) return;
            try {
              await apiJson(`/api/dms/${encodeURIComponent(targetId)}`, { method: "DELETE" }, token);
              setMessages([]);
              if (embedded) onClosed?.();
              else router.back();
            } catch (error) {
              Alert.alert("Could not delete conversation", error instanceof Error ? error.message : "Please try again.");
            }
          })(),
        },
      ],
    );
  };
  const loadOlder = async () => {
    if (!token || !targetId || loadingOlder || !hasOlder || messages.length === 0) return;
    setLoadingOlder(true);
    try {
      const data = await apiJson<{ messages: DirectMessage[] }>(
        `/api/dms/${encodeURIComponent(targetId)}?before=${encodeURIComponent(messages[0].id)}`,
        {},
        token,
      );
      const older = data.messages ?? [];
      if (older.length === 0) setHasOlder(false);
      setMessages((current) => {
        const ids = new Set(current.map((item) => item.id));
        return [...older.filter((item) => !ids.has(item.id)), ...current];
      });
    } catch (error) {
      console.warn("[dm] could not load older messages", error);
    } finally {
      setLoadingOlder(false);
    }
  };

  const sendAttachmentFrom = async (source: "library" | "camera") => {
    setMediaOpen(false);
    if (!token || !targetId) return;
    try {
      const asset = await pickMedia(source);
      if (!asset) return;
      setUploading(true);
      const attachment = await uploadAsset({ kind: "dm", userId: targetId }, asset, token);
      const text = `${MEDIA_ATTACHMENT_PREFIX}${JSON.stringify(attachment)}`;
      if (!send({ type: "DM_MESSAGE", targetUserId: targetId, text, replyToId: replyingTo?.id ?? null })) {
        throw new Error("Realtime is reconnecting. Try again in a moment.");
      }
      successHaptic();
      setReplyingTo(null);
    } catch (error) {
      Alert.alert("Could not send attachment", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setUploading(false);
    }
  };

  const sendGif = (gif: GiphyGif) => {
    const text = gifMessageText(gif);
    setMediaOpen(false);
    if (!text || !targetId) return;
    if (send({ type: "DM_MESSAGE", targetUserId: targetId, text, replyToId: replyingTo?.id ?? null })) {
      impactHaptic();
      setReplyingTo(null);
    } else {
      Alert.alert("Could not send GIF", "Realtime is reconnecting. Try again in a moment.");
    }
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || !targetId) return;
    if (editingId) {
      await saveEdit(text);
      return;
    }
    if (send({ type: "DM_MESSAGE", targetUserId: targetId, text, replyToId: replyingTo?.id ?? null })) {
      impactHaptic();
      setInput("");
      setReplyingTo(null);
      setSendFailed(false);
    } else {
      errorHaptic();
      setSendFailed(true);
    }
  };

  const openConversationMenu = () => {
    tapHaptic();
    const muteId = target?.id || targetId;
    const isMutedUser = !!muteId && mutedIds.has(muteId);
    const name = target?.username || fallbackName;
    const actions: Array<{ label: string; destructive?: boolean; run: () => void }> = [
      {
        label: isMutedUser ? "Unmute notifications" : "Mute notifications",
        run: () => {
          if (!muteId) return;
          toggleMute(muteId)
            .then(() => successHaptic())
            .catch((error) => {
              errorHaptic();
              Alert.alert("Could not update mute", error instanceof Error ? error.message : "Please try again.");
            });
        },
      },
      {
        label: `Report ${name}`,
        run: () =>
          setReportTarget({ targetType: "user", targetId, subjectUserId: target?.id || targetId, subjectUsername: name, contextType: "dm", contextId: targetId, contextLabel: `Private conversation with ${name}` }),
      },
      { label: "Delete conversation", destructive: true, run: deleteConversation },
    ];
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: name,
          options: [...actions.map((action) => action.label), "Cancel"],
          destructiveButtonIndex: actions.findIndex((action) => action.destructive),
          cancelButtonIndex: actions.length,
        },
        (index) => actions[index]?.run(),
      );
      return;
    }
    Alert.alert(name, undefined, [
      ...actions.map((action) => ({ text: action.label, style: action.destructive ? ("destructive" as const) : ("default" as const), onPress: action.run })),
      { text: "Cancel", style: "cancel" as const },
    ]);
  };

  const seenIndex = seenLastIdRef.current ? messages.findIndex((item) => item.id === seenLastIdRef.current) : -1;
  const newSinceScroll = !nearBottom && seenIndex >= 0 ? messages.length - 1 - seenIndex : 0;

  return (
    <>
      <KeyboardAware style={styles.flex}>
        <View style={styles.top}>
          {!embedded && (
            <Pressable accessibilityRole="button" accessibilityLabel="Back"
              style={styles.backButton}
              onPress={() => router.back()}
              hitSlop={8}
            >
              <Ionicons name="chevron-back" size={23} color={colors.cyan} />
            </Pressable>
          )}

          <Avatar
            username={target?.username || fallbackName}
            avatarUrl={target?.avatarUrl ?? null}
            online={target?.online}
            size={42}
          />

          <View style={styles.topCopy}>
            <Text style={styles.title} numberOfLines={1} maxFontSizeMultiplier={1.4}>
              {target?.username || fallbackName}
            </Text>

            <View style={styles.statusRow}>
              <View
                style={[
                  styles.statusDot,
                  connectionState !== "connected" && styles.statusDotWaiting,
                ]}
              />
              <Text
                numberOfLines={1}
                maxFontSizeMultiplier={1.3}
                style={[
                  styles.status,
                  connectionState !== "connected" && styles.statusWaiting,
                ]}
              >
                {connectionState === "connected"
                  ? target?.online
                    ? "Online · Private"
                    : "Private · Live"
                  : "Connecting…"}
              </Text>
            </View>
          </View>

          <Pressable
            style={styles.reportConversationButton}
            onPress={openConversationMenu}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Conversation options"
            accessibilityHint="Mute, report or delete this conversation"
          >
            <Ionicons name="ellipsis-horizontal" size={18} color={colors.cyan} />
          </Pressable>
        </View>

        <View style={styles.callButtons}>
          <Pressable accessibilityRole="button" style={styles.callButton} onPress={() => void startCall(targetId, false, target?.username || fallbackName)}>
            <Ionicons name="call-outline" size={17} color={colors.cyan} />
            <Text style={styles.callButtonText}>Voice</Text>
          </Pressable>
          <Pressable accessibilityRole="button" style={styles.callButton} onPress={() => void startCall(targetId, true, target?.username || fallbackName)}>
            <Ionicons name="videocam-outline" size={18} color={colors.cyan} />
            <Text style={styles.callButtonText}>Video</Text>
          </Pressable>
        </View>
        {!embedded && <VoiceFloatingBar style={{ marginTop: 6, marginBottom: 4 }} />}
        <FlatList
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.list,
            messages.length === 0 && styles.listEmpty,
          ]}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => {
            if (nearBottomRef.current) listRef.current?.scrollToEnd({ animated: false });
          }}
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          scrollEventThrottle={64}
          onScroll={(event) => {
            const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
            const near = contentSize.height - contentOffset.y - layoutMeasurement.height < 160;
            nearBottomRef.current = near;
            if (near !== nearBottom) {
              // Remember the newest message seen, to count what arrives while scrolled up.
              if (!near) seenLastIdRef.current = messages[messages.length - 1]?.id ?? null;
              setNearBottom(near);
            }
            if (contentOffset.y < 120) void loadOlder();
          }}
          ListHeaderComponent={loadingOlder ? <ActivityIndicator color={colors.cyan} style={{ marginVertical: 10 }} /> : null}
          ListEmptyComponent={
            !loaded ? <SkeletonRows variant="chat" rows={7} /> :
            loadError ? <LoadError message={loadError} onRetry={() => void load()} /> :
            <View style={styles.empty}>
              <View style={styles.emptyAvatar}>
                <Avatar
                  username={target?.username || fallbackName}
                  avatarUrl={target?.avatarUrl ?? null}
                  size={62}
                />
              </View>
              <Text style={styles.emptyTitle}>
                Start a conversation with {target?.username || fallbackName}
              </Text>
              <Text style={styles.emptyText}>
                Your direct messages will appear here.
              </Text>
            </View>
          }
          renderItem={({ item, index }) => {
            const own = item.fromUserId === user?.id;
            const legacyAttachment = parseLegacyAttachment(item.text);
            const replyTarget = item.replyToId
              ? messages.find((candidate) => candidate.id === item.replyToId)
              : undefined;
            const previous = index > 0 ? messages[index - 1] : undefined;
            const showDay =
              !previous ||
              formatDayLabel(previous.timestamp) !==
                formatDayLabel(item.timestamp);
            // Messages from one person within a few minutes form a run: one
            // avatar and one timestamp at the end, tighter spacing inside.
            const next = messages[index + 1];
            const endsRun = !inSameRun(item, next);

            return (
              <View>
                {showDay && (
                  <View style={styles.dayDivider}>
                    <View style={styles.dayLine} />
                    <Text style={styles.dayText}>
                      {formatDayLabel(item.timestamp)}
                    </Text>
                    <View style={styles.dayLine} />
                  </View>
                )}

                <View
                  style={[
                    styles.messageLine,
                    own && styles.messageLineOwn,
                    !endsRun && styles.messageLineInRun,
                  ]}
                >
                  {!own && (endsRun ? (
                    <Avatar
                      username={target?.username || fallbackName}
                      avatarUrl={target?.avatarUrl ?? null}
                      size={30}
                    />
                  ) : (
                    <View style={styles.avatarSpacer} />
                  ))}

                  <SwipeToReply maxWidth="80%" onReply={() => { impactHaptic(); beginReply(item); }}>
                  <Pressable
                    style={[
                    styles.message,
                    own && styles.messageOwn,
                    (legacyAttachment) && styles.attachmentMessage,
                    ]}
                    onLongPress={() => { tapHaptic(); setActionMessage(item); }}
                    delayLongPress={350}
                    accessibilityHint="Long press for message actions"
                  >
                    {replyTarget && (
                      <View style={styles.replyReference}>
                        <Text style={styles.replyReferenceText} numberOfLines={1}>
                          ↳ {replyTarget.fromUserId === user?.id ? "You" : target?.username || fallbackName}: {previewMessage(replyTarget.text)}
                        </Text>
                      </View>
                    )}
                    {legacyAttachment && isImageMime(legacyAttachment.mimeType) ? (
                      <MessageImage url={legacyAttachment.url} title={legacyAttachment.name} token={token} authenticated onSave={() => void downloadLegacyAttachment(legacyAttachment)} />
                    ) : parseGif(item.text) ? (
                      <MessageImage url={parseGif(item.text)!.url} title={parseGif(item.text)!.title} token={token} authenticated />
                    ) : legacyAttachment ? (
                      <Pressable accessibilityRole="button" style={styles.attachmentRow} onPress={() => void downloadLegacyAttachment(legacyAttachment)}>
                        <Ionicons name="document-outline" size={18} color={colors.cyan} />
                        <View style={styles.attachmentDetails}><Text style={styles.messageText} numberOfLines={1}>{legacyAttachment.name}</Text><Text style={{ color: colors.muted, fontSize: 12 }}>Tap to save or share</Text></View>
                      </Pressable>
                    ) : <LinkifiedText style={styles.messageText} text={item.text} />}

                    {!!item.reactions &&
                      Object.keys(item.reactions).length > 0 && (
                        <View style={styles.reactions}>
                          {Object.entries(item.reactions).map(
                            ([emoji, userIds]) => (
                              <Pressable
                                key={emoji}
                                accessibilityRole="button"
                                accessibilityLabel={`${emoji} ${userIds.length}`}
                                hitSlop={4}
                                onPress={() => { tapHaptic(); void reactToMessage(item, emoji); }}
                                style={[styles.reactionChip, !!user && userIds.includes(user.id) && { backgroundColor: "rgba(124,58,237,0.28)", borderColor: colors.violet }]}
                              >
                                <Text style={styles.reactionEmoji}>
                                  {emoji}
                                </Text>
                                <Text maxFontSizeMultiplier={1.3} style={styles.reactionCount}>
                                  {userIds.length}
                                </Text>
                              </Pressable>
                            ),
                          )}
                        </View>
                      )}

                    {endsRun && (
                      <Text
                        style={[
                          styles.time,
                          own && styles.timeOwn,
                        ]}
                      >
                        {formatMessageTime(item.timestamp)}
                        {own && index === messages.length - 1
                          ? peerReadAt && peerReadAt >= item.timestamp
                            ? " · Seen"
                            : " · Sent"
                          : ""}
                      </Text>
                    )}
                  </Pressable>
                  </SwipeToReply>
                </View>
              </View>
            );
          }}
        />

        {!nearBottom && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={newSinceScroll > 0 ? `${newSinceScroll} new messages. Jump to latest` : "Jump to latest messages"}
            onPress={() => { nearBottomRef.current = true; setNearBottom(true); listRef.current?.scrollToEnd({ animated: true }); }}
            style={{ position: "absolute", right: 16, bottom: 92, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, height: 32, borderRadius: 16, backgroundColor: colors.violet }}
          >
            <Ionicons name="arrow-down" size={15} color="#FFFFFF" />
            <Text style={{ color: "#FFFFFF", fontSize: 12, fontWeight: "900" }}>{newSinceScroll > 0 ? `${newSinceScroll > 99 ? "99+" : newSinceScroll} new` : "Latest"}</Text>
          </Pressable>
        )}
        {editingId && (
          <View style={styles.editingBanner}>
            <Ionicons name="create-outline" size={14} color={colors.cyan} />
            <Text style={styles.editingBannerText}>Editing message</Text>
            <Pressable accessibilityRole="button" onPress={cancelEdit}><Text style={styles.editingCancel}>Cancel</Text></Pressable>
          </View>
        )}
        {replyingTo && (
          <View style={styles.replyingBanner}>
            <Ionicons name="arrow-undo-outline" size={14} color={colors.cyan} />
            <Text style={styles.replyingBannerText} numberOfLines={1}>
              Replying to {replyingTo.fromUserId === user?.id ? "You" : target?.username || fallbackName}: {previewMessage(replyingTo.text)}
            </Text>
            <Pressable accessibilityRole="button" onPress={() => setReplyingTo(null)}>
              <Text style={styles.editingCancel}>Cancel</Text>
            </Pressable>
          </View>
        )}
        {<View style={styles.composerShell}>
          {sendFailed && <SendFailedBanner onRetry={() => void sendMessage()} onDismiss={() => setSendFailed(false)} />}
          <View style={styles.composer}>
            <Pressable
              style={styles.composerIcon}
              onPress={() => setMediaOpen(true)}
              disabled={uploading}
              accessibilityRole="button"
              accessibilityLabel="Add photo, video or GIF"
            >
              {uploading ? <ActivityIndicator size="small" color={colors.cyan} /> : <Ionicons name="add" size={21} color={colors.cyan} />}
            </Pressable>

            <TextInput
              testID="dm-composer"
              value={input}
              onChangeText={setInput}
              placeholder={`Message ${target?.username || fallbackName}`}
              placeholderTextColor={colors.faint}
              style={styles.input}
              multiline
                            submitBehavior={returnSends ? "submit" : "newline"}
              onSubmitEditing={returnSends ? () => void sendMessage() : undefined}
              maxLength={4000}
              textAlignVertical="center"
            />

            <Pressable
              style={[
                styles.send,
                (!input.trim()) && styles.sendDisabled,
              ]}
              disabled={!input.trim()}
              onPress={sendMessage}
              accessibilityRole="button"
              accessibilityLabel="Send message"
            >
              <Ionicons name="arrow-up" size={20} color="#fff" />
            </Pressable>
          </View>
        </View>}
      </KeyboardAware>

      <Modal visible={actionMessage !== null} transparent animationType="fade" onRequestClose={() => setActionMessage(null)}>
        <Pressable style={styles.actionBackdrop} onPress={() => setActionMessage(null)}>
          <Pressable style={styles.actionSheet} onPress={() => {}}>
            <View style={styles.actionGrabber} />
            {actionMessage && <MessagePreview author={(target?.username || fallbackName)} text={actionMessage.text} mine={actionMessage.fromUserId === user?.id} />}
            <View style={styles.emojiGrid}>
              {DM_REACTION_EMOJIS.map((emoji) => (
                <Pressable accessibilityRole="button" key={emoji} style={styles.emojiButton} onPress={() => actionMessage && void reactToMessage(actionMessage, emoji)}>
                  <Text style={styles.emojiButtonText}>{emoji}</Text>
                </Pressable>
              ))}
            </View>
            {actionMessage && (
              <Pressable accessibilityRole="button" style={styles.sheetAction} onPress={() => beginReply(actionMessage)}>
                <Ionicons name="arrow-undo-outline" size={18} color={colors.cyan} />
                <Text style={styles.sheetActionText}>Reply</Text>
              </Pressable>
            )}
            {actionMessage?.fromUserId !== user?.id && actionMessage && (
              <Pressable accessibilityRole="button" style={styles.sheetAction} onPress={() => { const message = actionMessage; setActionMessage(null); setReportTarget({ targetType: "message", targetId: message.id, subjectUserId: target?.id || targetId, subjectUsername: target?.username || fallbackName, contextType: "dm", contextId: targetId, contextLabel: `Private conversation with ${target?.username || fallbackName}` }); }}>
                <Ionicons name="flag-outline" size={18} color={colors.cyan} />
                <Text style={styles.sheetActionText}>Report message</Text>
              </Pressable>
            )}
            {actionMessage?.fromUserId === user?.id && (
              <>
                <Pressable accessibilityRole="button" style={styles.sheetAction} onPress={() => { const message = actionMessage; setActionMessage(null); if (message) beginEdit(message); }}>
                  <Ionicons name="create-outline" size={18} color={colors.cyan} />
                  <Text style={styles.sheetActionText}>Edit message</Text>
                </Pressable>
                <Pressable accessibilityRole="button" style={[styles.sheetAction, styles.sheetDanger]} onPress={() => actionMessage && deleteMessage(actionMessage)}>
                  <Ionicons name="trash-outline" size={18} color={colors.red} />
                  <Text style={[styles.sheetActionText, { color: colors.red }]}>Delete message</Text>
                </Pressable>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
      <ComposerMediaSheet
        visible={mediaOpen}
        token={token}
        onClose={() => setMediaOpen(false)}
        onPickLibrary={() => void sendAttachmentFrom("library")}
        onPickCamera={() => void sendAttachmentFrom("camera")}
        onGif={sendGif}
      />
      <ReportSheet
        visible={reportTarget !== null}
        token={token}
        target={reportTarget}
        onClose={() => setReportTarget(null)}
        onSubmitted={() => setTimeout(() => setReportTarget(null), 900)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  callButtons: { flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  callButton: { flex: 1, minHeight: 40, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderRadius: 12, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border },
  callButtonText: { color: colors.text, fontSize: 12, fontWeight: "900" },
  reportConversationButton: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: colors.cyanSoft, borderWidth: 1, borderColor: colors.border },
  actionBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(2,5,12,.72)" },
  actionSheet: { padding: 16, paddingBottom: 28, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border },
  actionGrabber: { alignSelf: "center", width: 42, height: 4, borderRadius: 99, backgroundColor: colors.border, marginBottom: 13 },
  emojiGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  emojiButton: { width: 48, height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border },
  emojiButtonText: { fontSize: 21 },
  sheetAction: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 11, borderRadius: 13, backgroundColor: colors.panel2, marginTop: 7 },
  sheetDanger: { backgroundColor: colors.redSoft },
  sheetActionText: { color: colors.text, fontSize: 13, fontWeight: "900" },
  editingBanner: { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: colors.cyanSoft, borderTopWidth: 1, borderTopColor: colors.border },
  editingBannerText: { flex: 1, color: colors.text, fontSize: 12, fontWeight: "800" },
  editingCancel: { color: colors.cyan, fontSize: 12, fontWeight: "900" },
  replyingBanner: { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: colors.cyanSoft, borderTopWidth: 1, borderTopColor: colors.border },
  replyingBannerText: { flex: 1, color: colors.text, fontSize: 12, fontWeight: "800" },
  flex: {
    flex: 1,
  },
  top: {
    minHeight: 78,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.bg,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
  },
  topCopy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: colors.text,
    fontWeight: "900",
    fontSize: 16,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 3,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 99,
    backgroundColor: colors.green,
  },
  statusDotWaiting: {
    backgroundColor: colors.yellow,
  },
  status: {
    color: colors.green,
    fontSize: 13,
    fontWeight: "800",
  },
  statusWaiting: {
    color: colors.yellow,
  },
  list: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 18,
  },
  listEmpty: {
    flexGrow: 1,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    paddingBottom: 80,
  },
  emptyAvatar: {
    borderRadius: 99,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    padding: 3,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "900",
    textAlign: "center",
    marginTop: 14,
  },
  emptyText: {
    color: colors.muted,
    fontSize: 12,
    textAlign: "center",
    marginTop: 5,
  },
  dayDivider: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    marginVertical: 14,
  },
  dayLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dayText: {
    color: colors.faint,
    fontSize: 13,
    fontWeight: "800",
  },
  messageLine: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 7,
    marginBottom: 7,
  },
  messageLineInRun: { marginBottom: 2 },
  avatarSpacer: { width: 30 },
  messageLineOwn: {
    justifyContent: "flex-end",
  },
  message: {
    maxWidth: "100%",
    paddingHorizontal: 12,
    paddingTop: 9,
    paddingBottom: 7,
    borderRadius: 17,
    borderBottomLeftRadius: 6,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
  },
  messageOwn: {
    borderBottomLeftRadius: 17,
    borderBottomRightRadius: 6,
    backgroundColor: "rgba(124,92,255,.18)",
    borderColor: "rgba(124,92,255,.34)",
  },
  attachmentMessage: {
    width: "80%",
    minWidth: 180,
  },
  attachmentRow: {
    width: "100%",
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 4,
  },
  attachmentDetails: {
    flex: 1,
    minWidth: 0,
    flexShrink: 1,
  },
  messageText: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 19,
  },
  replyReference: {
    maxWidth: "100%",
    borderLeftWidth: 2,
    borderLeftColor: colors.cyan,
    paddingLeft: 7,
    marginBottom: 7,
  },
  replyReferenceText: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 14,
  },
  reactions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    marginTop: 7,
  },
  reactionChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 99,
    backgroundColor: colors.panel2,
  },
  reactionEmoji: {
    fontSize: 13,
  },
  reactionCount: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800",
  },
  time: {
    color: colors.faint,
    fontSize: 11,
    marginTop: 5,
    alignSelf: "flex-start",
  },
  timeOwn: {
    alignSelf: "flex-end",
  },
  composerShell: {
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  composer: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    padding: 6,
    borderRadius: 18,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  composerIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.panel2,
  },
  input: {
    flex: 1,
    minHeight: 36,
    maxHeight: 120,
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
    paddingHorizontal: 2,
    paddingVertical: 8,
  },
  send: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.violet,
  },
  sendDisabled: {
    opacity: 0.34,
  },});

