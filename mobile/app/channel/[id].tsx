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
import { BotBadge, BotMessage } from "@/src/components/channel/BotMessage";
import { botMessageNotice, botMessageText, botRenderMode, messageBotFields } from "../../../shared/bots/card-view";
import { noticeText } from "@/src/lib/server-text";
import { useTranslation } from "react-i18next";
import { sendsTypingIndicators, showsLargeEmoji, useAccountPreferencesSnapshot } from "@/src/lib/account-preferences-store";
import { saveClientSettingsPatch } from "@/src/lib/client-settings";
import { isEmojiOnly, LARGE_EMOJI_TEXT } from "@/src/lib/emoji-only";
import { parseSticker, stickerMessageText, type HubAsset } from "@/src/lib/hub-assets";
import { useHubAssets } from "@/src/hooks/useHubAssets";
import { isReactionChip, parsePoll, pollVoteToggles } from "@/src/lib/polls";
import { withRoomLevel } from "@/src/lib/hub-mutes";
import { PollCard } from "@/src/components/chat/PollCard";
import { PollComposerSheet } from "@/src/components/chat/PollComposerSheet";
import { ForumRoomView } from "@/src/components/forum/ForumRoomView";
import { parseChatEvent } from "@/src/lib/hub-events-model";
import { EventChatCard } from "@/src/components/events/EventChatCard";
import { BotCommandSuggestions, commandInsertText, useBotCommands } from "@/src/components/channel/BotCommandSuggestions";
import { StickerMessage } from "@/src/components/channel/StickerMessage";

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
 * A room. Rendered full-screen on iPhone, and as the right-hand pane of the
 * hub screen on iPad (embedded: no back button, the room list stays put).
 * Forum rooms get the forum view (posts, threads, New post); others the chat.
 */
export function ChannelView({ params, embedded = false }: { params: ChannelParams; embedded?: boolean }) {
  const { t } = useTranslation(["chat"]);
  if (params.forum === "1") {
    return (
      <ForumRoomView
        channelId={Number(params.id)}
        hubId={Number(params.hubId ?? 0)}
        name={typeof params.name === "string" ? params.name : t("chat.mobile.channel.roomFallback")}
        embedded={embedded}
      />
    );
  }
  return <ChatRoomView params={params} embedded={embedded} />;
}

