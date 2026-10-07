import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Avatar } from "@/src/components/Avatar";
import { ComposerMediaSheet } from "@/src/components/ComposerMediaSheet";
import { MessageImage } from "@/src/components/MessageMedia";
import { SwipeToReply } from "@/src/components/SwipeToReply";
import { gifMessageText, parseGif, type GiphyGif } from "@/src/lib/chat-media";
import { errorHaptic, impactHaptic, tapHaptic } from "@/src/lib/haptics";
import ReportSheet, { REPORT_CONFIRMATION_MS, type MobileReportTarget } from "@/src/components/ReportSheet";
import { Screen } from "@/src/components/Screen";
import { apiJson } from "@/src/lib/api";
import { useSession } from "@/src/providers/SessionProvider";
import { useRealtime } from "@/src/providers/RealtimeProvider";
import { SkeletonRows } from "@/src/components/Skeleton";
import { MessagePreview } from "@/src/components/MessagePreview";
import { useHardwareKeyboard, useIsWide } from "@/src/lib/layout";
import { KeyboardAware } from "@/src/components/KeyboardAware";
import { SendFailedBanner } from "@/src/components/SendFailedBanner";
import { LinkifiedText } from "@/src/components/LinkifiedText";
import { colors } from "@/src/theme";
import type { AccountUser, GroupChat, GroupChatMessage, SocialState } from "@/src/types";
import { VoiceFloatingBar } from "@/src/components/VoiceFloatingBar";
import { useDraftInput } from "@/src/lib/drafts";
import { dmE2ee, groupSocketFrame, rememberGroup, useDmE2ee } from "@/src/lib/e2ee/client";
import { GroupEncryptionBadge } from "@/src/providers/DmE2eeProvider";

function previewMessage(text: string): string {
  const preview = text.replace(/\s+/g, " ").trim();
  if (!preview) return "Message";
  return preview.length > 88 ? `${preview.slice(0, 85)}…` : preview;
}

const RUN_GAP_MS = 5 * 60 * 1000;

