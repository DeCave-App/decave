import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Clipboard,
  Modal,
  Platform,
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
import ReportSheet, { type MobileReportTarget } from "@/src/components/ReportSheet";
import { Screen } from "@/src/components/Screen";
import { Avatar } from "@/src/components/Avatar";
import { apiJson } from "@/src/lib/api";
import { useSession } from "@/src/providers/SessionProvider";
import { useDirectCall } from "@/src/providers/DirectCallProvider";
import { SkeletonRows } from "@/src/components/Skeleton";
import { colors } from "@/src/theme";
import type { AccountUser, SocialState } from "@/src/types";

export default function FriendsScreen() {
  const { token, user } = useSession();
  const [filter, setFilter] = useState<"online" | "all" | "pending">("online");
  const [copied, setCopied] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [social, setSocial] = useState<SocialState>({
    friends: [],
    incoming: [],
    outgoing: [],
  });
  const [friendId, setFriendId] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [menuFriend, setMenuFriend] = useState<AccountUser | null>(null);
  const [reportTarget, setReportTarget] = useState<MobileReportTarget | null>(null);
  const { startCall } = useDirectCall();

  const load = async () => {
    if (!token) return;

    try {
      setSocial(await apiJson<SocialState>("/api/social", {}, token));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not load friends.");
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => {
    void load();
  }, [token]);

  const onlineFriends = useMemo(
    () => social.friends.filter((friend) => friend.online),
    [social.friends],
  );

  const shownFriends = useMemo(
    () => (filter === "online" ? onlineFriends : [...social.friends].sort((a, b) => Number(!!b.online) - Number(!!a.online) || a.username.localeCompare(b.username))),
    [filter, onlineFriends, social.friends],
  );

  const copyId = () => {
    if (!user) return;
    Clipboard.setString(user.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const action = async (
    user: AccountUser,
    actionName: "accept" | "reject" | "remove",
  ) => {
    if (!token) return;

    setNotice("");

    try {
      const path =
        actionName === "remove"
          ? `/api/friends/${encodeURIComponent(user.id)}`
          : `/api/friends/${encodeURIComponent(user.id)}/${actionName}`;

      await apiJson(
        path,
        {
          method: actionName === "remove" ? "DELETE" : "POST",
        },
        token,
      );

      await load();
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Friend action failed.",
      );
    }
  };

  const request = async () => {
    const id = friendId.trim();
    if (!token || !id) return;

    setNotice("");

    try {
      await apiJson(
        `/api/friends/${encodeURIComponent(id)}/request`,
        { method: "POST" },
        token,
      );

      setFriendId("");
      setNotice("Friend request sent.");
      await load();
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Could not send request.",
      );
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const openDm = (friend: AccountUser) => {
    router.push(
      `/dm/${encodeURIComponent(
        friend.id,
      )}?username=${encodeURIComponent(friend.username)}`,
    );
  };

  const confirmRemove = (friend: AccountUser) => {
    Alert.alert(
      "Remove friend?",
      `Remove ${friend.username} from your friends?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => void action(friend, "remove"),
        },
      ],
    );
  };

  const confirmBlock = (friend: AccountUser) => {
    Alert.alert(
      `Block ${friend.username}?`,
      "They won't be able to message or call you. You can unblock them later in Settings › Privacy & Safety.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Block",
          style: "destructive",
          onPress: () => void (async () => {
            if (!token) return;
            setNotice("");
            try {
              await apiJson(`/api/safety/blocks/${encodeURIComponent(friend.id)}`, { method: "PUT" }, token);
              setNotice(`${friend.username} is blocked.`);
              await load();
            } catch (error) {
              setNotice(error instanceof Error ? error.message : "Could not block this user.");
            }
          })(),
        },
      ],
    );
  };

  // Close the sheet first so the follow-up alert or screen isn't hidden behind it.
  const fromMenu = (run: (friend: AccountUser) => void) => () => {
    const friend = menuFriend;
    setMenuFriend(null);
    if (friend) setTimeout(() => run(friend), 250);
  };

  return (
    <Screen>
      <ScrollView keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor={colors.cyan}
          />
        }
      >
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text maxFontSizeMultiplier={1.3} style={styles.kicker}>SOCIAL</Text>
            <Text style={styles.title}>Friends</Text>
            <Text style={styles.subtitle}>
              See who's around and jump straight into a conversation.
            </Text>
          </View>

          <View style={styles.onlineSummary}>
            <View style={styles.onlineDot} />
            <Text style={styles.onlineSummaryValue}>
              {onlineFriends.length}
            </Text>
            <Text style={styles.onlineSummaryLabel}>online</Text>
          </View>
        </View>

        <View style={styles.addCard}>
          {!!user && (
            <View style={styles.idBlock}>
              <Text style={styles.panelLabel}>YOUR DECAVE ID</Text>
              <View style={styles.idRow}>
                <Text style={styles.idText} selectable numberOfLines={1}>{user.id}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={copied ? "DeCave ID copied" : "Copy your DeCave ID"}
                  style={styles.copyButton}
                  onPress={copyId}
                >
                  <Ionicons name={copied ? "checkmark" : "copy-outline"} size={14} color={copied ? colors.green : colors.cyan} />
                  <Text style={[styles.copyText, copied && { color: colors.green }]}>{copied ? "Copied" : "Copy"}</Text>
                </Pressable>
              </View>
            </View>
          )}

          <Text style={[styles.panelLabel, { marginTop: 14 }]}>ADD A FRIEND</Text>
          <View style={styles.addInputRow}>
            <View style={styles.inputWrap}>
              <Ionicons
                name="finger-print-outline"
                size={17}
                color={colors.faint}
              />
              <TextInput
                value={friendId}
                onChangeText={setFriendId}
                placeholder="Their DeCave ID"
                placeholderTextColor={colors.faint}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.input}
                returnKeyType="send"
                onSubmitEditing={() => void request()}
              />
              {!!friendId && (
                <Pressable accessibilityRole="button" accessibilityLabel="Clear"
                  onPress={() => setFriendId("")}
                  hitSlop={8}
                >
                  <Ionicons
                    name="close-circle"
                    size={18}
                    color={colors.faint}
                  />
                </Pressable>
              )}
            </View>
          </View>
          <Pressable accessibilityRole="button"
            style={[
              styles.sendRequest,
              !friendId.trim() && styles.sendRequestDisabled,
            ]}
            disabled={!friendId.trim()}
            onPress={() => void request()}
          >
            <Ionicons name="person-add-outline" size={16} color="#fff" />
            <Text style={styles.sendRequestText}>Send request</Text>
          </Pressable>

          {!!notice && (
            <View
              style={[
                styles.notice,
                notice === "Friend request sent." &&
                  styles.noticeSuccess,
              ]}
            >
              <Ionicons
                name={
                  notice === "Friend request sent."
                    ? "checkmark-circle-outline"
                    : "alert-circle-outline"
                }
                size={16}
                color={
                  notice === "Friend request sent."
                    ? colors.green
                    : colors.yellow
                }
              />
              <Text
                style={[
                  styles.noticeText,
                  notice === "Friend request sent." &&
                    styles.noticeTextSuccess,
                ]}
              >
                {notice}
              </Text>
              {notice.endsWith(" is blocked.") && (
                <Pressable accessibilityRole="button" hitSlop={8} onPress={() => router.push("/privacy" as any)}>
                  <Text style={styles.noticeLink}>Manage</Text>
                </Pressable>
              )}
            </View>
          )}

          {social.incoming.length > 0 && (
            <View style={styles.incomingBlock}>
              <Text style={styles.panelLabel}>INCOMING REQUESTS · {social.incoming.length}</Text>
              {social.incoming.map((friend) => (
                <View key={friend.id} style={styles.requestRow}>
                  <Avatar
                    username={friend.username}
                    avatarUrl={friend.avatarUrl}
                    online={friend.online}
                    size={38}
                  />
                  <View style={styles.personCopy}>
                    <Text style={styles.personName} numberOfLines={1}>
                      {friend.username}
                    </Text>
                    <Text style={styles.personStatus}>Wants to be friends</Text>
                  </View>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Accept ${friend.username}`}
                    style={styles.acceptButton}
                    onPress={() => void action(friend, "accept")}
                  >
                    <Text style={styles.acceptText}>Accept</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Ignore ${friend.username}`}
                    style={styles.rejectButton}
                    onPress={() => void action(friend, "reject")}
                  >
                    <Text style={styles.rejectText}>Ignore</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={styles.chips} accessibilityRole="tablist">
          {([
            ["online", `Online · ${onlineFriends.length}`],
            ["all", `All · ${social.friends.length}`],
            ["pending", `Pending · ${social.incoming.length + social.outgoing.length}`],
          ] as const).map(([key, label]) => {
            const active = filter === key;
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

        {filter === "pending" ? (
          social.incoming.length + social.outgoing.length === 0 ? (
            <MiniEmpty
              icon="paper-plane-outline"
              title="No pending requests"
              detail="Requests you send or receive show up here."
            />
          ) : (
            <View style={styles.list}>
              {social.incoming.map((friend) => (
                <View key={friend.id} style={styles.sentRow}>
                  <Avatar username={friend.username} avatarUrl={friend.avatarUrl} online={friend.online} size={42} />
                  <View style={styles.personCopy}>
                    <Text style={styles.personName} numberOfLines={1}>{friend.username}</Text>
                    <Text style={styles.personStatus}>Incoming request</Text>
                  </View>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Accept ${friend.username}`} style={styles.acceptButton} onPress={() => void action(friend, "accept")}>
                    <Text style={styles.acceptText}>Accept</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Ignore ${friend.username}`} style={styles.rejectButton} onPress={() => void action(friend, "reject")}>
                    <Text style={styles.rejectText}>Ignore</Text>
                  </Pressable>
                </View>
              ))}
              {social.outgoing.map((friend) => (
                <View key={friend.id} style={styles.sentRow}>
                  <Avatar
                    username={friend.username}
                    avatarUrl={friend.avatarUrl}
                    online={friend.online}
                    size={42}
                  />
                  <View style={styles.personCopy}>
                    <Text style={styles.personName} numberOfLines={1}>
                      {friend.username}
                    </Text>
                    <Text style={styles.personStatus}>Sent · waiting for reply</Text>
                  </View>
                  <Pressable accessibilityRole="button"
                    style={styles.cancelRequestButton}
                    onPress={() => void action(friend, "remove")}
                    hitSlop={4}
                  >
                    <Ionicons name="close" size={15} color={colors.red} />
                    <Text style={styles.cancelRequestText}>Cancel</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )
        ) : !loaded ? (
          <SkeletonRows rows={5} />
        ) : social.friends.length === 0 ? (
          <MiniEmpty
            icon="people-outline"
            title="No friends yet"
            detail="Share your DeCave ID or add someone above — or find teammates with Squad Finder."
          />
        ) : shownFriends.length === 0 ? (
          <MiniEmpty
            icon="moon-outline"
            title="Your crew is quiet"
            detail="Online friends will appear here."
          />
        ) : (
          <View style={styles.grid}>
            {shownFriends.map((friend) => (
              <FriendCard
                key={friend.id}
                friend={friend}
                onOpen={() => openDm(friend)}
                onMenu={() => setMenuFriend(friend)}
              />
            ))}
          </View>
        )}
      </ScrollView>

      <Modal visible={menuFriend !== null} transparent animationType="fade" onRequestClose={() => setMenuFriend(null)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setMenuFriend(null)}>
          <Pressable style={styles.menuSheet} onPress={() => {}}>
            <View style={styles.menuGrabber} />
            {menuFriend && (
              <View style={styles.menuHeader}>
                <Avatar username={menuFriend.username} avatarUrl={menuFriend.avatarUrl} online={menuFriend.online} size={44} />
                <View style={styles.personCopy}>
                  <Text style={styles.personName} numberOfLines={1}>{menuFriend.username}</Text>
                  <Text style={styles.personStatus} numberOfLines={1}>{menuFriend.online ? "Online" : "Offline"}</Text>
                </View>
              </View>
            )}
            <MenuAction icon="chatbubble-outline" label="Send message" onPress={fromMenu(openDm)} />
            <MenuAction icon="call-outline" label="Voice call" onPress={fromMenu((friend) => void startCall(friend.id, false, friend.username))} />
            <MenuAction icon="videocam-outline" label="Video call" onPress={fromMenu((friend) => void startCall(friend.id, true, friend.username))} />
            <MenuAction
              icon="flag-outline"
              label="Report"
              onPress={fromMenu((friend) => setReportTarget({ targetType: "user", targetId: friend.id, subjectUserId: friend.id, subjectUsername: friend.username, contextType: "friends", contextLabel: "Friends" }))}
            />
            <MenuAction icon="ban-outline" label="Block" danger onPress={fromMenu(confirmBlock)} />
            <MenuAction icon="person-remove-outline" label="Remove friend" danger onPress={fromMenu(confirmRemove)} />
          </Pressable>
        </Pressable>
      </Modal>

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

function MenuAction({
  icon,
  label,
  danger = false,
  onPress,
}: {
  icon: string;
  label: string;
  danger?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.menuAction, danger && styles.menuActionDanger, pressed && styles.personPressed]}
      onPress={onPress}
      accessibilityRole="button"
    >
      <Ionicons name={icon as any} size={18} color={danger ? colors.red : colors.cyan} />
      <Text style={[styles.menuActionText, danger && { color: colors.red }]}>{label}</Text>
    </Pressable>
  );
}

function FriendCard({
  friend,
  onOpen,
  onMenu,
}: {
  friend: AccountUser;
  onOpen: () => void;
  onMenu: () => void;
}) {
  const detail = friend.activityText || friend.statusText || (friend.online ? "Online" : "Offline");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${friend.username}, ${detail}`}
      accessibilityHint="Long press for more options."
      accessibilityActions={[{ name: "longpress", label: "More options" }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "longpress") onMenu();
      }}
      style={({ pressed }) => [styles.card, pressed && styles.personPressed]}
      onPress={onOpen}
      onLongPress={onMenu}
      delayLongPress={350}
    >
      <Pressable
        style={styles.cardMore}
        onPress={onMenu}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={`More options for ${friend.username}`}
      >
        <Ionicons name="ellipsis-horizontal" size={15} color={colors.faint} />
      </Pressable>
      <Avatar
        username={friend.username}
        avatarUrl={friend.avatarUrl}
        online={!!friend.online}
        size={52}
      />
      <Text style={styles.cardName} numberOfLines={1}>{friend.username}</Text>
      <Text style={[styles.cardStatus, friend.online && !friend.activityText && !friend.statusText && { color: colors.green }]} numberOfLines={1}>
        {detail}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Message ${friend.username}`}
        style={styles.cardMessage}
        onPress={onOpen}
      >
        <Ionicons name="chatbubble-outline" size={14} color={colors.cyan} />
        <Text style={styles.cardMessageText}>Message</Text>
      </Pressable>
    </Pressable>
  );
}

function MiniEmpty({
  icon,
  title,
  detail,
}: {
  icon: string;
  title: string;
  detail: string;
}) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon as any} size={22} color={colors.cyan} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.emptyTitle}>{title}</Text>
        <Text style={styles.emptyText}>{detail}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cancelRequestButton: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, minHeight: 30, borderRadius: 9, backgroundColor: "rgba(255,92,104,.08)", borderWidth: 1, borderColor: "rgba(255,92,104,.18)" },
  cancelRequestText: { color: colors.red, fontSize: 13, fontWeight: "900" },
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 28,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
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
    maxWidth: 270,
    color: colors.muted,
    fontSize: 13,
    lineHeight: 16,
    marginTop: 4,
  },
  onlineSummary: {
    minWidth: 62,
    minHeight: 58,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    backgroundColor: colors.greenSoft,
    borderWidth: 1,
    borderColor: "rgba(67,226,154,.20)",
  },
  onlineDot: {
    width: 8,
    height: 8,
    borderRadius: 99,
    backgroundColor: colors.green,
  },
  onlineSummaryValue: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "900",
    marginTop: 3,
  },
  onlineSummaryLabel: {
    color: colors.green,
    fontSize: 11,
    fontWeight: "900",
    marginTop: 1,
  },

  addCard: {
    padding: 13,
    borderRadius: 19,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
  },
  idBlock: {},
  panelLabel: {
    color: colors.faint,
    fontSize: 10.5,
    fontWeight: "700",
    letterSpacing: 1.6,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  idRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 7,
    paddingLeft: 11,
    paddingRight: 5,
    minHeight: 42,
    borderRadius: 12,
    backgroundColor: colors.input,
    borderWidth: 1,
    borderColor: colors.border,
  },
  idText: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  copyButton: {
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    borderRadius: 9,
    backgroundColor: colors.cyanSoft,
  },
  copyText: { color: colors.cyan, fontSize: 12, fontWeight: "900" },
  sendRequestText: { color: "#fff", fontSize: 13, fontWeight: "900" },
  incomingBlock: {
    marginTop: 16,
    gap: 8,
  },
  acceptText: { color: "#fff", fontSize: 12, fontWeight: "900" },
  rejectText: { color: colors.muted, fontSize: 12, fontWeight: "900" },
  chips: {
    flexDirection: "row",
    gap: 7,
    marginTop: 18,
    marginBottom: 12,
  },
  chip: {
    minHeight: 34,
    paddingHorizontal: 13,
    borderRadius: 99,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: {
    backgroundColor: colors.cyanSoft,
    borderColor: colors.cyan,
  },
  chipText: { color: colors.muted, fontSize: 12, fontWeight: "800" },
  chipTextActive: { color: colors.cyan },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 10,
  },
  card: {
    width: "48.5%",
    alignItems: "center",
    paddingTop: 16,
    paddingBottom: 11,
    paddingHorizontal: 10,
    borderRadius: 17,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardMore: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  },
  cardName: {
    alignSelf: "stretch",
    textAlign: "center",
    color: colors.text,
    fontSize: 14,
    fontWeight: "900",
    marginTop: 9,
  },
  cardStatus: {
    alignSelf: "stretch",
    textAlign: "center",
    color: colors.muted,
    fontSize: 12,
    marginTop: 3,
  },
  cardMessage: {
    alignSelf: "stretch",
    minHeight: 34,
    marginTop: 11,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 10,
    backgroundColor: colors.cyanSoft,
  },
  cardMessageText: { color: colors.cyan, fontSize: 12, fontWeight: "900" },
  addHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  addIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.cyanSoft,
  },
  addTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "900",
  },
  addHelp: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 13,
    marginTop: 2,
  },
  addInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginTop: 7,
  },
  inputWrap: {
    flex: 1,
    minHeight: 45,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 11,
    borderRadius: 13,
    backgroundColor: colors.input,
    borderWidth: 1,
    borderColor: colors.border,
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    paddingVertical: 0,
  },
  sendRequest: {
    minHeight: 42,
    marginTop: 8,
    flexDirection: "row",
    gap: 7,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.violet,
  },
  sendRequestDisabled: {
    opacity: 0.36,
  },
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
  },
  noticeSuccess: {},
  noticeText: {
    flex: 1,
    color: colors.yellow,
    fontSize: 12,
  },
  noticeLink: {
    color: colors.cyan,
    fontSize: 12,
    fontWeight: "900",
  },
  noticeTextSuccess: {
    color: colors.green,
  },

  sectionBlock: {
    marginTop: 23,
  },
  sectionHeader: {
    minHeight: 26,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  sectionHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  sectionTitle: {
    color: colors.muted,
    fontSize: 12,
    letterSpacing: 1.5,
    fontWeight: "900",
  },
  countBadge: {
    minWidth: 23,
    height: 20,
    paddingHorizontal: 7,
    borderRadius: 99,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
  },
  countText: {
    color: colors.faint,
    fontSize: 11,
    fontWeight: "900",
  },
  list: {
    gap: 8,
  },
  requestRow: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 8,
    borderRadius: 14,
    backgroundColor: colors.input,
    borderWidth: 1,
    borderColor: "rgba(124,92,255,.25)",
  },
  sentRow: {
    minHeight: 61,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    padding: 9,
    borderRadius: 16,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
  },
  person: {
    minHeight: 70,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 10,
    borderRadius: 17,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
  },
  personPressed: {
    opacity: 0.78,
    borderColor: "rgba(95,225,255,.28)",
  },
  personCopy: {
    flex: 1,
    minWidth: 0,
  },
  personName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "900",
  },
  personStatus: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 3,
  },
  acceptButton: {
    paddingHorizontal: 11,
    height: 32,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.violet,
  },
  rejectButton: {
    paddingHorizontal: 11,
    height: 32,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.panel2,
  },
  pendingBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 5,
    borderRadius: 99,
    backgroundColor: "rgba(255,198,92,.09)",
  },
  pendingText: {
    color: colors.yellow,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0.6,
  },
  messageButton: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.cyanSoft,
  },
  swipeRemove: {
    width: 92,
    marginLeft: 8,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    backgroundColor: colors.red,
  },
  swipeRemoveText: { color: "#fff", fontSize: 13, fontWeight: "900" },
  menuBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: colors.overlay },
  menuSheet: {
    padding: 16,
    paddingBottom: 30,
    gap: 7,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
  },
  menuGrabber: { alignSelf: "center", width: 42, height: 4, borderRadius: 99, backgroundColor: colors.border, marginBottom: 6 },
  menuHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 6 },
  menuAction: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 13,
    borderRadius: 13,
    backgroundColor: colors.panel2,
  },
  menuActionDanger: { backgroundColor: colors.redSoft },
  menuActionText: { color: colors.text, fontSize: 14, fontWeight: "800" },
  moreButton: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.panel2,
  },
  empty: {
    minHeight: 74,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    padding: 11,
    borderRadius: 17,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.cyanSoft,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "900",
  },
  emptyText: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 2,
  },
  allOnlineNote: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderRadius: 15,
    backgroundColor: colors.greenSoft,
  },
  allOnlineText: {
    color: colors.green,
    fontSize: 12,
    fontWeight: "800",
  },
});
