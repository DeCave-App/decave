import { useLocalSearchParams, router } from "expo-router";
import { Screen } from "@/src/components/Screen";
import { useSession } from "@/src/providers/SessionProvider";
import { useIsWide, useHardwareKeyboard } from "@/src/lib/layout";
import { useUnread } from "@/src/providers/UnreadProvider";
import { useEffect, useState, useRef } from "react";
import { useRealtime } from "@/src/providers/RealtimeProvider";
import type { ChatMessage } from "@/src/types";
import { useDraftInput } from "@/src/lib/drafts";
import ReportSheet, { REPORT_CONFIRMATION_MS, type MobileReportTarget } from "@/src/components/ReportSheet";
import { useMutedUsers } from "@/src/providers/MutedUsersProvider";
import { FlatList, Platform, Alert, View, Pressable, Text, ActivityIndicator, TextInput, Modal } from "react-native";
import { downloadLegacyAttachmentMobile, LegacyAttachmentError } from "@/src/lib/legacy-attachment-download";
import { API_BASE, apiFetch, apiJson } from "@/src/lib/api";
import { pickMedia, uploadAsset, type GiphyGif, gifMessageText, parseGif, isImageMime } from "@/src/lib/chat-media";
import { successHaptic, impactHaptic, errorHaptic, tapHaptic } from "@/src/lib/haptics";
import {
  parseForumPost,
  formatDayLabel,
  formatMessageTime,
  previewMessage,
  messagePreviewText,
  renderMessageText,
  formatAttachmentSize,
  CHANNEL_REACTION_EMOJIS,
} from "@/src/components/channel/messageFormat";
import { KeyboardAware } from "@/src/components/KeyboardAware";
import { styles } from "@/src/components/channel/channelScreen.styles";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/src/theme";
import { VoiceFloatingBar } from "@/src/components/VoiceFloatingBar";
import { SkeletonRows } from "@/src/components/Skeleton";
import { LoadError } from "@/src/components/LoadError";
import { SwipeToReply } from "@/src/components/SwipeToReply";
import { Avatar } from "@/src/components/Avatar";
import { MessageImage } from "@/src/components/MessageMedia";
import { firstLink, LinkChip } from "@/src/components/LinkifiedText";
import { SendFailedBanner } from "@/src/components/SendFailedBanner";
import { MessagePreview } from "@/src/components/MessagePreview";
import { ComposerMediaSheet } from "@/src/components/ComposerMediaSheet";
import { ChannelFinderSheet } from "@/src/components/ChannelFinderSheet";

type ChannelParams = {
  id: string;
  hubId?: string;
  name?: string;
  voice?: string;
  squad?: string;
  forum?: string;
};

export default function ChannelScreen() {
  const params = useLocalSearchParams<ChannelParams>();
  return (
    <Screen>
      <ChannelView params={params} />
    </Screen>
  );
}

/**
 * The room chat. Rendered full-screen on iPhone, and as the right-hand pane of
 * the hub screen on iPad (embedded: no back button, the room list stays put).
 */