function inSameRun(a: GroupChatMessage | undefined, b: GroupChatMessage | undefined): boolean {
  if (!a || !b || a.fromUserId !== b.fromUserId) return false;
  const gap = Math.abs(new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return gap < RUN_GAP_MS && new Date(a.timestamp).toDateString() === new Date(b.timestamp).toDateString();
}

export default function GroupChatScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const groupId = params.id;
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
  const [group, setGroup] = useState<GroupChat | null>(null);
  const [messages, setMessages] = useState<GroupChatMessage[]>([]);
  const [friends, setFriends] = useState<AccountUser[]>([]);
  const [input, setInput] = useDraftInput(`group:${groupId}`);
  const [replyingTo, setReplyingTo] = useState<GroupChatMessage | null>(null);
  const [actionMessage, setActionMessage] = useState<GroupChatMessage | null>(null);
  const [reportTarget, setReportTarget] = useState<MobileReportTarget | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const listRef = useRef<FlatList<GroupChatMessage>>(null);
  const [gifOpen, setGifOpen] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);
  const [hasOlder, setHasOlder] = useState(true);
  const [nearBottom, setNearBottom] = useState(true);
  const nearBottomRef = useRef(true);
  const seenLastIdRef = useRef<string | null>(null);
  const loadGenerationRef = useRef(0);


  const load = async () => {
    if (!token || !groupId) return;
    const generation = ++loadGenerationRef.current;
    try {
      const [groupData, socialData] = await Promise.all([
        apiJson<{ group: GroupChat; messages: GroupChatMessage[] }>(
          `/api/groups/${encodeURIComponent(groupId)}`,
          {},
          token,
        ),
        apiJson<SocialState>("/api/social", {}, token),
      ]);
      if (generation !== loadGenerationRef.current) return;
      // Encrypted messages are decrypted on the phone before they're shown.
      const latest = await dmE2ee.openGroupAll(groupData.messages ?? [], groupId);
      if (generation !== loadGenerationRef.current) return;
      setGroup(groupData.group);
      rememberGroup(groupData.group);
      if (latest.length < 100) setHasOlder(false);
      setMessages((current) => {
        const latestIds = new Set(latest.map((item) => item.id));
        const firstLatest = latest[0]?.timestamp ?? "";
        const older = current.filter((item) => !latestIds.has(item.id) && item.timestamp < firstLatest);
        return [...older, ...latest];
      });
      setFriends(socialData.friends ?? []);
      setNotice("");
    } catch (error) {
      if (generation !== loadGenerationRef.current) return;
      const message = error instanceof Error ? error.message : "Could not open group chat.";
      setNotice(message);
      if (/not a member|not found/i.test(message)) router.back();
    } finally {
      if (generation === loadGenerationRef.current) setLoaded(true);
    }
  };

  useEffect(() => {
    setGroup(null);
    setMessages([]);
    setActionMessage(null);
    setReplyingTo(null);
    void load();
  }, [groupId, token]);

  useEffect(() => {
    const type = lastEvent?.type;
    const eventGroupId = typeof lastEvent?.groupId === "string" ? lastEvent.groupId : "";
    if (
      eventGroupId === groupId &&
      (type === "GROUP_MESSAGE" || type === "GROUP_CHAT_UPDATED" || type === "GROUP_CHAT_REMOVED")
    ) {
      if (type === "GROUP_CHAT_REMOVED" && lastEvent?.userId === user?.id) {
        router.back();
        return;
      }
      void load();
    }
  }, [lastEvent, groupId, user?.id]);

  const loadOlder = async () => {
    if (!token || !groupId || loadingOlder || !hasOlder || messages.length === 0) return;
    setLoadingOlder(true);
    try {
      const data = await apiJson<{ messages: GroupChatMessage[] }>(
        `/api/groups/${encodeURIComponent(groupId)}?before=${encodeURIComponent(messages[0].id)}`,
        {},
        token,
      );
      const older = await dmE2ee.openGroupAll(data.messages ?? [], groupId);
      if (older.length === 0) setHasOlder(false);
      setMessages((current) => {
        const ids = new Set(current.map((item) => item.id));
        return [...older.filter((item) => !ids.has(item.id)), ...current];
      });
    } catch (error) {
      console.warn("[group] could not load older messages", error);
    } finally {
      setLoadingOlder(false);
    }
  };

  // Re-read once this phone is unlocked (or its key changed).
  const e2eeState = useDmE2ee();
  useEffect(() => {
    if (e2eeState.status === "ready") void load();
  }, [e2eeState.status, e2eeState.keyId]);

  /** The GROUP_MESSAGE frame: encrypted for every member when the group is encrypted. */
  const groupFrame = async (text: string) => {
    if (!group) throw new Error("The group is still loading.");
    return groupSocketFrame(group, text, replyingTo?.id ?? null);
  };

  const sendGif = async (gif: GiphyGif) => {
    const text = gifMessageText(gif);
    setGifOpen(false);
    if (!text || !groupId) return;
    let frame: Record<string, unknown>;
    try {
      frame = await groupFrame(text);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not encrypt this message.");
      return;
    }
    if (send(frame)) {
      impactHaptic();
      setReplyingTo(null);
    } else {
      setNotice("Realtime is reconnecting. Try again in a moment.");
    }
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || !groupId) return;
    let frame: Record<string, unknown>;
    try {
      frame = await groupFrame(text);
    } catch (error) {
      errorHaptic();
      setNotice(error instanceof Error ? error.message : "Could not encrypt this message.");
      return;
    }
    if (send(frame)) {
      impactHaptic();
      setInput("");
      setReplyingTo(null);
      setSendFailed(false);
    } else {
      errorHaptic();
      setSendFailed(true);
    }
  };

  const memberIds = useMemo(
    () => new Set(group?.members.map((member) => member.id) ?? []),
    [group?.members],
  );
  const addableFriends = friends.filter((friend) => !memberIds.has(friend.id));
  const isOwner = group?.ownerUserId === user?.id;

  const beginReply = (message: GroupChatMessage) => {
    setActionMessage(null);
    setReplyingTo(message);
  };

  const addMember = async (friend: AccountUser) => {
    if (!token || !groupId) return;
    try {
      await apiJson(
        `/api/groups/${encodeURIComponent(groupId)}/members`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: friend.id }),
        },
        token,
      );
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not add member.");
    }
  };

  const removeMember = async (member: AccountUser) => {
    if (!token || !groupId) return;
    try {
      await apiJson(
        `/api/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(member.id)}`,
        { method: "DELETE" },
        token,
      );
      if (member.id === user?.id) {
        setMembersOpen(false);
        router.back();
        return;
      }
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not remove member.");
    }
  };

  const requestDeleteMessage = (message: GroupChatMessage) => {
    setActionMessage(null);
    const canDelete = message.fromUserId === user?.id;
    if (!token || !groupId || !canDelete) return;
    Alert.alert(
      "Delete message?",
      message.fromUserId === user?.id
        ? "This removes your message for everyone in the group."
        : "As group owner, you can remove this message for everyone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => void (async () => {
            try {
              if (!token) return;
              await apiJson(
                `/api/groups/${encodeURIComponent(groupId)}/messages/${encodeURIComponent(message.id)}`,
                { method: "DELETE" },
                token,
              );
              setMessages((current) => current.filter((item) => item.id !== message.id));
            } catch (error) {
              setNotice(error instanceof Error ? error.message : "Could not delete message.");
            }
          })(),
        },
      ],
    );
  };

  const seenIndex = seenLastIdRef.current ? messages.findIndex((item) => item.id === seenLastIdRef.current) : -1;
  const newSinceScroll = !nearBottom && seenIndex >= 0 ? messages.length - 1 - seenIndex : 0;

  return (
    <Screen>
      <KeyboardAware style={{ flex: 1 }}>
        <View style={styles.top}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back" hitSlop={8} onPress={() => router.back()}>
            <Text style={styles.back} maxFontSizeMultiplier={1.2}>‹</Text>
          </Pressable>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.title} numberOfLines={1} maxFontSizeMultiplier={1.4}>{group?.name || "Group chat"}</Text>
            <Text style={styles.status} numberOfLines={1} maxFontSizeMultiplier={1.3}>
              {group ? `${group.memberCount} members` : connectionState === "connected" ? "Loading…" : "Connecting…"}
            </Text>
          </View>
          {group ? <GroupEncryptionBadge group={group} /> : null}
          {<Pressable accessibilityRole="button" style={styles.membersButton} onPress={() => setMembersOpen(true)}>
            <Text style={styles.membersButtonText}>Members</Text>
          </Pressable>}
        </View>

        <VoiceFloatingBar style={{ marginTop: 6, marginBottom: 4 }} />
        <FlatList
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
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
            <View style={styles.beginning}>
              <Text style={styles.beginningTitle}>Start the group</Text>
              <Text style={styles.beginningText}>
                {group?.e2ee
                  ? "Messages here are end-to-end encrypted: only people in the group when a message is sent can read it."
                  : "Messages here are shared with everyone in this group chat."}
              </Text>
            </View>
          }
          renderItem={({ item, index }) => {
            const own = item.fromUserId === user?.id;
            // A run of messages from one person: name on the first, time on the last.
            const startsRun = !inSameRun(messages[index - 1], item);
            const endsRun = !inSameRun(item, messages[index + 1]);
            const replyTarget = item.replyToId
              ? messages.find((candidate) => candidate.id === item.replyToId)
              : undefined;
            return (
              <SwipeToReply onReply={() => { impactHaptic(); beginReply(item); }}>
              <Pressable
                style={[styles.message, own && styles.messageOwn, !endsRun && styles.messageInRun]}
                delayLongPress={350}
                onLongPress={() => { tapHaptic(); setActionMessage(item); }}
                accessibilityHint="Long press for message actions"
              >
                {!own && startsRun && <Text style={styles.author}>{item.username}</Text>}
                {replyTarget && (
                  <View style={styles.replyReference}>
                    <Text style={styles.replyReferenceText} numberOfLines={1}>
                      ↳ {replyTarget.username}: {previewMessage(replyTarget.text)}
                    </Text>
                  </View>
                )}
                {item.e2ee === "locked" || item.e2ee === "failed" ? (
                  <Text style={styles.e2eePlaceholder}>
                    {item.e2ee === "failed"
                      ? "This message couldn't be decrypted."
                      : e2eeState.status === "locked"
                        ? "Encrypted message. Unlock encrypted messages on this phone to read it."
                        : "Encrypted message you can't read: sent before you joined, or older than your account keeps."}
                  </Text>
                ) : parseGif(item.text) ? (
                  <MessageImage url={parseGif(item.text)!.url} title={parseGif(item.text)!.title} token={token} authenticated={false} />
                ) : (
                  <LinkifiedText style={styles.messageText} text={item.text} />
                )}
                {endsRun && <Text style={styles.time}>{formatTime(item.timestamp)}</Text>}
              </Pressable>
              </SwipeToReply>
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
            <Text style={{ color: "#FFFFFF", fontSize: 12, fontWeight: "900" }}>{newSinceScroll > 0 ? `↓ ${newSinceScroll > 99 ? "99+" : newSinceScroll} new` : "↓ Latest"}</Text>
          </Pressable>
        )}
        {!!notice && <Text style={styles.notice}>{notice}</Text>}

        {replyingTo && (
          <View style={styles.replyingBanner}>
            <Text style={styles.replyingIcon}>↩</Text>
            <Text style={styles.replyingBannerText} numberOfLines={1}>
              Replying to {replyingTo.username}: {previewMessage(replyingTo.text)}
            </Text>
            <Pressable accessibilityRole="button" onPress={() => setReplyingTo(null)}>
              <Text style={styles.replyingCancel}>Cancel</Text>
            </Pressable>
          </View>
        )}

        {sendFailed && <SendFailedBanner onRetry={() => void sendMessage()} onDismiss={() => setSendFailed(false)} />}
        {<View style={styles.composer}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send a GIF"
            onPress={() => setGifOpen(true)}
            style={{ height: 44, paddingHorizontal: 10, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.panel2 }}
          >
            <Text style={{ color: colors.lilac, fontSize: 12, fontWeight: "900" }}>GIF</Text>
          </Pressable>
          <TextInput
            testID="group-composer"
            value={input}
            onChangeText={setInput}
            placeholder={`Message ${group?.name || "group"}`}
            placeholderTextColor={colors.faint}
            style={styles.input}
            multiline
                        submitBehavior={returnSends ? "submit" : "newline"}
            onSubmitEditing={returnSends ? () => void sendMessage() : undefined}
            maxLength={4000}
          />
          <Pressable
            style={[styles.send, false]}
            onPress={sendMessage}
            accessibilityRole="button"
            accessibilityLabel="Send message"
          >
            <Text style={styles.sendText}>↑</Text>
          </Pressable>
        </View>}
      </KeyboardAware>

      <ComposerMediaSheet
        visible={gifOpen}
        token={token}
        onClose={() => setGifOpen(false)}
        onGif={sendGif}
      />
      <Modal visible={membersOpen} transparent animationType="fade" onRequestClose={() => setMembersOpen(false)}>
        <Pressable style={styles.overlay} onPress={() => setMembersOpen(false)}>
          <Pressable style={styles.modal} onPress={() => {}}>
            <View style={styles.modalHead}>
              <View style={{ flex: 1 }}>
                <Text maxFontSizeMultiplier={1.3} style={styles.modalKicker}>GROUP CHAT</Text>
                <Text style={styles.modalTitle}>Members</Text>
              </View>
              <Pressable accessibilityRole="button" onPress={() => setMembersOpen(false)}>
                <Text style={styles.close}>×</Text>
              </Pressable>
            </View>

            <ScrollView keyboardDismissMode="on-drag" style={styles.memberList}>
              {group?.members.map((member) => {
                const owner = member.id === group.ownerUserId;
                const self = member.id === user?.id;
                return (
                  <View key={member.id} style={styles.memberRow}>
                    <Avatar username={member.username} avatarUrl={member.avatarUrl} online={member.online} size={39} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.memberName}>{member.username}{self ? " · You" : ""}</Text>
                      <Text style={styles.memberRole}>{owner ? "Group owner" : "Member"}</Text>
                    </View>
                    {self && !owner ? (
                      <Pressable accessibilityRole="button" style={styles.removeButton} onPress={() => void removeMember(member)}>
                        <Text style={styles.removeButtonText}>Leave</Text>
                      </Pressable>
                    ) : isOwner && !self ? (
                      <Pressable accessibilityRole="button" style={styles.removeButton} onPress={() => void removeMember(member)}>
                        <Text style={styles.removeButtonText}>Remove</Text>
                      </Pressable>
                    ) : null}
                  </View>
                );
              })}

              <Text style={styles.addSection}>ADD A FRIEND</Text>
              {addableFriends.length === 0 ? (
                <Text style={styles.noMore}>All of your friends are already in this group.</Text>
              ) : (
                addableFriends.map((friend) => (
                  <View key={friend.id} style={styles.memberRow}>
                    <Avatar username={friend.username} avatarUrl={friend.avatarUrl} online={friend.online} size={39} />
                    <Text style={[styles.memberName, { flex: 1 }]}>{friend.username}</Text>
                    <Pressable accessibilityRole="button" style={styles.addButton} onPress={() => void addMember(friend)}>
                      <Text style={styles.addButtonText}>Add</Text>
                    </Pressable>
                  </View>
                ))
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={actionMessage !== null} transparent animationType="fade" onRequestClose={() => setActionMessage(null)}>
        <Pressable style={styles.actionOverlay} onPress={() => setActionMessage(null)}>
          <Pressable style={styles.actionSheet} onPress={() => {}}>
            <View style={styles.actionGrabber} />
            {actionMessage && <MessagePreview author={actionMessage.username} text={actionMessage.text} mine={actionMessage.fromUserId === user?.id} />}
            {actionMessage && (
              <Pressable accessibilityRole="button" style={styles.sheetAction} onPress={() => beginReply(actionMessage)}>
                <Text style={styles.sheetActionIcon}>↩</Text>
                <Text style={styles.sheetActionText}>Reply</Text>
              </Pressable>
            )}
            {actionMessage && actionMessage.fromUserId !== user?.id && (
              <Pressable accessibilityRole="button" style={styles.sheetAction} onPress={() => { const message = actionMessage; setActionMessage(null); setReportTarget({ targetType: "message", targetId: message.id, subjectUserId: message.fromUserId, subjectUsername: message.username, contextType: "group", contextId: groupId, contextLabel: group?.name || "Group chat", evidenceType: "message", evidenceText: message.e2ee === "locked" || message.e2ee === "failed" ? undefined : message.text, e2eeProof: dmE2ee.reportProof(message, "group") ?? undefined }); }}>
                <Text style={styles.sheetActionIcon}>⚑</Text>
                <Text style={styles.sheetActionText}>Report message</Text>
              </Pressable>
            )}
            {actionMessage && (actionMessage.fromUserId === user?.id || isOwner) && (
              <Pressable accessibilityRole="button" style={[styles.sheetAction, styles.sheetDanger]} onPress={() => requestDeleteMessage(actionMessage)}>
                <Text style={[styles.sheetActionIcon, { color: colors.red }]}>⌫</Text>
                <Text style={[styles.sheetActionText, { color: colors.red }]}>Delete message</Text>
              </Pressable>
            )}
          </Pressable>
        </Pressable>
      </Modal>
      <ReportSheet
        visible={reportTarget !== null}
        token={token}
        target={reportTarget}
        onClose={() => setReportTarget(null)}
        onSubmitted={() => setTimeout(() => setReportTarget(null), REPORT_CONFIRMATION_MS)}
      />
    </Screen>
  );
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  back: { color: colors.cyan, fontSize: 38, lineHeight: 40 },
  title: { color: colors.text, fontWeight: "900", fontSize: 18 },
  status: { color: colors.cyan, fontSize: 12, marginTop: 2 },
  membersButton: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  membersButtonText: { color: colors.text, fontSize: 12, fontWeight: "800" },
  list: { padding: 13, paddingBottom: 18, flexGrow: 1 },
  beginning: { alignItems: "center", justifyContent: "center", paddingVertical: 50, paddingHorizontal: 25 },
  beginningTitle: { color: colors.text, fontSize: 18, fontWeight: "900" },
  beginningText: { color: colors.muted, textAlign: "center", fontSize: 13, lineHeight: 17, marginTop: 6 },
  message: { alignSelf: "flex-start", maxWidth: "85%", backgroundColor: colors.panel, borderRadius: 15, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 9, marginBottom: 8 },
  messageInRun: { marginBottom: 2 },
  messageOwn: { alignSelf: "flex-end", backgroundColor: "rgba(124,92,255,.18)", borderColor: "rgba(124,92,255,.36)" },
  author: { color: colors.cyan, fontSize: 12, fontWeight: "900", marginBottom: 3 },
  messageText: { color: colors.text, lineHeight: 20 },
  e2eePlaceholder: { color: colors.muted, fontSize: 14, fontStyle: "italic", lineHeight: 20 },
  time: { color: colors.faint, fontSize: 11, marginTop: 4, alignSelf: "flex-end" },
  replyReference: { maxWidth: "100%", borderLeftWidth: 2, borderLeftColor: colors.cyan, paddingLeft: 7, marginBottom: 7 },
  replyReferenceText: { color: colors.muted, fontSize: 12, lineHeight: 14 },
  notice: { color: colors.yellow, fontSize: 12, paddingHorizontal: 12, paddingBottom: 6 },
  replyingBanner: { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: colors.cyanSoft, borderTopWidth: 1, borderTopColor: colors.border },
  replyingIcon: { color: colors.cyan, fontSize: 16, fontWeight: "900" },
  replyingBannerText: { flex: 1, color: colors.text, fontSize: 12, fontWeight: "800" },
  replyingCancel: { color: colors.cyan, fontSize: 12, fontWeight: "900" },
  composer: { flexDirection: "row", gap: 8, alignItems: "flex-end", padding: 10, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bg },
  input: { flex: 1, maxHeight: 120, backgroundColor: colors.input, color: colors.text, borderRadius: 14, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 13, paddingVertical: 10 },
  send: { width: 45, height: 45, borderRadius: 14, backgroundColor: colors.violet, alignItems: "center", justifyContent: "center" },
  sendText: { color: "#fff", fontSize: 24, fontWeight: "900" },
  overlay: { flex: 1, backgroundColor: "rgba(1,4,12,.82)", justifyContent: "flex-end" },
  modal: { maxHeight: "82%", backgroundColor: colors.panel, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: colors.border, padding: 18 },
  modalHead: { flexDirection: "row", alignItems: "center" },
  modalKicker: { color: colors.cyan, fontSize: 12, fontWeight: "900", letterSpacing: 1.7 },
  modalTitle: { color: colors.text, fontSize: 24, fontWeight: "900", marginTop: 2 },
  close: { color: colors.muted, fontSize: 32 },
  memberList: { marginTop: 12 },
  memberRow: { flexDirection: "row", alignItems: "center", gap: 9, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.border },
  memberName: { color: colors.text, fontWeight: "800", fontSize: 12 },
  memberRole: { color: colors.muted, fontSize: 12, marginTop: 2 },
  removeButton: { borderWidth: 1, borderColor: "rgba(255,95,118,.32)", borderRadius: 9, paddingHorizontal: 9, paddingVertical: 7 },
  removeButtonText: { color: colors.red, fontSize: 12, fontWeight: "800" },
  addSection: { color: colors.muted, fontSize: 12, fontWeight: "900", letterSpacing: 1.4, marginTop: 18, marginBottom: 5 },
  addButton: { borderWidth: 1, borderColor: "rgba(98,214,255,.32)", borderRadius: 9, paddingHorizontal: 11, paddingVertical: 7 },
  addButtonText: { color: colors.cyan, fontSize: 12, fontWeight: "900" },
  noMore: { color: colors.muted, fontSize: 12, paddingVertical: 12 },
  actionOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(2,5,12,.72)" },
  actionSheet: { padding: 16, paddingBottom: 28, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border },
  actionGrabber: { alignSelf: "center", width: 42, height: 4, borderRadius: 99, backgroundColor: colors.border, marginBottom: 13 },
  sheetAction: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 11, borderRadius: 13, backgroundColor: colors.panel2, marginTop: 7 },
  sheetDanger: { backgroundColor: colors.redSoft },
  sheetActionIcon: { width: 18, color: colors.cyan, fontSize: 19, fontWeight: "900", textAlign: "center" },
  sheetActionText: { color: colors.text, fontSize: 13, fontWeight: "900" },});
