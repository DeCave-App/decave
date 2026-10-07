import { useEffect, useMemo, useState } from "react";
import {
  Image,
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
import { router, useLocalSearchParams } from "expo-router";
import { Screen } from "@/src/components/Screen";
import { API_BASE, apiJson } from "@/src/lib/api";
import { useSession } from "@/src/providers/SessionProvider";
import { SkeletonRows } from "@/src/components/Skeleton";
import { colors } from "@/src/theme";
import type { Hub } from "@/src/types";

function assetUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^(https?:|data:|file:)/i.test(value)) return value;
  return `${API_BASE}${value.startsWith("/") ? "" : "/"}${value}`;
}

export default function HubsScreen() {
  const { token } = useSession();

  const [hubs, setHubs] = useState<Hub[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [discover, setDiscover] = useState<Hub[]>([]);
  const params = useLocalSearchParams<{ mode?: string }>();
  const mode: "mine" | "discover" = params.mode === "discover" ? "discover" : "mine";
  // The mode lives in the route so the rail's Discover entry can deep-link to it.
  const setMode = (next: "mine" | "discover") => router.setParams({ mode: next });
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [visibility, setVisibility] =
    useState<"private" | "public">("private");
  const [notice, setNotice] = useState("");
  const [creating, setCreating] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [joiningInvite, setJoiningInvite] = useState(false);

  const load = async () => {
    if (!token) return;

    try {
      const [mine, publicHubs] = await Promise.all([
        apiJson<Hub[]>("/api/servers", {}, token),
        apiJson<Hub[]>("/api/servers/discover", {}, token),
      ]);

      setHubs(mine);
      setDiscover(publicHubs);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not load Hubs.");
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => {
    void load();
  }, [token]);

  const createHub = async () => {
    if (!token || !name.trim() || creating) return;

    setCreating(true);
    setNotice("");

    try {
      const hub = await apiJson<Hub>(
        "/api/servers",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            visibility,
          }),
        },
        token,
      );

      setCreateOpen(false);
      setName("");
      setVisibility("private");
      await load();
      router.push(`/hub/${hub.id}`);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Could not create Hub.",
      );
    } finally {
      setCreating(false);
    }
  };

  const joinHub = async (hub: Hub) => {
    if (!token) return;

    setNotice("");

    try {
      await apiJson(
        `/api/servers/${hub.id}/join`,
        { method: "POST" },
        token,
      );
      await load();
      setMode("mine");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not join Hub.");
    }
  };

  // Accepts a bare code or a pasted invite link (the code is its last path segment).
  const joinWithInvite = async () => {
    const code = inviteCode.trim().replace(/[/?#]+$/, "").split(/[/?#]/).filter(Boolean).pop() ?? "";
    if (!token || !code) return;
    setJoiningInvite(true);
    setNotice("");
    try {
      const hub = await apiJson<Hub>(`/api/invites/${encodeURIComponent(code)}/join`, { method: "POST" }, token);
      setInviteCode("");
      setCreateOpen(false);
      await load();
      router.push(`/hub/${hub.id}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not use that invite.");
      setCreateOpen(false);
    } finally {
      setJoiningInvite(false);
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const list = mode === "mine" ? hubs : discover;

  const filteredList = useMemo(() => {
    const normalized = query.trim().toLowerCase();

    if (!normalized) return list;

    return list.filter((hub) => {
      const haystack = [
        hub.name,
        hub.description ?? "",
        hub.category ?? "",
        ...(hub.tags ?? []),
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalized);
    });
  }, [list, query]);

  return (
    <Screen>
      <ScrollView keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled"
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
        <View style={styles.header}>
          <View>
            <Text maxFontSizeMultiplier={1.3} style={styles.kicker}>YOUR COMMUNITIES</Text>
            <Text style={styles.title}>Hubs</Text>
            <Text style={styles.subtitle}>
              Rooms, voice and the people you play with.
            </Text>
          </View>

          <Pressable
            style={styles.createButton}
            onPress={() => setCreateOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Create or join a Hub"
          >
            <Ionicons name="add" size={23} color="#fff" />
          </Pressable>
        </View>

        <View style={styles.search}>
          <Ionicons name="search" size={18} color={colors.faint} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={
              mode === "mine" ? "Search your Hubs" : "Find a public Hub"
            }
            placeholderTextColor={colors.faint}
            style={styles.searchInput}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {!!query && (
            <Pressable accessibilityRole="button" accessibilityLabel="Clear" onPress={() => setQuery("")} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={colors.faint} />
            </Pressable>
          )}
        </View>

        <View style={styles.segment}>
          <Pressable accessibilityRole="button"
            style={[
              styles.segmentButton,
              mode === "mine" && styles.segmentActive,
            ]}
            onPress={() => setMode("mine")}
          >
            <Ionicons
              name={mode === "mine" ? "layers" : "layers-outline"}
              size={16}
              color={mode === "mine" ? colors.cyan : colors.muted}
            />
            <Text
              style={[
                styles.segmentText,
                mode === "mine" && styles.segmentTextActive,
              ]}
            >
              Your Hubs
            </Text>
          </Pressable>

          <Pressable accessibilityRole="button"
            style={[
              styles.segmentButton,
              mode === "discover" && styles.segmentActive,
            ]}
            onPress={() => setMode("discover")}
          >
            <Ionicons
              name={mode === "discover" ? "compass" : "compass-outline"}
              size={17}
              color={mode === "discover" ? colors.cyan : colors.muted}
            />
            <Text
              style={[
                styles.segmentText,
                mode === "discover" && styles.segmentTextActive,
              ]}
            >
              Discover
            </Text>
          </Pressable>
        </View>

        {!!notice && (
          <View style={styles.notice}>
            <Ionicons
              name="information-circle-outline"
              size={17}
              color={colors.yellow}
            />
            <Text style={styles.noticeText}>{notice}</Text>
          </View>
        )}

        <View style={styles.countRow}>
          <Text maxFontSizeMultiplier={1.3} style={styles.countLabel}>
            {mode === "mine" ? "MEMBERSHIPS" : "PUBLIC HUBS"}
          </Text>
          <Text maxFontSizeMultiplier={1.3} style={styles.countValue}>{filteredList.length}</Text>
        </View>

        {!loaded ? (
          <SkeletonRows rows={5} />
        ) : filteredList.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Ionicons
                name={mode === "mine" ? "layers-outline" : "search-outline"}
                size={26}
                color={colors.cyan}
              />
            </View>
            <Text style={styles.emptyTitle}>
              {query
                ? "No matching Hubs"
                : mode === "mine"
                  ? "No Hubs yet"
                  : "No public Hubs right now"}
            </Text>
            <Text style={styles.emptyText}>
              {query
                ? "Try another name, category or tag."
                : mode === "mine"
                  ? "Create your own Hub or discover a public community."
                  : "Public communities will appear here when they are available."}
            </Text>

            {mode === "mine" && !query && (
              <View style={styles.emptyActions}>
                <Pressable
                  accessibilityRole="button"
                  style={styles.emptyAction}
                  onPress={() => setMode("discover")}
                >
                  <Text style={styles.emptyActionText}>Join a Hub</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  style={[styles.emptyAction, styles.emptyActionSecondary]}
                  onPress={() => setCreateOpen(true)}
                >
                  <Text style={[styles.emptyActionText, styles.emptyActionSecondaryText]}>Create a Hub</Text>
                </Pressable>
              </View>
            )}
          </View>
        ) : (
          <View style={styles.list}>
            {filteredList.map((hub) => (
              <HubCard
                key={hub.id}
                hub={hub}
                discoverMode={mode === "discover"}
                onOpen={() => router.push(`/hub/${hub.id}`)}
                onJoin={() => void joinHub(hub)}
              />
            ))}
          </View>
        )}
      </ScrollView>

      <Modal
        visible={createOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setCreateOpen(false)}
      >
        <Pressable
          style={styles.overlay}
          onPress={() => setCreateOpen(false)}
        >
          <Pressable style={styles.modal} onPress={() => {}}>
            <View style={styles.modalGrabber} />

            <View style={styles.modalHeading}>
              <View style={styles.modalIcon}>
                <Ionicons name="people-circle-outline" size={23} color={colors.cyan} />
              </View>
              <View style={{ flex: 1 }}>
                <Text maxFontSizeMultiplier={1.3} style={styles.modalKicker}>NEW COMMUNITY</Text>
                <Text style={styles.modalTitle}>Create or join a Hub</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Close"
                style={styles.modalClose}
                onPress={() => setCreateOpen(false)}
              >
                <Ionicons name="close" size={20} color={colors.muted} />
              </Pressable>
            </View>

            <Text style={styles.fieldLabel}>HUB NAME</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Give your Hub a name"
              placeholderTextColor={colors.faint}
              style={styles.input}
              maxLength={40}
            />

            <Text style={styles.fieldLabel}>PRIVACY</Text>
            <View style={styles.privacyGrid}>
              <PrivacyCard
                active={visibility === "private"}
                icon="lock-closed-outline"
                title="Private"
                detail="Invite only"
                onPress={() => setVisibility("private")}
              />
              <PrivacyCard
                active={visibility === "public"}
                icon="globe-outline"
                title="Public"
                detail="Discoverable"
                onPress={() => setVisibility("public")}
              />
            </View>

            <Pressable accessibilityRole="button"
              style={[
                styles.primary,
                (!name.trim() || creating) && styles.primaryDisabled,
              ]}
              disabled={!name.trim() || creating}
              onPress={() => void createHub()}
            >
              <Text style={styles.primaryText}>
                {creating ? "Creating…" : "Create Hub"}
              </Text>
            </Pressable>

            <Text style={[styles.fieldLabel, { marginTop: 22 }]}>HAVE AN INVITE?</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TextInput
                value={inviteCode}
                onChangeText={setInviteCode}
                placeholder="Invite code or link"
                placeholderTextColor={colors.faint}
                style={[styles.input, { flex: 1, marginBottom: 0 }]}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="go"
                onSubmitEditing={() => void joinWithInvite()}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Join with invite"
                style={[styles.primary, { marginTop: 0, paddingHorizontal: 18 }, (!inviteCode.trim() || joiningInvite) && styles.primaryDisabled]}
                disabled={!inviteCode.trim() || joiningInvite}
                onPress={() => void joinWithInvite()}
              >
                <Text style={styles.primaryText}>{joiningInvite ? "Joining…" : "Join"}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

function HubCard({
  hub,
  discoverMode,
  onOpen,
  onJoin,
}: {
  hub: Hub;
  discoverMode: boolean;
  onOpen: () => void;
  onJoin: () => void;
}) {
  const accent = hub.accent || colors.violet;
  const canOpen = !discoverMode || hub.joined;

  return (
    <Pressable accessibilityRole="button"
      style={({ pressed }) => [
        styles.card,
        pressed && canOpen && styles.cardPressed,
      ]}
      onPress={canOpen ? onOpen : undefined}
    >
      <View style={[styles.accentRail, { backgroundColor: accent }]} />

      <HubIcon hub={hub} />

      <View style={styles.cardCopy}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>
            {hub.name}
          </Text>
          {hub.visibility === "private" && (
            <View style={styles.privateChip}>
              <Ionicons
                name="lock-closed"
                size={10}
                color={colors.muted}
              />
              <Text style={styles.privateChipText}>Private</Text>
            </View>
          )}
        </View>

        <Text style={styles.meta} numberOfLines={1}>
          {hub.category || "Gaming"} · {hub.memberCount ?? 0} members
        </Text>

        {!!hub.description && (
          <Text style={styles.description} numberOfLines={2}>
            {hub.description}
          </Text>
        )}

        <View style={styles.statusRow}>
          <View style={styles.onlineDot} />
          <Text style={styles.onlineText}>
            {hub.onlineCount ?? 0} online
          </Text>

          {(hub.tags ?? []).slice(0, 2).map((tag) => (
            <View key={tag} style={styles.tag}>
              <Text maxFontSizeMultiplier={1.3} style={styles.tagText}>#{tag}</Text>
            </View>
          ))}
        </View>
      </View>

      {discoverMode && !hub.joined ? (
        <Pressable accessibilityRole="button" style={styles.join} onPress={onJoin}>
          <Text style={styles.joinText}>Join</Text>
        </Pressable>
      ) : (
        <View style={styles.openIcon}>
          <Ionicons
            name="chevron-forward"
            size={18}
            color={colors.muted}
          />
        </View>
      )}
    </Pressable>
  );
}

function HubIcon({ hub }: { hub: Hub }) {
  const accent = hub.accent || colors.violet;

  if (hub.iconUrl) {
    return (
      <View style={[styles.icon, { borderColor: accent }]}>
        <Image source={{ uri: assetUrl(hub.iconUrl)! }} style={styles.iconImage} />
      </View>
    );
  }

  return (
    <View style={[styles.icon, { borderColor: accent }]}>
      <Text style={styles.iconText}>
        {(hub.icon || hub.name.slice(0, 1)).slice(0, 2)}
      </Text>
    </View>
  );
}

function PrivacyCard({
  active,
  icon,
  title,
  detail,
  onPress,
}: {
  active: boolean;
  icon: string;
  title: string;
  detail: string;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button"
      style={[
        styles.privacyCard,
        active && styles.privacyCardActive,
      ]}
      onPress={onPress}
    >
      <View
        style={[
          styles.privacyIcon,
          active && styles.privacyIconActive,
        ]}
      >
        <Ionicons
          name={icon as any}
          size={19}
          color={active ? colors.cyan : colors.muted}
        />
      </View>
      <Text
        style={[
          styles.privacyTitle,
          active && styles.privacyTitleActive,
        ]}
      >
        {title}
      </Text>
      <Text style={styles.privacyDetail}>{detail}</Text>

      <View
        style={[
          styles.radio,
          active && styles.radioActive,
        ]}
      >
        {active && <View style={styles.radioDot} />}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 28,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
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
    lineHeight: 36,
    fontWeight: "900",
    marginTop: 3,
  },
  subtitle: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 16,
    marginTop: 4,
  },
  createButton: {
    width: 44,
    height: 44,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.violet,
    borderWidth: 1,
    borderColor: colors.border,
  },
  search: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 13,
    marginTop: 20,
    borderRadius: 15,
    backgroundColor: colors.input,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    paddingVertical: 0,
  },
  segment: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
  },
  segmentButton: {
    flex: 1,
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderRadius: 14,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
  },
  segmentActive: {
    backgroundColor: colors.cyanSoft,
    borderColor: "rgba(95,225,255,.35)",
  },
  segmentText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "800",
  },
  segmentTextActive: {
    color: colors.text,
  },
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
    padding: 11,
    borderRadius: 13,
    backgroundColor: "rgba(255,198,92,.08)",
    borderWidth: 1,
    borderColor: "rgba(255,198,92,.20)",
  },
  noticeText: {
    flex: 1,
    color: colors.yellow,
    fontSize: 12,
    lineHeight: 15,
  },
  countRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 22,
    marginBottom: 9,
  },
  countLabel: {
    color: colors.muted,
    fontSize: 12,
    letterSpacing: 1.5,
    fontWeight: "900",
  },
  countValue: {
    minWidth: 26,
    textAlign: "center",
    color: colors.cyan,
    fontSize: 12,
    fontWeight: "900",
  },
  list: {
    gap: 9,
  },
  card: {
    position: "relative",
    minHeight: 96,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    overflow: "hidden",
    paddingVertical: 12,
    paddingLeft: 15,
    paddingRight: 11,
    borderRadius: 19,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardPressed: {
    opacity: 0.8,
    borderColor: "rgba(95,225,255,.28)",
  },
  accentRail: {
    position: "absolute",
    left: 0,
    top: 18,
    bottom: 18,
    width: 3,
    borderTopRightRadius: 4,
    borderBottomRightRadius: 4,
  },
  icon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.panel2,
    borderWidth: 2,
  },
  iconImage: {
    width: "100%",
    height: "100%",
    borderRadius: 28,
  },
  iconText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "900",
  },
  cardCopy: {
    flex: 1,
    minWidth: 0,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  name: {
    flexShrink: 1,
    color: colors.text,
    fontSize: 15,
    fontWeight: "900",
  },
  privateChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 99,
    backgroundColor: colors.panel2,
  },
  privateChipText: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800",
  },
  meta: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 4,
  },
  description: {
    color: colors.faint,
    fontSize: 12,
    lineHeight: 14,
    marginTop: 5,
  },
  statusRow: {
    minHeight: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 7,
  },
  onlineDot: {
    width: 6,
    height: 6,
    borderRadius: 99,
    backgroundColor: colors.green,
  },
  onlineText: {
    color: colors.green,
    fontSize: 12,
    fontWeight: "800",
    marginRight: 3,
  },
  tag: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: colors.panel2,
  },
  tagText: {
    color: colors.faint,
    fontSize: 11,
    fontWeight: "700",
  },
  join: {
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: 11,
    backgroundColor: colors.violet,
  },
  joinText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "900",
  },
  openIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.panel2,
  },
  empty: {
    alignItems: "center",
    paddingHorizontal: 22,
    paddingVertical: 34,
    borderRadius: 20,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyIcon: {
    width: 52,
    height: 52,
    borderRadius: 17,
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
    maxWidth: 290,
    color: colors.muted,
    fontSize: 13,
    lineHeight: 17,
    textAlign: "center",
    marginTop: 5,
  },
  emptyActions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8 },
  emptyActionSecondary: { backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border },
  emptyActionSecondaryText: { color: colors.cyan },
  emptyAction: {
    marginTop: 15,
    paddingHorizontal: 15,
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
    width: "100%",
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 24,
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
    opacity: 0.5,
    marginBottom: 15,
  },
  modalHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    marginBottom: 20,
  },
  modalIcon: {
    width: 44,
    height: 44,
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
  fieldLabel: {
    color: colors.muted,
    fontSize: 12,
    letterSpacing: 1.3,
    fontWeight: "900",
    marginBottom: 7,
  },
  input: {
    minHeight: 48,
    paddingHorizontal: 13,
    marginBottom: 16,
    borderRadius: 14,
    backgroundColor: colors.input,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    fontSize: 13,
  },
  privacyGrid: {
    flexDirection: "row",
    gap: 9,
  },
  privacyCard: {
    position: "relative",
    flex: 1,
    minHeight: 112,
    padding: 12,
    borderRadius: 17,
    backgroundColor: colors.panel2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  privacyCardActive: {
    backgroundColor: colors.cyanSoft,
    borderColor: "rgba(95,225,255,.40)",
  },
  privacyIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.panel,
  },
  privacyIconActive: {
    backgroundColor: "rgba(95,225,255,.10)",
  },
  privacyTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "900",
    marginTop: 9,
  },
  privacyTitleActive: {
    color: colors.cyan,
  },
  privacyDetail: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 3,
  },
  radio: {
    position: "absolute",
    top: 12,
    right: 12,
    width: 18,
    height: 18,
    borderRadius: 99,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.faint,
  },
  radioActive: {
    borderColor: colors.cyan,
  },
  radioDot: {
    width: 8,
    height: 8,
    borderRadius: 99,
    backgroundColor: colors.cyan,
  },
  primary: {
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 18,
    borderRadius: 14,
    backgroundColor: colors.violet,
  },
  primaryDisabled: {
    opacity: 0.45,
  },
  primaryText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "900",
  },
});