export function ChannelView({ params, embedded = false }: { params: ChannelParams; embedded?: boolean }) {

  const channelId = Number(params.id);
  const hubId = Number(params.hubId ?? 0);
  const name = typeof params.name === "string" ? params.name : "Room";
  const isVoiceRoom = params.voice === "1";
  const isForum = params.forum === "1";

  const { token, user } = useSession();
  const wide = useIsWide();
  const hardwareKeyboard = useHardwareKeyboard();
  // Return sends only with a hardware keyboard on iPad; on-screen Return adds a line.
  const returnSends = wide && hardwareKeyboard;
  const { setOpenRoom } = useUnread();
  useEffect(() => {
    if (!embedded) return;
    setOpenRoom(channelId);
    return () => setOpenRoom(null);
  }, [embedded, channelId, setOpenRoom]);
  const {
    send,
    lastEvent,
    connectionState,
    subscribe,
  } = useRealtime();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null); // DECAVE_FINAL_CHANNEL_PASS
  const [input, setInput, restoreDraft] = useDraftInput(`room:${channelId}`, editingId != null);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [actionMessage, setActionMessage] = useState<ChatMessage | null>(null);
  const [reportTarget, setReportTarget] = useState<MobileReportTarget | null>(null);
  const { mutedIds, toggleMute } = useMutedUsers();
  const [finder, setFinder] = useState<"search" | "pins" | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [typingUsers, setTypingUsers] = useState<Record<string, { username: string; until: number }>>({});
  const typingSentRef = useRef(0);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [hasOlder, setHasOlder] = useState(true);
  const [nearBottom, setNearBottom] = useState(true);
  const nearBottomRef = useRef(true);
  const seenLastIdRef = useRef<string | null>(null);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const loadGenerationRef = useRef(0);

  const downloadLegacyAttachment = async (attachment: NonNullable<ChatMessage["attachment"]>) => {
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
    if (!token || !channelId) return;
    const generation = ++loadGenerationRef.current;

    try {
      const nextMessages =
        await apiJson<ChatMessage[]>(
          `/api/channels/${channelId}/messages`,
          {},
          token,
        );
      if (generation !== loadGenerationRef.current) return;
      if (nextMessages.length < 100) setHasOlder(false);
      // Keep any older pages already loaded above the latest page.
      setMessages((current) => {
        const latestIds = new Set(nextMessages.map((item) => item.id));
        const firstLatest = nextMessages[0]?.timestamp ?? "";
        const older = current.filter((item) => !latestIds.has(item.id) && item.timestamp < firstLatest);
        return [...older, ...nextMessages];
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
    setMessages([]);
    setActionMessage(null);
    setReplyingTo(null);
    setEditingId(null);
    void load();

    if (hubId) {
      send({ type: "JOIN_SERVER", serverId: hubId });
    }

    send({ type: "JOIN_CHANNEL", channelId });
  }, [hubId, token, channelId, send]);

  useEffect(() => {
    if (!lastEvent) return;

    const eventType = lastEvent.type;

    if (
      (eventType === "CHAT_MESSAGE" &&
        Number(lastEvent.channelId) === channelId) ||
      (eventType === "MESSAGE_UPDATED" &&
        Number(
          (lastEvent.message as { channelId?: number } | undefined)
            ?.channelId,
        ) === channelId) ||
      (eventType === "MESSAGE_DELETED" &&
        Number(lastEvent.channelId) === channelId)
    ) {
      void load();
    }
  }, [lastEvent]);

  // Typing indicators: others' TYPING events expire after a few seconds.
  useEffect(() => {
    setTypingUsers({});
    return subscribe((event) => {
      if (event.type !== "TYPING" || Number(event.channelId) !== channelId) return;
      const userId = typeof event.userId === "string" ? event.userId : "";
      const username = typeof event.username === "string" ? event.username : "";
      if (!userId || userId === user?.id) return;
      setTypingUsers((current) => {
        const next = { ...current };
        if (event.active === true) next[userId] = { username, until: Date.now() + 4000 };
        else delete next[userId];
        return next;
      });
    });
  }, [subscribe, channelId, user?.id]);

  useEffect(() => {
    if (Object.keys(typingUsers).length === 0) return;
    const timer = setInterval(() => {
      setTypingUsers((current) => {
        const now = Date.now();
        const entries = Object.entries(current).filter(([, value]) => value.until > now);
        return entries.length === Object.keys(current).length ? current : Object.fromEntries(entries);
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [typingUsers]);

  // Leaving mid-sentence: clear our "typing…" for others instead of letting it linger.
  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(
    () => () => {
      if (typingSentRef.current) sendRef.current({ type: "TYPING", channelId, active: false });
      typingSentRef.current = 0;
    },
    [channelId],
  );

  const onChangeInput = (text: string) => {
    setInput(text);
    if (editingId) return;
    const now = Date.now();
    if (text.trim() && now - typingSentRef.current > 2500) {
      typingSentRef.current = now;
      send({ type: "TYPING", channelId, active: true });
    } else if (!text.trim() && typingSentRef.current) {
      typingSentRef.current = 0;
      send({ type: "TYPING", channelId, active: false });
    }
  };

  const loadOlder = async () => {
    if (!token || loadingOlder || !hasOlder || messages.length === 0) return;
    setLoadingOlder(true);
    try {
      const older = await apiJson<ChatMessage[]>(
        `/api/channels/${channelId}/messages?before=${encodeURIComponent(messages[0].id)}`,
        {},
        token,
      );
      if (older.length === 0) setHasOlder(false);
      setMessages((current) => {
        const ids = new Set(current.map((item) => item.id));
        return [...older.filter((item) => !ids.has(item.id)), ...current];
      });
    } catch (error) {
      console.warn("[channel] could not load older messages", error);
    } finally {
      setLoadingOlder(false);
    }
  };

  const sendAttachmentFrom = async (source: "library" | "camera") => {
    setMediaOpen(false);
    if (!token) return;
    try {
      const asset = await pickMedia(source);
      if (!asset) return;
      setUploading(true);
      const attachment = await uploadAsset({ kind: "channel", channelId }, asset, token);
      const text = input.trim();
      if (!send({ type: "CHAT_MESSAGE", text, channelId, replyToId: replyingTo?.id ?? null, attachment })) {
        throw new Error("Realtime is reconnecting. Try again in a moment.");
      }
      successHaptic();
      setInput("");
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
    if (!text) return;
    if (send({ type: "CHAT_MESSAGE", text, channelId, replyToId: replyingTo?.id ?? null, attachment: null })) {
      impactHaptic();
      setReplyingTo(null);
    } else {
      Alert.alert("Could not send GIF", "Realtime is reconnecting. Try again in a moment.");
    }
  };

  const togglePin = async (message: ChatMessage) => {
    setActionMessage(null);
    if (!token) return;
    try {
      const updated = await apiJson<ChatMessage>(
        `/api/channels/${channelId}/messages/${encodeURIComponent(message.id)}/pin`,
        { method: "POST" },
        token,
      );
      setMessages((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      successHaptic();
    } catch (error) {
      errorHaptic();
      Alert.alert(message.pinned ? "Could not unpin message" : "Could not pin message", error instanceof Error ? error.message : "Please try again.");
    }
  };

  const jumpTo = (message: ChatMessage) => {
    setFinder(null);
    const index = messages.findIndex((item) => item.id === message.id);
    if (index < 0) {
      Alert.alert("Older message", "This message is further back than the loaded history.");
      return;
    }
    setHighlightId(message.id);
    setTimeout(() => setHighlightId(null), 2200);
    listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.4 });
  };

  const typingNames = Object.values(typingUsers).map((value) => value.username);

  const reactToMessage = async (message: ChatMessage, emoji: string) => {
    try {
      if (!token) return;
      const data = await apiJson<{ message?: ChatMessage }>(
        `/api/channels/${channelId}/messages/${encodeURIComponent(message.id)}/reactions`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ emoji }) },
        token,
      );
      if (data.message) setMessages((current) => current.map((item) => item.id === data.message!.id ? data.message! : item));
      else void load();
    } catch (error) {
      Alert.alert("Could not add reaction", error instanceof Error ? error.message : "Please try again.");
    }
  };

  const beginEdit = (message: ChatMessage) => {
    if (message.userId !== user?.id || parseForumPost(message.text)) return;
    setReplyingTo(null);
    setEditingId(message.id);
    setInput(message.text, false);
  };

  const beginReply = (message: ChatMessage) => {
    setActionMessage(null);
    setEditingId(null);
    setReplyingTo(message);
  };

  const cancelEdit = () => {
    setEditingId(null);
    restoreDraft();
  };

  const deleteMessage = (message: ChatMessage) => {
    if (message.userId !== user?.id) return;
    Alert.alert("Delete message?", "This removes the message for everyone in this room.", [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => void (async () => {
          try {
            if (!token) return;
            await apiJson(`/api/channels/${channelId}/messages/${encodeURIComponent(message.id)}`, { method: "DELETE" }, token);
          setMessages((current) => current.filter((item) => item.id !== message.id));
          setActionMessage(null);
        } catch (error) {
          Alert.alert("Could not delete message", error instanceof Error ? error.message : "Please try again.");
        }
      })() },
    ]);
  };

  const saveEdit = async (text: string) => {
    if (!editingId) return;
    try {
      if (!token) return;
      const data = await apiJson<{ message?: ChatMessage }>(
        `/api/channels/${channelId}/messages/${encodeURIComponent(editingId)}`,
        { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) },
        token,
      );
      if (data.message) setMessages((current) => current.map((item) => item.id === data.message!.id ? data.message! : item));
      else void load();
      setEditingId(null);
      restoreDraft();
    } catch (error) {
      Alert.alert(
        "Could not edit message",
        error instanceof Error ? error.message : "The message was not changed.",
      );
    }
  };
  const sendMessage = async () => {
    const text = input.trim();
    if (!text) return;
    if (editingId) {
      await saveEdit(text);
      return;
    }
    if (send({ type: "CHAT_MESSAGE", text, channelId, replyToId: replyingTo?.id ?? null, attachment: null })) {
      if (typingSentRef.current) send({ type: "TYPING", channelId, active: false });
      typingSentRef.current = 0;
      impactHaptic();
      setInput("");
      setReplyingTo(null);
      setSendFailed(false);
    } else {
      errorHaptic();
      setSendFailed(true);
    }
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

          <View style={styles.channelIcon}>
            <Ionicons
              name={isForum ? "albums" : "chatbubble-ellipses"}
              size={17}
              color={colors.cyan}
            />
          </View>

          <View style={styles.topCopy}>
            <Text style={styles.title} numberOfLines={1} maxFontSizeMultiplier={1.4}>
              {name}
            </Text>
            <View style={styles.statusRow}>
              <View
                style={[
                  styles.statusDot,
                  connectionState !== "connected" &&
                    styles.statusDotWaiting,
                ]}
              />
            <Text
                numberOfLines={1}
                maxFontSizeMultiplier={1.3}
                style={[
                  styles.status,
                  connectionState !== "connected" &&
                    styles.statusWaiting,
                ]}
              >
                {connectionState === "connected" ? "Live" : "Connecting…"}
              </Text>
            </View>
          </View>

          <Pressable
            style={styles.hashBadge}
            onPress={() => setFinder("search")}
            accessibilityRole="button"
            accessibilityLabel="Search messages"
            hitSlop={6}
          >
            <Ionicons name="search" size={16} color={colors.cyan} />
          </Pressable>
          <Pressable
            style={styles.hashBadge}
            onPress={() => setFinder("pins")}
            accessibilityRole="button"
            accessibilityLabel="Pinned messages"
            hitSlop={6}
          >
            <Ionicons name="pin-outline" size={16} color={colors.cyan} />
          </Pressable>

          {isVoiceRoom ? (
            <Pressable accessibilityRole="button"
              style={styles.hashBadge}
              onPress={() => router.replace(`/voice/${channelId}?hubId=${hubId}&name=${encodeURIComponent(name)}${params.squad === "1" ? "&squad=1" : ""}`)}
              accessibilityLabel="Return to voice controls"
            >
              <Ionicons name="volume-high" size={16} color={colors.cyan} />
            </Pressable>
          ) : (
            <View style={styles.hashBadge}>
              <Text style={styles.hashText}>#</Text>
            </View>
          )}
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
            if (!highlightId && nearBottomRef.current) listRef.current?.scrollToEnd({ animated: false });
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
          onScrollToIndexFailed={(info) => {
            listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: true });
            setTimeout(() => listRef.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0.4 }), 250);
          }}
          ListEmptyComponent={
            !loaded ? <SkeletonRows variant="chat" rows={7} /> :
            loadError ? <LoadError message={loadError} onRetry={() => void load()} /> :
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <Ionicons
                  name="chatbubble-ellipses-outline"
                  size={29}
                  color={colors.cyan}
                />
              </View>
              <Text style={styles.emptyTitle}>Welcome to {isVoiceRoom ? "" : "#"}{name}</Text>
              <Text style={styles.emptyText}>
                {isVoiceRoom
                  ? "Voice and messages live together in this room."
                  : isForum
                    ? "No posts in this forum yet."
                    : "This is the beginning of this text room."}
              </Text>
            </View>
          }
          renderItem={({ item, index }) => {
            const own = item.userId === user?.id;
            const replyTarget = item.replyToId
              ? messages.find((candidate) => candidate.id === item.replyToId)
              : undefined;
            const previous = index > 0 ? messages[index - 1] : undefined;

            const showDay =
              !previous ||
              formatDayLabel(previous.timestamp) !==
                formatDayLabel(item.timestamp);

            const grouped =
              !!previous &&
              previous.userId === item.userId &&
              Date.parse(item.timestamp) -
                Date.parse(previous.timestamp) <
                5 * 60_000 &&
              !showDay;

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

                <SwipeToReply onReply={() => { impactHaptic(); beginReply(item); }}>
                <Pressable
                  style={[
                    styles.messageRow,
                    grouped && styles.messageRowGrouped,
                    own && styles.messageRowOwn,
                    highlightId === item.id && styles.messageHighlight,
                  ]}
                  onLongPress={() => { tapHaptic(); setActionMessage(item); }}
                  delayLongPress={350}
                  accessibilityHint="Long press for message actions"
                >
                  {!grouped ? (
                    <Avatar
                      username={item.username}
                      avatarUrl={item.avatarUrl}
                      size={36}
                    />
                  ) : (
                    <View style={styles.avatarSpacer} />
                  )}

                  <View
                    style={[
                      styles.messageBody,
                      own && styles.messageBodyOwn,
                    ]}
                  >
                    {!grouped && (
                      <View style={styles.messageHead}>
                        <Text
                          style={[
                            styles.username,
                            own && styles.usernameOwn,
                          ]}
                          numberOfLines={1}
                        >
                          {item.username}
                        </Text>

                        <Text style={styles.time}>
                          {formatMessageTime(item.timestamp)}
                        </Text>

                        {item.role &&
                          (item.role === "owner" ||
                            item.role === "admin") && (
                            <View style={styles.roleChip}>
                              <Text style={styles.roleChipText}>
                                {item.role.toUpperCase()}
                              </Text>
                            </View>
                          )}
                      </View>
                    )}

                    {replyTarget && (
                      <View style={styles.replyReference}>
                        <Text style={styles.replyReferenceText} numberOfLines={1}>
                          ↳ {replyTarget.username}: {previewMessage(messagePreviewText(replyTarget.text))}
                        </Text>
                      </View>
                    )}

                    {item.pinned && (
                      <View style={styles.pinnedTag}>
                        <Ionicons name="pin" size={11} color={colors.yellow} />
                        <Text maxFontSizeMultiplier={1.3} style={styles.pinnedTagText}>Pinned</Text>
                      </View>
                    )}

                                        {parseGif(item.text) ? (
                      <MessageImage url={parseGif(item.text)!.url} title={parseGif(item.text)!.title} token={token} authenticated />
                    ) : !item.text ? null : (() => {
                      const post = parseForumPost(item.text);
                      if (!post) {
                        return (
                          <>
                            <Text style={styles.messageText}>
                              {renderMessageText(item.text, user?.username)}
                            </Text>
                            {firstLink(item.text) ? <LinkChip url={firstLink(item.text)!} /> : null}
                          </>
                        );
                      }
                      return (
                        <View style={styles.forumPost}>
                          <Text style={styles.forumTitle}>{post.title}</Text>
                          {post.tags.length > 0 && (
                            <View style={styles.forumTags}>
                              {post.tags.map((tag) => (
                                <Text key={tag} style={styles.forumTag}>{tag}</Text>
                              ))}
                            </View>
                          )}
                          {!!post.body && (
                            <Text style={styles.messageText}>
                              {renderMessageText(post.body, user?.username)}
                            </Text>
                          )}
                        </View>
                      );
                    })()}

                    

                    {!!item.attachment && isImageMime(item.attachment.mimeType) ? (
                      <MessageImage
                        url={item.attachment.url}
                        title={item.attachment.name}
                        token={token}
                        authenticated
                        onSave={() => void downloadLegacyAttachment(item.attachment!)}
                      />
                    ) : !!item.attachment && (
                      <Pressable accessibilityRole="button"
                        style={styles.attachment}
                        onPress={() => {
                          void downloadLegacyAttachment(item.attachment!);
                        }}
                      >
                        <View style={styles.attachmentIcon}>
                          <Ionicons
                            name="document-outline"
                            size={18}
                            color={colors.cyan}
                          />
                        </View>
                        <View style={styles.attachmentCopy}>
                          <Text
                            style={styles.attachmentName}
                            numberOfLines={1}
                          >
                            {item.attachment.name}
                          </Text>
                          <Text style={styles.attachmentMeta}>
                            {item.attachment.mimeType}
                            {!!item.attachment.size &&
                              ` · ${formatAttachmentSize(
                                item.attachment.size,
                              )}`}
                          </Text>
                        </View>
                        <Ionicons
                          name="open-outline"
                          size={16}
                          color={colors.muted}
                        />
                      </Pressable>
                    )}

                    {!!item.reactions &&
                      Object.keys(item.reactions).length > 0 && (
                        <View style={styles.reactions}>
                          {Object.entries(item.reactions).map(
                            ([emoji, userIds]) => (
                              <Pressable
                                key={emoji}
                                accessibilityRole="button"
                                accessibilityLabel={`${emoji} ${userIds.length}${user && userIds.includes(user.id) ? ", you reacted" : ""}`}
                                onPress={() => { tapHaptic(); void reactToMessage(item, emoji); }}
                                hitSlop={4}
                                style={[styles.reactionChip, !!user && userIds.includes(user.id) && styles.reactionChipMine]}
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

                    {!!item.editedAt && (
                      <Text style={styles.edited}>edited</Text>
                    )}

                    {grouped && (
                      <Text style={styles.groupedTime}>
                        {formatMessageTime(item.timestamp)}
                      </Text>
                    )}
                  </View>
                </Pressable>
                </SwipeToReply>
              </View>
            );
          }}
        />

        {!nearBottom && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={newSinceScroll > 0 ? `${newSinceScroll} new messages. Jump to latest` : "Jump to latest messages"}
            onPress={() => { nearBottomRef.current = true; setNearBottom(true); listRef.current?.scrollToEnd({ animated: true }); }}
            style={styles.jumpLatest}
          >
            <Ionicons name="arrow-down" size={15} color="#FFFFFF" />
            <Text style={styles.jumpLatestText}>{newSinceScroll > 0 ? `${newSinceScroll > 99 ? "99+" : newSinceScroll} new` : "Latest"}</Text>
          </Pressable>
        )}
        {typingNames.length > 0 && (
          <View style={styles.typingRow}>
            <Text style={styles.typingText} numberOfLines={1}>
              {typingNames.length === 1
                ? `${typingNames[0]} is typing…`
                : typingNames.length === 2
                  ? `${typingNames[0]} and ${typingNames[1]} are typing…`
                  : "Several people are typing…"}
            </Text>
          </View>
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
              Replying to {replyingTo.username}: {previewMessage(messagePreviewText(replyingTo.text))}
            </Text>
            <Pressable accessibilityRole="button" onPress={() => setReplyingTo(null)}>
              <Text style={styles.editingCancel}>Cancel</Text>
            </Pressable>
          </View>
        )}
        {isForum && !replyingTo ? (
          <View style={styles.composerShell}>
            <Text style={styles.composerHint}>
              Long press a post to reply. New forum posts can be started on desktop or web.
            </Text>
          </View>
        ) : <View style={styles.composerShell}>
          {sendFailed && <SendFailedBanner onRetry={() => void sendMessage()} onDismiss={() => setSendFailed(false)} />}
          <View style={styles.composer}>
            <Pressable
              style={styles.plusButton}
              onPress={() => setMediaOpen(true)}
              disabled={uploading}
              accessibilityRole="button"
              accessibilityLabel="Add photo, video or GIF"
            >
              {uploading ? <ActivityIndicator size="small" color={colors.cyan} /> : <Ionicons name="add" size={21} color={colors.cyan} />}
            </Pressable>

            <TextInput
              testID="room-composer"
              value={input}
              onChangeText={onChangeInput}
              placeholder={replyingTo && isForum ? "Write a reply" : `Message #${name}`}
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
            {actionMessage && <MessagePreview author={actionMessage.username} text={actionMessage.text} mine={actionMessage.userId === user?.id} />}
            <View style={styles.emojiGrid}>
              {CHANNEL_REACTION_EMOJIS.map((emoji) => <Pressable accessibilityRole="button" key={emoji} style={styles.emojiButton} onPress={() => { const message=actionMessage; setActionMessage(null); if(message) void reactToMessage(message,emoji); }}><Text style={styles.emojiButtonText}>{emoji}</Text></Pressable>)}
            </View>
            {actionMessage && <Pressable accessibilityRole="button" style={styles.sheetAction} onPress={() => void togglePin(actionMessage)}><Ionicons name={actionMessage.pinned ? "pin" : "pin-outline"} size={18} color={colors.cyan}/><Text style={styles.sheetActionText}>{actionMessage.pinned ? "Unpin message" : "Pin message"}</Text></Pressable>}
            {actionMessage && <Pressable accessibilityRole="button" style={styles.sheetAction} onPress={() => beginReply(actionMessage)}><Ionicons name="arrow-undo-outline" size={18} color={colors.cyan}/><Text style={styles.sheetActionText}>Reply</Text></Pressable>}
            {actionMessage && actionMessage.userId !== user?.id && <Pressable accessibilityRole="button" style={styles.sheetAction} onPress={() => { const message = actionMessage; setActionMessage(null); toggleMute(message.userId).then(() => successHaptic()).catch((error) => { errorHaptic(); Alert.alert("Could not update mute", error instanceof Error ? error.message : "Please try again."); }); }}><Ionicons name={mutedIds.has(actionMessage.userId) ? "notifications-outline" : "notifications-off-outline"} size={18} color={colors.cyan}/><Text style={styles.sheetActionText}>{mutedIds.has(actionMessage.userId) ? `Unmute ${actionMessage.username}` : `Mute notifications from ${actionMessage.username}`}</Text></Pressable>}
            {actionMessage && actionMessage.userId !== user?.id && <Pressable accessibilityRole="button" style={styles.sheetAction} onPress={() => { const message = actionMessage; setActionMessage(null); setReportTarget({ targetType: message.attachment ? "attachment" : "message", targetId: message.id, subjectUserId: message.userId, subjectUsername: message.username, contextType: "channel", contextId: String(channelId), contextLabel: `#${name}` }); }}><Ionicons name="flag-outline" size={18} color={colors.cyan}/><Text style={styles.sheetActionText}>Report message</Text></Pressable>}
            {actionMessage?.userId === user?.id && <>
              <Pressable accessibilityRole="button" style={styles.sheetAction} onPress={() => { const message=actionMessage; setActionMessage(null); if(message) beginEdit(message); }}><Ionicons name="create-outline" size={18} color={colors.cyan}/><Text style={styles.sheetActionText}>Edit message</Text></Pressable>
              <Pressable accessibilityRole="button" style={[styles.sheetAction,styles.sheetDanger]} onPress={() => actionMessage && deleteMessage(actionMessage)}><Ionicons name="trash-outline" size={18} color={colors.red}/><Text style={[styles.sheetActionText,{color:colors.red}]}>Delete message</Text></Pressable>
            </>}
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
      <ChannelFinderSheet
        mode={finder}
        channelId={channelId}
        token={token}
        pinned={messages.filter((item) => item.pinned)}
        onPick={jumpTo}
        onClose={() => setFinder(null)}
      />
      <ReportSheet
        visible={reportTarget !== null}
        token={token}
        target={reportTarget}
        onClose={() => setReportTarget(null)}
        onSubmitted={() => setTimeout(() => setReportTarget(null), REPORT_CONFIRMATION_MS)}
      />
    </>
  );
}