function ChatRoomView({ params, embedded = false }: { params: ChannelParams; embedded?: boolean }) {
  const { t } = useTranslation(["chat", "common"]);

  const channelId = Number(params.id);
  const hubId = Number(params.hubId ?? 0);
  const name = typeof params.name === "string" ? params.name : t("chat.mobile.channel.roomFallback");
  const isVoiceRoom = params.voice === "1";

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
  const hubAssets = useHubAssets(hubId, token);
  const botCommands = useBotCommands(hubId, editingId ? "" : input, token);
  // Also re-renders when synced chat preferences (large emoji, time format) load or change.
  const prefs = useAccountPreferencesSnapshot();
  const roomMuted = prefs?.clientSettings?.notifyLevels?.rooms?.[String(channelId)] === "nothing";
  const toggleRoomMute = () => {
    if (!token) return;
    tapHaptic();
    void saveClientSettingsPatch(token, withRoomLevel(prefs?.clientSettings, channelId, roomMuted ? null : "nothing")).catch((error) =>
      Alert.alert(roomMuted ? t("chat.mobile.channel.unmuteRoom") : t("chat.mobile.channel.muteRoom"), error instanceof Error ? error.message : t("chat.mobile.channel.pleaseTryAgain")),
    );
  };
  const [pollOpen, setPollOpen] = useState(false);
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
      Alert.alert(t("chat.mobile.channel.couldNotDownloadAttachment"), error instanceof LegacyAttachmentError ? error.message : t("chat.mobile.channel.theAuthenticatedAttachmentDownloadFailed"));
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
      setLoadError(error instanceof Error ? error.message : t("chat.mobile.channel.couldNotLoadMessages"));
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
    // Settings → Privacy → Send typing indicators (synced with desktop).
    if (text.trim() && now - typingSentRef.current > 2500 && sendsTypingIndicators()) {
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
        throw new Error(t("chat.mobile.channel.realtimeIsReconnectingTryAgain"));
      }
      successHaptic();
      setInput("");
      setReplyingTo(null);
    } catch (error) {
      Alert.alert(t("chat.mobile.channel.couldNotSendAttachment"), error instanceof Error ? error.message : t("chat.mobile.channel.pleaseTryAgain"));
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
      Alert.alert(t("chat.mobile.channel.couldNotSendGif"), t("chat.mobile.channel.realtimeIsReconnectingTryAgain"));
    }
  };

  const sendPoll = (text: string): boolean => {
    if (send({ type: "CHAT_MESSAGE", text, channelId, replyToId: replyingTo?.id ?? null, attachment: null })) {
      impactHaptic();
      setReplyingTo(null);
      return true;
    }
    Alert.alert(t("chat.mobile.channel.couldNotSendPoll"), t("chat.mobile.channel.realtimeIsReconnectingTryAgain"));
    return false;
  };

  const voteInPoll = async (message: ChatMessage, optionIndex: number) => {
    if (!user) return;
    for (const key of pollVoteToggles(message.reactions, user.id, optionIndex)) await reactToMessage(message, key);
  };

  const openPollComposer = () => {
    setMediaOpen(false);
    // iOS can't present a second modal while the first is still sliding away.
    setTimeout(() => setPollOpen(true), 350);
  };

  const chooseHubAsset = (asset: HubAsset) => {
    setMediaOpen(false);
    if (asset.kind === "emote") {
      setInput(`${input}${input && !/\s$/.test(input) ? " " : ""}:${asset.name}: `);
      return;
    }
    if (send({ type: "CHAT_MESSAGE", text: stickerMessageText(asset), channelId, replyToId: replyingTo?.id ?? null, attachment: null })) {
      impactHaptic();
      setReplyingTo(null);
    } else {
      Alert.alert(t("chat.mobile.channel.couldNotSendSticker"), t("chat.mobile.channel.realtimeIsReconnectingTryAgain"));
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
      Alert.alert(message.pinned ? t("chat.mobile.channel.couldNotUnpinMessage") : t("chat.mobile.channel.couldNotPinMessage"), error instanceof Error ? error.message : t("chat.mobile.channel.pleaseTryAgain"));
    }
  };

  const jumpTo = (message: ChatMessage) => {
    setFinder(null);
    const index = messages.findIndex((item) => item.id === message.id);
    if (index < 0) {
      Alert.alert(t("chat.mobile.channel.olderMessage"), t("chat.mobile.channel.thisMessageIsFurtherBack"));
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
      Alert.alert(t("chat.mobile.channel.couldNotAddReaction"), error instanceof Error ? error.message : t("chat.mobile.channel.pleaseTryAgain"));
    }
  };

  const beginEdit = (message: ChatMessage) => {
    if (message.userId !== user?.id || parseForumPost(message.text) || parsePoll(message.text) || parseSticker(message.text) || parseChatEvent(message.text)) return;
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
    Alert.alert(t("chat.mobile.channel.deleteMessage"), t("chat.mobile.channel.thisRemovesTheMessageFor"), [
        { text: t("common.actions.cancel"), style: "cancel" },
        { text: t("common.actions.delete"), style: "destructive", onPress: () => void (async () => {
          try {
            if (!token) return;
            await apiJson(`/api/channels/${channelId}/messages/${encodeURIComponent(message.id)}`, { method: "DELETE" }, token);
          setMessages((current) => current.filter((item) => item.id !== message.id));
          setActionMessage(null);
        } catch (error) {
          Alert.alert(t("chat.mobile.channel.couldNotDeleteMessage"), error instanceof Error ? error.message : t("chat.mobile.channel.pleaseTryAgain"));
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
        t("chat.mobile.channel.couldNotEditMessage"),
        error instanceof Error ? error.message : t("chat.mobile.channel.theMessageWasNotChanged"),
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
            <Pressable accessibilityRole="button" accessibilityLabel={t("common.actions.back")}
              style={styles.backButton}
              onPress={() => router.back()}
              hitSlop={8}
            >
              <Ionicons name="chevron-back" size={23} color={colors.cyan} />
            </Pressable>
          )}

          <View style={styles.channelIcon}>
            <Ionicons
              name="chatbubble-ellipses"
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
                {connectionState === "connected" ? t("chat.mobile.channel.live") : t("chat.mobile.channel.connecting")}
              </Text>
            </View>
          </View>

          <Pressable
            style={styles.hashBadge}
            onPress={() => setFinder("search")}
            accessibilityRole="button"
            accessibilityLabel={t("chat.mobile.channel.searchMessages")}
            hitSlop={6}
          >
            <Ionicons name="search" size={16} color={colors.cyan} />
          </Pressable>
          <Pressable
            style={styles.hashBadge}
            onPress={() => setFinder("pins")}
            accessibilityRole="button"
            accessibilityLabel={t("chat.mobile.channel.pinnedMessages")}
            hitSlop={6}
          >
            <Ionicons name="pin-outline" size={16} color={colors.cyan} />
          </Pressable>

          {isVoiceRoom ? (
            <Pressable accessibilityRole="button"
              style={styles.hashBadge}
              onPress={() => router.replace(`/voice/${channelId}?hubId=${hubId}&name=${encodeURIComponent(name)}${params.squad === "1" ? "&squad=1" : ""}`)}
              accessibilityLabel={t("chat.mobile.channel.returnToVoiceControls")}
            >
              <Ionicons name="volume-high" size={16} color={colors.cyan} />
            </Pressable>
          ) : (
            <Pressable
              style={styles.hashBadge}
              onPress={toggleRoomMute}
              accessibilityRole="button"
              accessibilityState={{ selected: roomMuted }}
              accessibilityLabel={roomMuted ? t("chat.mobile.channel.unmuteRoom") : t("chat.mobile.channel.muteRoom")}
              hitSlop={6}
            >
              <Ionicons name={roomMuted ? "notifications-off" : "notifications-outline"} size={16} color={roomMuted ? colors.red : colors.cyan} />
            </Pressable>
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
              <Text style={styles.emptyTitle}>{isVoiceRoom ? t("chat.mobile.channel.welcomeVoice", { name }) : t("chat.mobile.channel.welcomeText", { name })}</Text>
              <Text style={styles.emptyText}>
                {isVoiceRoom
                  ? t("chat.mobile.channel.voiceAndMessagesLiveTogether")
                  : t("chat.mobile.channel.thisIsTheBeginningOf")}
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

            // A builder bot is the author of its messages, not the admin who published it.
            const author = messageBotFields(item).bot;
            const grouped =
              !!previous &&
              previous.userId === item.userId &&
              messageBotFields(previous).bot?.id === author?.id &&
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
                  accessibilityHint={t("chat.mobile.channel.longPressForMessageActions")}
                >
                  {!grouped && author ? (
                    <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: colors.wash }}>
                      <Text style={{ fontSize: 18 }}>{author.avatarEmoji || "🤖"}</Text>
                    </View>
                  ) : !grouped ? (
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
                          {author ? author.name : item.username}
                        </Text>
                        {author ? <BotBadge color={author.color} /> : null}

                        <Text style={styles.time}>
                          {formatMessageTime(item.timestamp)}
                        </Text>

                        {!author && item.role &&
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
                          ↳ {messageBotFields(replyTarget).bot?.name ?? replyTarget.username}: {previewMessage(messagePreviewText(replyTarget.text, replyTarget))}
                        </Text>
                      </View>
                    )}

                    {item.pinned && (
                      <View style={styles.pinnedTag}>
                        <Ionicons name="pin" size={11} color={colors.yellow} />
                        <Text maxFontSizeMultiplier={1.3} style={styles.pinnedTagText}>{t("chat.mobile.channel.pinned")}</Text>
                      </View>
                    )}

                                        {botRenderMode(item) === "card" ? (() => {
                      const builder = messageBotFields(item);
                      return builder.bot ? (
                        <BotMessage
                          messageId={item.id}
                          roomId={item.channelId ?? channelId}
                          bot={builder.bot}
                          card={builder.card}
                          privateNotice={builder.privateNotice}
                          text={noticeText(botMessageNotice(item.text)) ?? botMessageText(item.text)}
                          token={token}
                          showHead={false}
                        />
                      ) : null;
                    })() : parseChatEvent(item.text) ? (
                      <EventChatCard payload={parseChatEvent(item.text)!} hubId={hubId} token={token} />
                    ) : parsePoll(item.text) ? (
                      <PollCard poll={parsePoll(item.text)!} reactions={item.reactions} userId={user?.id} onVote={(index) => void voteInPoll(item, index)} />
                    ) : parseSticker(item.text) ? (
                      <StickerMessage sticker={parseSticker(item.text)!} />
                    ) : parseGif(item.text) ? (
                      <MessageImage url={parseGif(item.text)!.url} title={parseGif(item.text)!.title} token={token} authenticated />
                    ) : !item.text ? null : (() => {
                      const post = parseForumPost(item.text, item);
                      if (!post) {
                        return (
                          <>
                            <Text style={[styles.messageText, showsLargeEmoji() && isEmojiOnly(item.text) && LARGE_EMOJI_TEXT]}>
                              {renderMessageText(item.text, user?.username, hubAssets)}
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
                              {renderMessageText(post.body, user?.username, hubAssets)}
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
                      Object.keys(item.reactions).some(isReactionChip) && (
                        <View style={styles.reactions}>
                          {Object.entries(item.reactions).filter(([key]) => isReactionChip(key)).map(
                            ([emoji, userIds]) => (
                              <Pressable
                                key={emoji}
                                accessibilityRole="button"
                                accessibilityLabel={user && userIds.includes(user.id) ? t("chat.mobile.channel.reactedByYou", { emoji, count: userIds.length }) : `${emoji} ${userIds.length}`}
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
                      <Text style={styles.edited}>{t("chat.actions.message.edited")}</Text>
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
            accessibilityLabel={newSinceScroll > 0 ? t("chat.mobile.channel.newsincescrollNewMessagesJumpTo", { newSinceScroll }) : t("chat.mobile.channel.jumpToLatestMessages")}
            onPress={() => { nearBottomRef.current = true; setNearBottom(true); listRef.current?.scrollToEnd({ animated: true }); }}
            style={styles.jumpLatest}
          >
            <Ionicons name="arrow-down" size={15} color="#FFFFFF" />
            <Text style={styles.jumpLatestText}>{newSinceScroll > 0 ? t("chat.mobile.channel.newCount", { number: newSinceScroll > 99 ? "99+" : newSinceScroll }) : t("chat.mobile.channel.latest")}</Text>
          </Pressable>
        )}
        {typingNames.length > 0 && (
          <View style={styles.typingRow}>
            <Text style={styles.typingText} numberOfLines={1}>
              {typingNames.length === 1
                ? t("chat.mobile.channel.isTyping", { name: typingNames[0] })
                : typingNames.length === 2
                  ? t("chat.mobile.channel.twoTyping", { first: typingNames[0], second: typingNames[1] })
                  : t("chat.mobile.channel.severalPeopleAreTyping")}
            </Text>
          </View>
        )}
        {editingId && (
          <View style={styles.editingBanner}>
            <Ionicons name="create-outline" size={14} color={colors.cyan} />
            <Text style={styles.editingBannerText}>{t("chat.mobile.channel.editingMessage")}</Text>
            <Pressable accessibilityRole="button" onPress={cancelEdit}><Text style={styles.editingCancel}>{t("common.actions.cancel")}</Text></Pressable>
          </View>
        )}
        {replyingTo && (
          <View style={styles.replyingBanner}>
            <Ionicons name="arrow-undo-outline" size={14} color={colors.cyan} />
            <Text style={styles.replyingBannerText} numberOfLines={1}>
              {t("chat.mobile.channel.replyingToNameValue", { name: messageBotFields(replyingTo).bot?.name ?? replyingTo.username, value: previewMessage(messagePreviewText(replyingTo.text, replyingTo)) })}
            </Text>
            <Pressable accessibilityRole="button" onPress={() => setReplyingTo(null)}>
              <Text style={styles.editingCancel}>{t("common.actions.cancel")}</Text>
            </Pressable>
          </View>
        )}
        <View style={styles.composerShell}>
          <BotCommandSuggestions suggestions={botCommands} onChoose={(command) => setInput(commandInsertText(command))} />
          {sendFailed && <SendFailedBanner onRetry={() => void sendMessage()} onDismiss={() => setSendFailed(false)} />}
          <View style={styles.composer}>
            <Pressable
              style={styles.plusButton}
              onPress={() => setMediaOpen(true)}
              disabled={uploading}
              accessibilityRole="button"
              accessibilityLabel={t("chat.mobile.channel.addPhotoVideoOrGif")}
            >
              {uploading ? <ActivityIndicator size="small" color={colors.cyan} /> : <Ionicons name="add" size={21} color={colors.cyan} />}
            </Pressable>

            <TextInput
              testID="room-composer"
              value={input}
              onChangeText={onChangeInput}
              placeholder={t("chat.mobile.channel.messageName", { name })}
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
              accessibilityLabel={t("chat.composer.send")}
            >
              <Ionicons name="arrow-up" size={20} color="#fff" />
            </Pressable>
          </View>

        </View>
      </KeyboardAware>
      <Modal visible={actionMessage !== null} transparent animationType="fade" onRequestClose={() => setActionMessage(null)}>
        <Pressable style={styles.actionBackdrop} onPress={() => setActionMessage(null)}>
          <Pressable style={styles.actionSheet} onPress={() => {}}>
            <View style={styles.actionGrabber} />
            {actionMessage && <MessagePreview author={messageBotFields(actionMessage).bot?.name ?? actionMessage.username} text={actionMessage.text} mine={actionMessage.userId === user?.id && !messageBotFields(actionMessage).bot} />}
            <View style={styles.emojiGrid}>
              {CHANNEL_REACTION_EMOJIS.map((emoji) => <Pressable accessibilityRole="button" key={emoji} style={styles.emojiButton} onPress={() => { const message=actionMessage; setActionMessage(null); if(message) void reactToMessage(message,emoji); }}><Text style={styles.emojiButtonText}>{emoji}</Text></Pressable>)}
            </View>
            {actionMessage && <Pressable accessibilityRole="button" style={styles.sheetAction} onPress={() => void togglePin(actionMessage)}><Ionicons name={actionMessage.pinned ? "pin" : "pin-outline"} size={18} color={colors.cyan}/><Text style={styles.sheetActionText}>{actionMessage.pinned ? t("chat.messages.unpinMessage") : t("chat.messages.pinMessage")}</Text></Pressable>}
            {actionMessage && <Pressable accessibilityRole="button" style={styles.sheetAction} onPress={() => beginReply(actionMessage)}><Ionicons name="arrow-undo-outline" size={18} color={colors.cyan}/><Text style={styles.sheetActionText}>{t("chat.messages.reply")}</Text></Pressable>}
            {actionMessage && actionMessage.userId !== user?.id && <Pressable accessibilityRole="button" style={styles.sheetAction} onPress={() => { const message = actionMessage; setActionMessage(null); toggleMute(message.userId).then(() => successHaptic()).catch((error) => { errorHaptic(); Alert.alert(t("chat.mobile.channel.couldNotUpdateMute"), error instanceof Error ? error.message : t("chat.mobile.channel.pleaseTryAgain")); }); }}><Ionicons name={mutedIds.has(actionMessage.userId) ? "notifications-outline" : "notifications-off-outline"} size={18} color={colors.cyan}/><Text style={styles.sheetActionText}>{mutedIds.has(actionMessage.userId) ? t("chat.mobile.channel.unmuteUsername", { username: actionMessage.username }) : t("chat.mobile.channel.muteNotificationsFromUsername", { username: actionMessage.username })}</Text></Pressable>}
            {actionMessage && actionMessage.userId !== user?.id && <Pressable accessibilityRole="button" style={styles.sheetAction} onPress={() => { const message = actionMessage; setActionMessage(null); setReportTarget({ targetType: message.attachment ? "attachment" : "message", targetId: message.id, subjectUserId: message.userId, subjectUsername: messageBotFields(message).bot?.name ?? message.username, contextType: "channel", contextId: String(channelId), contextLabel: `#${name}` }); }}><Ionicons name="flag-outline" size={18} color={colors.cyan}/><Text style={styles.sheetActionText}>{t("chat.messages.reportMessage")}</Text></Pressable>}
            {/* A bot's message is not the publisher's own to edit or delete. */}
            {actionMessage?.userId === user?.id && !messageBotFields(actionMessage).bot && <>
              <Pressable accessibilityRole="button" style={styles.sheetAction} onPress={() => { const message=actionMessage; setActionMessage(null); if(message) beginEdit(message); }}><Ionicons name="create-outline" size={18} color={colors.cyan}/><Text style={styles.sheetActionText}>{t("chat.messages.editMessage")}</Text></Pressable>
              <Pressable accessibilityRole="button" style={[styles.sheetAction,styles.sheetDanger]} onPress={() => actionMessage && deleteMessage(actionMessage)}><Ionicons name="trash-outline" size={18} color={colors.red}/><Text style={[styles.sheetActionText,{color:colors.red}]}>{t("chat.messages.deleteMessage")}</Text></Pressable>
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
        hubAssets={hubAssets}
        onHubAsset={chooseHubAsset}
        onPoll={openPollComposer}
      />
      <PollComposerSheet visible={pollOpen} onClose={() => setPollOpen(false)} onPost={sendPoll} />
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

