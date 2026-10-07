import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Avatar } from "@/src/components/Avatar";
import { apiJson } from "@/src/lib/api";
import { colors } from "@/src/theme";
import type { ChatMessage } from "@/src/types";

type Mode = "search" | "pins";

/**
 * Bottom sheet for a channel's message search and its pinned messages.
 * Picking a result hands it back so the room can scroll to it.
 */
export function ChannelFinderSheet({
  mode,
  channelId,
  token,
  pinned,
  onPick,
  onClose,
}: {
  mode: Mode | null;
  channelId: number;
  token: string | null;
  pinned: ChatMessage[];
  onPick: (message: ChatMessage) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // Pins from the server (null until loaded, or when the request failed and we fall back to loaded messages).
  const [serverPins, setServerPins] = useState<ChatMessage[] | null>(null);
  const [pinsLoading, setPinsLoading] = useState(false);

  useEffect(() => {
    if (mode === null) {
      setQuery("");
      setResults([]);
      setError("");
      setServerPins(null);
    }
  }, [mode]);

  useEffect(() => {
    if (mode !== "pins" || !token) return;
    let cancelled = false;
    setPinsLoading(true);
    setServerPins(null);
    apiJson<{ pins?: ChatMessage[] }>(`/api/channels/${channelId}/pins`, {}, token)
      .then((data) => {
        if (!cancelled && Array.isArray(data.pins)) setServerPins(data.pins);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setPinsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, channelId, token]);

  useEffect(() => {
    if (mode !== "search" || !token) return;
    const q = query.trim();
    if (!q) {
      setResults([]);
      setError("");
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await apiJson<ChatMessage[]>(
          `/api/channels/${channelId}/search?q=${encodeURIComponent(q)}`,
          {},
          token,
        );
        if (!cancelled) {
          setResults(data);
          setError("");
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Search failed.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, mode, channelId, token]);

  const list = mode === "pins" ? serverPins ?? pinned : results;
  const emptyText =
    mode === "pins"
      ? pinsLoading && serverPins === null
        ? ""
        : "No pinned messages yet. Moderators can pin from a message's long-press menu."
      : query.trim()
        ? loading
          ? ""
          : "No messages match."
        : "Search by message text or username.";

  return (
    <Modal visible={mode !== null} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.grabber} />
          <View style={styles.head}>
            <Ionicons name={mode === "pins" ? "pin" : "search"} size={18} color={colors.cyan} />
            <Text style={styles.title}>{mode === "pins" ? "Pinned messages" : "Search messages"}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={10} onPress={onClose}>
              <Ionicons name="close" size={22} color={colors.muted} />
            </Pressable>
          </View>

          {mode === "search" && (
            <View style={styles.search}>
              <Ionicons name="search" size={16} color={colors.faint} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search this channel"
                placeholderTextColor={colors.faint}
                style={styles.searchInput}
                autoFocus
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
              />
              {loading && <ActivityIndicator size="small" color={colors.cyan} />}
            </View>
          )}

          {mode === "pins" && pinsLoading && serverPins === null && pinned.length === 0 && (
            <ActivityIndicator color={colors.cyan} style={{ marginVertical: 16 }} />
          )}

          {!!error && <Text style={styles.error}>{error}</Text>}

          <FlatList
            data={list}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            style={styles.list}
            ListEmptyComponent={emptyText ? <Text style={styles.empty}>{emptyText}</Text> : null}
            renderItem={({ item }) => (
              <Pressable accessibilityRole="button"
                style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
                onPress={() => onPick(item)}
              >
                <Avatar username={item.username} avatarUrl={item.avatarUrl} size={32} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.rowHead} numberOfLines={1}>
                    {item.username}
                    <Text style={styles.rowTime}>  {new Date(item.timestamp).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</Text>
                  </Text>
                  <Text style={styles.rowText} numberOfLines={3}>
                    {item.text || item.attachment?.name || "Attachment"}
                  </Text>
                </View>
              </Pressable>
            )}
          />
        </Pressable>
      </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(2,5,12,.72)" },
  sheet: {
    maxHeight: "80%",
    minHeight: "55%",
    padding: 16,
    paddingBottom: 28,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
  },
  grabber: { alignSelf: "center", width: 42, height: 4, borderRadius: 99, backgroundColor: colors.border, marginBottom: 13 },
  head: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  title: { flex: 1, color: colors.text, fontSize: 16, fontWeight: "900" },
  search: {
    height: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel2,
    marginBottom: 8,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 15 },
  error: { color: colors.red, fontSize: 13, marginBottom: 6 },
  list: { flexGrow: 0 },
  empty: { color: colors.muted, fontSize: 13, textAlign: "center", paddingVertical: 28, paddingHorizontal: 16, lineHeight: 19 },
  row: { flexDirection: "row", gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  rowHead: { color: colors.text, fontSize: 14, fontWeight: "800" },
  rowTime: { color: colors.faint, fontSize: 12, fontWeight: "600" },
  rowText: { color: colors.muted, fontSize: 14, marginTop: 2, lineHeight: 19 },
});
